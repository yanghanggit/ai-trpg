"""
MCP Client Graph - 基于 LangGraph 的 MCP 工具调用工作流

## 工作流架构
preprocess → llm_invoke → tool_parse → [条件路由]
                                          ↓ (需要工具)
                                    tool_execution → llm_re_invoke → END
                                          ↓ (无需工具)
                                        END

## 核心设计：二次推理（Re-invoke）模式
让 AI 基于工具结果进行深度分析，而不是简单拼接。

## messages 上下文演变
1. **初始化**: `context + [request]`
2. **preprocess**: 插入 `SystemMessage(工具说明)`
3. **llm_invoke**: 追加 `AIMessage(first_llm_response)`
4. **tool_parse**: 解析工具调用（不修改 messages）
5. **tool_execution**: 并发执行工具（不修改 messages）
6. **llm_re_invoke**: 追加 `AIMessage(工具结果)` + `HumanMessage(二次推理指令)` + `AIMessage(re_invoke_response)`

## 关键字段
- `first_llm_response`: 第一次推理结果（用于提取）
- `re_invoke_response`: 二次推理结果（用于提取）
- `messages`: 完整上下文链路（全局唯一真相源）

## 返回逻辑
- 有工具执行 → 返回 `re_invoke_response`
- 无工具执行 → 返回 `first_llm_response`

## ⚠️ LangGraph 状态合并机制（重要！）

**关键规则**：
1. ✅ 带 `Annotated` 修饰符的字段（如 `messages`）会自动累积合并
2. ❌ 普通字段（如 `llm`, `mcp_client`）**完全替换，不合并**
3. 🚨 **如果节点返回值中缺少某个字段，该字段会从状态中丢失！**

**正确做法**：
```python
# ✅ 节点必须返回所有需要保持的字段
return {
    "messages": state["messages"],      # 保持
    "llm": state["llm"],                # 保持
    "mcp_client": state["mcp_client"],  # 保持
    "new_field": new_value,             # 新增/更新
}

# ❌ 错误：只返回新字段会导致其他字段丢失
return {
    "new_field": new_value,  # 其他字段会从状态中消失！
}
```

**对比其他 Graph**：
- `chat_graph.py` 和 `rag_graph.py` 的节点都正确保持了所有必要字段
- 本文件之前的实现存在字段丢失问题，已修复
"""

from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv()

import asyncio
from typing import Annotated, Any, Dict, Final, List, Optional
from langchain.schema import AIMessage, SystemMessage, HumanMessage
from langchain_core.messages import BaseMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.graph import StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict
from ..mcp import (
    McpClient,
    McpToolInfo,
    ToolCallParser,
    execute_mcp_tool,
    build_json_tool_example,
    format_tool_description_simple,
)
from loguru import logger
import json


############################################################################################################
# 默认的二次推理指令模板（常量）
DEFAULT_RE_INVOKE_INSTRUCTION: Final[
    str
] = """# 基于上述工具执行结果，响应用户输入!

## ⚠️ 约束条件

- **禁止再次调用工具** - 所有工具已执行完成
- **禁止输出工具调用格式** - 不要生成 {"tool_call": ...} 这样的JSON结构

## ✅ 响应要求

1. **内容**: 基于工具结果直接响应用户输入，保持你的角色设定和语言风格
2. **格式**: 如果用户在最近一次的请求中明确要求特定输出格式(JSON/Markdown/表格等)，严格遵守
3. **风格**: 自然融合工具结果进行回应，无需解释工具调用过程

💡 **提示**: 用户输入可能是问题、指令、对话或行动描述，请根据上下文灵活响应。"""


############################################################################################################
# 工具调用指令模板（常量）
TOOL_CALL_INSTRUCTION: Final[
    str
] = """当你需要获取实时信息或执行特定操作时，可以调用相应的工具。

## 工具调用格式

请严格按照以下JSON格式调用工具（支持同时调用多个）：

```json
{
  "tool_call": {
    "name": "工具名称1",
    "arguments": {
      "参数名": "参数值1"
    }
  }
}

{
  "tool_call": {
    "name": "工具名称2",
    "arguments": {
      "参数名": "参数值2"
    }
  }
}
```

## 使用指南

- 当任务明确要求你调用工具时，你必须调用相应的工具

**工具调用流程**：
1. 分析任务需求，确定需要调用哪些工具
2. 按照JSON格式调用工具（可同时调用多个）

**禁止行为**：
- ❌ 不要在未调用工具的情况下假设或推测工具执行结果"""


############################################################################################################
class McpState(TypedDict, total=False):
    """
    MCP 增强的状态，包含消息和 MCP 客户端相关信息
    """

    messages: Annotated[List[BaseMessage], add_messages]
    llm: ChatDeepSeek  # DeepSeek LLM实例，整个graph流程共享（必需）
    mcp_client: McpClient  # MCP 客户端（必需）
    available_tools: List[McpToolInfo]  # 可用的 MCP 工具
    tool_outputs: List[Dict[str, Any]]  # 工具执行结果

    # 工作流程字段
    first_llm_response: AIMessage  # 第一次推理结果（决定是否调用工具）
    parsed_tool_calls: List[Dict[str, Any]]  # 解析出的工具调用
    needs_tool_execution: bool  # 是否需要执行工具
    re_invoke_response: AIMessage  # 二次推理结果（仅在执行工具后存在）
    re_invoke_instruction: Optional[HumanMessage]  # 二次推理指令消息（可选）


############################################################################################################
def _build_tool_instruction_prompt(available_tools: List[McpToolInfo]) -> str:
    """
    构建系统提示，仅支持JSON格式工具调用

    Args:
        available_tools: 可用工具列表

    Returns:
        str: 构建好的系统提示
    """
    # 先检查是否有工具，没有工具就直接返回简单提示
    if not available_tools:
        return "⚠️ 当前没有可用工具，请仅使用你的知识回答问题。"

    # 使用常量模板作为基础
    tool_instruction_prompt = str(TOOL_CALL_INSTRUCTION)

    # 添加可用工具列表
    tool_instruction_prompt += "\n\n## 可用工具"

    # 直接列表展示所有工具，无需分类
    for tool in available_tools:
        tool_desc = format_tool_description_simple(tool)
        tool_instruction_prompt += f"\n{tool_desc}"

    # 添加工具调用示例
    example_tool = available_tools[0]
    tool_instruction_prompt += "\n\n## 调用示例\n\n"
    tool_instruction_prompt += build_json_tool_example(example_tool)

    return tool_instruction_prompt


############################################################################################################
async def _preprocess_node(state: McpState) -> McpState:
    """
    预处理节点：注入工具说明到 messages

    messages 变化：插入 SystemMessage(工具说明)

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态
    """
    messages = state["messages"]
    available_tools = state.get("available_tools", [])

    # 构建系统提示
    tool_instruction_prompt = _build_tool_instruction_prompt(available_tools)
    # logger.debug(f"🛠️ 工具指令提示:\n{tool_instruction_prompt}")

    # 智能添加系统消息：直接修改 messages
    if messages and isinstance(messages[0], SystemMessage):
        # 已经有系统消息在开头，追加新的工具说明
        messages.insert(1, SystemMessage(content=tool_instruction_prompt))
    else:
        # 没有系统消息，插入默认角色设定和工具说明到开头
        default_role_prompt = (
            "你是一个智能助手，具有使用工具的能力。\n\n" + tool_instruction_prompt
        )
        messages.insert(0, SystemMessage(content=default_role_prompt))

        # 走到这里基本就是错了，警告下，因为会影响角色设定！
        logger.warning(
            "⚠️ 系统消息缺失，已自动添加默认角色设定和工具说明，走到这里基本就是错了，警告下，因为会影响角色设定！"
        )

    # ✅ 必须保持所有必要的状态字段！
    result: McpState = {
        "messages": messages,
        "llm": state["llm"],
        "mcp_client": state["mcp_client"],
        "available_tools": available_tools,
        "tool_outputs": state.get("tool_outputs", []),
    }
    return result


############################################################################################################
async def _llm_invoke_node(state: McpState) -> McpState:
    """
    第一次推理节点：决定是否调用工具

    messages 变化：追加 AIMessage(first_llm_response)

    Args:
        state: 当前状态

    Returns:
        McpState: 包含 first_llm_response 的状态
    """
    llm = state["llm"]
    messages = state["messages"]

    # 调用 LLM（如果异常，直接向上传播）
    response = llm.invoke(messages)
    assert isinstance(response, AIMessage), "LLM 返回的响应必须是 AIMessage 类型"

    # ✅ 保持所有必要字段
    return {
        "messages": [response],  # add_messages 会自动合并
        "llm": llm,
        "mcp_client": state["mcp_client"],
        "available_tools": state.get("available_tools", []),
        "tool_outputs": state.get("tool_outputs", []),
        "first_llm_response": response,  # 新增字段
    }


############################################################################################################
async def _tool_parse_node(state: McpState) -> McpState:
    """
    工具解析节点：解析 LLM 响应中的工具调用

    messages 变化：无（只读取）

    Args:
        state: 当前状态

    Returns:
        McpState: 包含 parsed_tool_calls 和 needs_tool_execution
    """
    first_llm_response = state.get("first_llm_response")
    assert first_llm_response is not None, "first_llm_response 必须存在"

    available_tools = state.get("available_tools", [])
    parsed_tool_calls = []

    # 只有在有可用工具时才解析
    if available_tools:
        response_content = str(first_llm_response.content or "")

        # 使用增强的工具调用解析器（如果解析失败，让异常向上传播）
        parser = ToolCallParser(available_tools)
        parsed_tool_calls = parser.parse_tool_calls(response_content)

        # logger.info(f"📋 解析到 {len(parsed_tool_calls)} 个工具调用")
        # for call in parsed_tool_calls:
        #     logger.debug(f"   - {call['name']}: {call['args']}")

    # ✅ 保持所有必要字段
    return {
        "messages": state["messages"],
        "llm": state["llm"],
        "mcp_client": state["mcp_client"],
        "available_tools": available_tools,
        "tool_outputs": state.get("tool_outputs", []),
        "first_llm_response": first_llm_response,
        "parsed_tool_calls": parsed_tool_calls,  # 新增字段
        "needs_tool_execution": len(parsed_tool_calls) > 0,  # 新增字段
    }


############################################################################################################
async def _tool_execution_node(state: McpState) -> McpState:
    """
    工具执行节点：并发执行工具调用

    messages 变化：无（只读取）

    Args:
        state: 当前状态

    Returns:
        McpState: 包含 tool_outputs
    """
    parsed_tool_calls = state.get("parsed_tool_calls", [])
    mcp_client = state["mcp_client"]

    # 没有工具调用，返回空结果（但保持所有字段）
    if not parsed_tool_calls:
        return {
            "messages": state["messages"],
            "llm": state["llm"],
            "mcp_client": mcp_client,
            "available_tools": state.get("available_tools", []),
            "first_llm_response": state["first_llm_response"],
            "parsed_tool_calls": parsed_tool_calls,
            "needs_tool_execution": state.get("needs_tool_execution", False),
            "tool_outputs": [],
        }

    # 并发执行所有工具
    # logger.info(f"🔧 开始执行 {len(parsed_tool_calls)} 个工具调用")

    tasks = [
        execute_mcp_tool(
            call["name"],
            call["args"],
            mcp_client,
            timeout=30.0,
            max_retries=2,
        )
        for call in parsed_tool_calls
    ]

    # asyncio.gather 已经处理异常 (return_exceptions=True)
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 构建 tool_outputs
    tool_outputs = []
    for call, result in zip(parsed_tool_calls, results):
        if isinstance(result, Exception):
            logger.error(f"工具执行失败: {call['name']}, 错误: {result}")
            tool_outputs.append(
                {
                    "tool": call["name"],
                    "args": call["args"],
                    "result": f"执行失败: {str(result)}",
                    "success": False,
                    "execution_time": 0.0,
                }
            )
        elif isinstance(result, tuple) and len(result) == 3:
            success, task_result, exec_time = result
            tool_outputs.append(
                {
                    "tool": call["name"],
                    "args": call["args"],
                    "result": task_result,
                    "success": success,
                    "execution_time": exec_time,
                }
            )
        else:
            # 意外的结果类型，记录错误
            logger.error(f"工具返回意外结果类型: {call['name']}, 结果: {result}")
            tool_outputs.append(
                {
                    "tool": call["name"],
                    "args": call["args"],
                    "result": f"意外结果类型: {type(result)}",
                    "success": False,
                    "execution_time": 0.0,
                }
            )

    # 统计日志
    successful = sum(1 for o in tool_outputs if o["success"])
    total_time = sum(o["execution_time"] for o in tool_outputs)
    logger.info(
        f"✅ 工具执行完成: {successful}/{len(tool_outputs)} 成功, 总耗时: {total_time:.2f}s"
    )
    logger.debug(
        f"工具执行记录: {json.dumps(tool_outputs, indent=2, ensure_ascii=False)}"
    )

    # ✅ 保持所有必要字段
    return {
        "messages": state["messages"],
        "llm": state["llm"],
        "mcp_client": mcp_client,
        "available_tools": state.get("available_tools", []),
        "first_llm_response": state["first_llm_response"],
        "parsed_tool_calls": parsed_tool_calls,
        "needs_tool_execution": state.get("needs_tool_execution", False),
        "tool_outputs": tool_outputs,  # 更新字段
    }


############################################################################################################
def _build_tool_context(tool_outputs: List[Dict[str, Any]]) -> str:
    """
    构建工具执行结果的上下文字符串

    Args:
        tool_outputs: 工具执行结果列表

    Returns:
        str: 格式化的工具结果上下文
    """
    tool_context_parts = []
    for i, output in enumerate(tool_outputs, 1):
        tool_name = output.get("tool", "未知工具")
        success = output.get("success", False)
        result_data = output.get("result", "无结果")
        exec_time = output.get("execution_time", 0.0)

        status = "成功" if success else "失败"
        tool_context_parts.append(
            f"工具{i}: {tool_name} (执行{status}, 耗时{exec_time:.2f}s)\n"
            f"结果: {result_data}"
        )

    return "\n\n".join(tool_context_parts)


############################################################################################################
async def _llm_re_invoke_node(state: McpState) -> McpState:
    """
    二次推理节点：基于工具结果重新调用 LLM

    messages 变化：
    - 追加 AIMessage(工具结果)
    - 追加 HumanMessage(二次推理指令)
    - 追加 AIMessage(re_invoke_response)

    Args:
        state: 当前状态

    Returns:
        McpState: 包含 re_invoke_response
    """
    tool_outputs = state.get("tool_outputs", [])

    # 断言：此节点只应在有工具输出时被调用
    assert tool_outputs, "二次推理节点要求必须有工具输出"

    # 进行二次推理
    llm = state["llm"]

    # 构建工具结果上下文
    tool_context = _build_tool_context(tool_outputs)

    # 拆分消息：AIMessage(工具结果) + HumanMessage(约束和要求)
    tool_result_message = AIMessage(content=tool_context)

    # 使用默认二次推理指令或自定义指令
    instruction_content = state.get("re_invoke_instruction")
    if instruction_content is None:
        re_invoke_instruction = HumanMessage(content=DEFAULT_RE_INVOKE_INSTRUCTION)
    else:
        re_invoke_instruction = instruction_content

    # 直接修改 state["messages"]，添加工具结果和二次推理指令
    messages = state["messages"]
    messages.append(tool_result_message)
    messages.append(re_invoke_instruction)

    # 二次调用 LLM（异常向上传播）
    # logger.debug("🔄 开始二次推理，基于工具结果生成智能回答...")
    re_invoke_response = llm.invoke(messages)
    assert isinstance(
        re_invoke_response, AIMessage
    ), "二次推理返回必须是 AIMessage 类型"
    # logger.success("✅ 二次推理完成")

    # 将二次推理响应加入 messages，保持完整链路
    messages.append(re_invoke_response)

    # ✅ 保持所有必要字段
    return {
        "messages": messages,
        "llm": llm,
        "mcp_client": state["mcp_client"],
        "available_tools": state.get("available_tools", []),
        "tool_outputs": tool_outputs,
        "first_llm_response": state["first_llm_response"],
        "parsed_tool_calls": state.get("parsed_tool_calls", []),
        "needs_tool_execution": state.get("needs_tool_execution", False),
        "re_invoke_response": re_invoke_response,  # 新增字段
    }


############################################################################################################
def print_full_message_chain(state: McpState) -> None:
    """
    打印完整的消息链路，用于调试和追踪对话流程

    Args:
        state: 当前状态
    """
    messages = state.get("messages", [])
    logger.info(f"📜 完整消息链路 (共 {len(messages)} 条消息)")
    for i, msg in enumerate(messages, 0):
        logger.debug(
            f"[{i}] 完整内容:\n{msg.model_dump_json(indent=2, ensure_ascii=False)}\n"
        )


############################################################################################################
def _should_execute_tools(state: McpState) -> str:
    """
    条件路由：判断是否需要执行工具

    Args:
        state: 当前状态

    Returns:
        str: "tool_execution" 或 "__end__"
    """
    needs_tool_execution = state.get("needs_tool_execution", False)
    return "tool_execution" if needs_tool_execution else "__end__"


############################################################################################################
def create_mcp_workflow() -> CompiledStateGraph[McpState, Any, McpState, McpState]:
    """
    创建 MCP 工作流状态图

    工作流：
    preprocess → llm_invoke → tool_parse → [条件路由]
                                             ↓ (需要工具)
                                        tool_execution → llm_re_invoke → END
                                             ↓ (无需工具)
                                        END

    Returns:
        CompiledStateGraph: 编译后的状态图
    """

    # 构建多节点状态图
    graph_builder = StateGraph(McpState)

    # 添加各个节点
    graph_builder.add_node("preprocess", _preprocess_node)
    graph_builder.add_node("llm_invoke", _llm_invoke_node)
    graph_builder.add_node("tool_parse", _tool_parse_node)
    graph_builder.add_node("tool_execution", _tool_execution_node)
    graph_builder.add_node("llm_re_invoke", _llm_re_invoke_node)

    # 设置流程路径
    graph_builder.set_entry_point("preprocess")
    graph_builder.add_edge("preprocess", "llm_invoke")
    graph_builder.add_edge("llm_invoke", "tool_parse")

    # 条件路由：工具解析后判断是否需要执行工具
    graph_builder.add_conditional_edges(
        "tool_parse",
        _should_execute_tools,
        {
            "tool_execution": "tool_execution",  # 需要工具 → 工具执行
            "__end__": "__end__",  # 无需工具 → 直接结束
        },
    )

    # 工具执行后进入二次推理，然后结束
    graph_builder.add_edge("tool_execution", "llm_re_invoke")
    graph_builder.add_edge("llm_re_invoke", "__end__")

    return graph_builder.compile()  # type: ignore[return-value]


############################################################################################################
async def execute_mcp_workflow(
    work_flow: CompiledStateGraph[McpState, Any, McpState, McpState],
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
    mcp_client: McpClient,
    re_invoke_instruction: Optional[HumanMessage] = None,
) -> List[BaseMessage]:
    """
    执行 MCP 工作流

    返回逻辑：
    - 有工具执行 → 返回 re_invoke_response
    - 无工具执行 → 返回 first_llm_response

    Args:
        work_flow: 已编译的状态图
        context: 历史消息列表
        request: 用户当前输入
        llm: ChatDeepSeek 实例
        mcp_client: MCP 客户端实例
        re_invoke_instruction: 自定义二次推理指令（可选，默认使用内置模板）

    Returns:
        List[BaseMessage]: 响应消息列表
    """
    ret: List[BaseMessage] = []

    # 在函数内部获取可用工具列表
    available_tools = await mcp_client.list_tools()
    if available_tools is None:
        available_tools = []

    # 构造 McpState（context + [request] 创建新列表，避免修改传入参数）
    workflow_state: McpState = {
        "messages": context + [request],
        "llm": llm,
        "mcp_client": mcp_client,
        "available_tools": available_tools,
        "tool_outputs": [],
        "re_invoke_instruction": re_invoke_instruction,  # 直接传入，可能是 None
    }

    try:

        # 最终状态
        last_state: Optional[McpState] = None

        # 流式处理所有节点的更新
        async for event in work_flow.astream(workflow_state):
            for node_name, value in event.items():
                # 持续更新状态，最后一个就是最终状态
                last_state = value

        # 按顺序收集响应：[first_llm_response, re_invoke_response]
        # 外部使用 ret[-1] 获取最终响应
        if last_state:
            # 1. 先添加第一次推理结果（如果存在）
            first_llm_response = last_state.get("first_llm_response")
            if first_llm_response:
                assert isinstance(
                    first_llm_response, AIMessage
                ), "first_llm_response 必须是 AIMessage 类型"
                ret.append(first_llm_response)
                # logger.debug("📌 已收集 first_llm_response")

            # 2. 再添加二次推理结果（如果存在）
            re_invoke_response = last_state.get("re_invoke_response")
            if re_invoke_response:
                assert isinstance(
                    re_invoke_response, AIMessage
                ), "re_invoke_response 必须是 AIMessage 类型"
                ret.append(re_invoke_response)
                # logger.debug("📌 已收集 re_invoke_response")

            # 3. 日志：明确最终返回的是哪个
            # if re_invoke_response:
            #     logger.debug(
            #         "✅ 返回顺序: [first_llm_response, re_invoke_response]，使用 ret[-1] 获取二次推理结果"
            #     )
            # elif first_llm_response:
            #     logger.debug(
            #         "✅ 返回顺序: [first_llm_response]，使用 ret[-1] 获取第一次推理结果"
            #     )
            # else:
            #     logger.error("❌ 无可用响应，返回空列表")

            # 调试：打印完整消息链路
            print_full_message_chain(last_state)

        else:
            logger.error("❌ 未获取到最终状态")

    except Exception as e:
        logger.error(f"Stream processing error: {e}")

    return ret


############################################################################################################
