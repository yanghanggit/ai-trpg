"""
MCP Client Graph - 基于 LangGraph 的 MCP 工具调用工作流

## 工作流架构
preprocess → llm_invoke → tool_parse → [条件判断]
                                          ↓ (需要工具)
                                    tool_execution → llm_re_invoke → response_synthesis
                                          ↓ (不需要工具)
                                    response_synthesis

## 上下文变化链路（Context Chain）

### 核心改进：二次推理（Re-invoke）模式
让AI基于工具结果进行深度分析，而不是简单拼接。

### 上下文演变（6个阶段）
1. **初始上下文**: `context["messages"] + request["messages"]`
2. **预处理增强**: 添加工具指令 → 直接保存到 `messages`
3. **第一次推理**: LLM决定调用工具 → `llm_response`
4. **工具执行**: 并发执行工具 → `tool_outputs`
5. **二次推理** ⭐: 保持完整对话历史，追加工具结果
   ```
   [SystemMessage(角色), SystemMessage(工具说明),
    HumanMessage(用户问题1), AIMessage(AI回答1),  # ← 保留完整历史
    HumanMessage(用户问题2), AIMessage(AI回答2),  # ← 保留完整历史
    HumanMessage(当前问题), AIMessage(工具调用决策),
    AIMessage(工具执行结果)]  # ← 关键：使用AIMessage而非SystemMessage
   ```
6. **最终响应**: 基于完整上下文和工具结果的智能回答 → `final_response`

### 关键设计
- **消息类型**: 工具结果用 `AIMessage`（AI的观察）而非 `SystemMessage`
- **消息顺序**: 用户问题 → AI响应 → 工具结果（符合因果关系）
- **调试功能**: `_print_full_context_chain()` 打印完整链路（DEBUG级别）
"""

from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv()

import asyncio
from typing import Annotated, Any, Dict, List, Optional
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

    # 最终结果
    final_response: Optional[BaseMessage]  # 最终响应（来自二次推理或第一次推理）


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

    # 有工具时，才构建完整的工具调用说明
    tool_instruction_prompt = """当你需要获取实时信息或执行特定操作时，可以调用相应的工具。

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

    # 构建工具描述 - 简化版本，统一使用线性展示
    tool_instruction_prompt += "\n\n## 可用工具"

    # 直接列表展示所有工具，无需分类
    for tool in available_tools:
        tool_desc = format_tool_description_simple(tool)
        tool_instruction_prompt += f"\n{tool_desc}"

    # 添加工具调用示例
    example_tool = available_tools[0]
    tool_instruction_prompt += f"\n\n## 调用示例\n\n"
    tool_instruction_prompt += build_json_tool_example(example_tool)

    return tool_instruction_prompt


############################################################################################################
async def _preprocess_node(state: McpState) -> McpState:
    """
    预处理节点：准备系统提示和增强消息

    关键职责：直接修改 messages 上下文，注入工具说明
    后续节点只能读取 messages，不能再添加任何内容

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态
    """
    messages = state["messages"]
    available_tools = state.get("available_tools", [])

    # 构建系统提示
    tool_instruction_prompt = _build_tool_instruction_prompt(available_tools)
    logger.debug(f"🛠️ 工具指令提示:\n{tool_instruction_prompt}")

    # 智能添加系统消息：如果已有系统消息则追加，否则插入到开头
    enhanced_messages = messages.copy()
    if enhanced_messages and isinstance(enhanced_messages[0], SystemMessage):
        # 已经有系统消息在开头，追加新的工具说明
        enhanced_messages.insert(1, SystemMessage(content=tool_instruction_prompt))
    else:
        # 没有系统消息，插入默认角色设定和工具说明到开头
        default_role_prompt = (
            "你是一个智能助手，具有使用工具的能力。\n\n" + tool_instruction_prompt
        )
        enhanced_messages.insert(0, SystemMessage(content=default_role_prompt))

        # 走到这里基本就是错了，警告下，因为会影响角色设定！
        logger.warning(
            "⚠️ 系统消息缺失，已自动添加默认角色设定和工具说明，走到这里基本就是错了，警告下，因为会影响角色设定！"
        )

    # 关键改变：直接将增强后的消息保存到 messages 中
    result: McpState = {
        "messages": enhanced_messages,  # 直接保存增强后的消息
        "llm": state["llm"],
        "mcp_client": state["mcp_client"],
        "available_tools": available_tools,
        "tool_outputs": state.get("tool_outputs", []),
    }
    return result


############################################################################################################
async def _llm_invoke_node(state: McpState) -> McpState:
    """
    LLM调用节点：第一次推理，决定是否调用工具

    约束：
    - 正常时：设置 first_llm_response 并加入 messages
    - 异常时：让异常向上传播到 execute_mcp_workflow，final_response 保持 None

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态
    """
    llm = state["llm"]
    messages = state["messages"]

    # 调用 LLM（如果异常，直接向上传播）
    response = llm.invoke(messages)
    assert isinstance(response, AIMessage), "LLM 返回的响应必须是 AIMessage 类型"

    return {
        "messages": [response],  # 加入 messages，保持上下文连贯
        "first_llm_response": response,  # 保存引用供后续节点使用
    }


############################################################################################################
async def _tool_parse_node(state: McpState) -> McpState:
    """
    工具解析节点：解析LLM响应中的工具调用

    约束：
    - first_llm_response 必须存在（从 llm_invoke_node 传来）
    - 解析失败时异常向上传播

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态（仅包含 parsed_tool_calls 和 needs_tool_execution）
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

        logger.info(f"📋 解析到 {len(parsed_tool_calls)} 个工具调用")
        for call in parsed_tool_calls:
            logger.debug(f"   - {call['name']}: {call['args']}")

    # 只返回改变的字段，LangGraph 自动继承其他字段
    return {
        "parsed_tool_calls": parsed_tool_calls,
        "needs_tool_execution": len(parsed_tool_calls) > 0,
    }


############################################################################################################
async def _tool_execution_node(state: McpState) -> McpState:
    """
    工具执行节点：并发执行工具调用，返回执行结果

    核心职责：改变 tool_outputs 字段
    约束：
    - asyncio.gather(return_exceptions=True) 已处理单个工具异常
    - 异常向上传播到 execute_mcp_workflow

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态（仅包含 tool_outputs）
    """
    parsed_tool_calls = state.get("parsed_tool_calls", [])
    mcp_client = state["mcp_client"]

    # 没有工具调用，返回空结果
    if not parsed_tool_calls:
        return {"tool_outputs": []}

    # 并发执行所有工具
    logger.info(f"🔧 开始执行 {len(parsed_tool_calls)} 个工具调用")

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

    # 只返回改变的字段
    return {"tool_outputs": tool_outputs}


############################################################################################################
async def _llm_re_invoke_node(state: McpState) -> McpState:
    """
    二次推理节点：基于工具执行结果重新调用LLM进行智能分析

    这是新架构的核心节点，解决了工具结果只是简单拼接的问题。
    让AI能够基于工具结果进行深度分析和个性化回答。

    约束：只读取 messages，不添加任何内容

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态
    """
    try:
        llm = state["llm"]
        tool_outputs = state.get("tool_outputs", [])
        # 直接使用 messages（已在预处理中增强）
        original_messages = state["messages"]

        if not tool_outputs:
            # 没有工具输出，直接使用第一次推理响应
            original_response = state.get("first_llm_response")
            if original_response:
                no_tool_result: McpState = {
                    "messages": state["messages"],  # 保持不变
                    "llm": llm,
                    "mcp_client": state["mcp_client"],
                    "available_tools": state.get("available_tools", []),
                    "tool_outputs": [],
                    "final_response": original_response,  # 标记为最终响应
                }
                return no_tool_result

        # 构建包含工具结果的上下文消息
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

        tool_context = "\n\n".join(tool_context_parts)

        # 构建二次推理的提示（灵活处理，适用于游戏场景的多样化交互）
        tool_analysis_prompt = f"""
## 📊 工具执行结果

{tool_context}

---

## ⚠️ 约束条件

- **禁止再次调用工具** - 所有工具已执行完成
- **禁止输出工具调用格式** - 不要生成 {{"tool_call": ...}} 这样的JSON结构

## ✅ 响应要求

1. **内容**: 基于上述工具结果直接响应用户输入，保持你的角色设定和语言风格
2. **格式**: 如果用户明确要求特定输出格式(JSON/Markdown/表格等)，严格遵守
3. **风格**: 根据上下文灵活响应，无需解释工具调用过程

💡 **提示**: 用户输入可能是问题、指令、对话或行动描述，请自然地融合工具结果进行回应。"""

        # 创建二次推理的消息列表，保持完整的对话历史
        re_invoke_messages: List[BaseMessage] = []

        # 关键改进：保留完整的原始消息序列，维持对话连贯性
        # 不再选择性过滤消息类型，避免丢失历史 AIMessage
        # 原始消息包含：SystemMessage(角色+工具说明) + 完整的历史对话
        for msg in original_messages:
            re_invoke_messages.append(msg)

        # 注意：original_messages 通常不包含第一次 LLM 响应（first_llm_response）
        # 因为 original_messages 来自 messages（在预处理节点构建），
        # 不包括第一次 LLM 调用的结果
        # 因此我们需要显式添加第一次推理的响应

        # 检查是否需要添加第一次 LLM 响应（工具调用决策）
        # 这一步很重要：展示 AI 决定调用哪些工具的过程
        llm_first_response = state.get("first_llm_response")
        if llm_first_response:
            # 安全检查：确保不重复添加（虽然通常不会重复）
            if not re_invoke_messages or re_invoke_messages[-1] != llm_first_response:
                re_invoke_messages.append(llm_first_response)

        # 最后添加工具执行结果作为 AIMessage（而不是 SystemMessage）
        # 表示"AI观察到工具执行的结果"，而不是系统级指令
        # 这样保持了对话流的连贯性：历史对话 → User(问题) → AI(调用工具) → AI(观察结果) → AI(最终回答)
        re_invoke_messages.append(AIMessage(content=tool_analysis_prompt))

        # 二次调用 LLM
        logger.info("🔄 开始二次推理，基于工具结果生成智能回答...")
        re_invoke_response = llm.invoke(re_invoke_messages)

        logger.info("✅ 二次推理完成")

        re_invoke_result: McpState = {
            "messages": state["messages"],  # 保持不变，不添加内容
            "llm": llm,
            "mcp_client": state["mcp_client"],
            "available_tools": state.get("available_tools", []),
            "tool_outputs": tool_outputs,
            "final_response": re_invoke_response,  # 标记为最终响应
        }
        return re_invoke_result

    except Exception as e:
        logger.error(f"二次推理节点错误: {e}")
        # 降级处理：使用第一次推理响应合成
        original_response = state.get("first_llm_response")
        if original_response and state.get("tool_outputs"):
            from ..mcp.response import synthesize_response_with_tools

            synthesized_content = synthesize_response_with_tools(
                str(original_response.content) if original_response.content else "",
                state.get("tool_outputs", []),
                state.get("parsed_tool_calls", []),
            )
            original_response.content = synthesized_content

        error_fallback_response = original_response or AIMessage(
            content=f"抱歉，二次推理时发生错误：{str(e)}"
        )

        error_result: McpState = {
            "messages": state["messages"],  # 保持原消息不变
            "llm": state["llm"],
            "mcp_client": state["mcp_client"],
            "available_tools": state.get("available_tools", []),
            "tool_outputs": state.get("tool_outputs", []),
            "final_response": error_fallback_response,  # 添加 final_response
        }
        return error_result


############################################################################################################
############################################################################################################
async def _response_synthesis_node(state: McpState) -> McpState:
    """
    响应合成节点：处理最终响应输出

    根据设计哲学：
    1. 优先使用 final_response（来自二次推理）
    2. 如果没有 final_response，回退到 first_llm_response
    3. first_llm_response 必须存在（来自 llm_invoke_node）

    约束：
    - 只读取 messages，不添加任何内容
    - 所有 AIMessage 必须来自真实的 LLM 推理，不允许模拟

    Args:
        state: 当前状态

    Returns:
        McpState: 更新后的状态，包含 final_response
    """
    # 优先使用 final_response（来自二次推理或 llm_re_invoke 的 no_tool 分支）
    final_response = state.get("final_response")

    if final_response:
        # 已经有最终响应，直接返回
        return {
            "messages": [final_response],
            "final_response": final_response,
        }

    # 回退到 first_llm_response（未调用工具的情况）
    first_llm_response = state.get("first_llm_response")
    assert first_llm_response is not None, (
        "first_llm_response 必须存在。"
        "所有 AIMessage 必须来自真实的 LLM 推理，不允许模拟。"
    )

    # 使用第一次推理结果作为最终响应
    return {
        "messages": [first_llm_response],
        "final_response": first_llm_response,
    }


############################################################################################################
def _should_execute_tools(state: McpState) -> str:
    """
    条件路由：判断是否需要执行工具

    Args:
        state: 当前状态

    Returns:
        str: 下一个节点名称
    """
    needs_tool_execution = state.get("needs_tool_execution", False)
    return "tool_execution" if needs_tool_execution else "response_synthesis"


############################################################################################################
def create_mcp_workflow() -> CompiledStateGraph[McpState, Any, McpState, McpState]:
    """
    创建带 MCP 支持的编译状态图（多节点架构）

    Args:
        workflow_name: 工作流名称标识
        mcp_client: MCP客户端实例

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
    graph_builder.add_node("response_synthesis", _response_synthesis_node)

    # 设置流程路径
    graph_builder.set_entry_point("preprocess")
    graph_builder.add_edge("preprocess", "llm_invoke")
    graph_builder.add_edge("llm_invoke", "tool_parse")

    # 添加条件路由：工具解析后判断是否需要执行工具
    graph_builder.add_conditional_edges(
        "tool_parse",
        _should_execute_tools,
        {
            "tool_execution": "tool_execution",
            "response_synthesis": "response_synthesis",
        },
    )

    # 新架构：工具执行后进入二次推理
    graph_builder.add_edge("tool_execution", "llm_re_invoke")

    # 二次推理后直接到响应合成
    graph_builder.add_edge("llm_re_invoke", "response_synthesis")

    graph_builder.set_finish_point("response_synthesis")

    return graph_builder.compile()  # type: ignore[return-value]


############################################################################################################
async def execute_mcp_workflow(
    work_flow: CompiledStateGraph[McpState, Any, McpState, McpState],
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
    mcp_client: McpClient,
) -> List[BaseMessage]:
    """执行MCP工作流并返回所有响应消息

    将聊天历史和用户输入合并后，通过编译好的状态图进行MCP工具调用处理，
    收集并返回所有生成的消息。McpState 的创建被封装在函数内部。

    Args:
        work_flow: 已编译的 LangGraph 状态图
        context: 历史消息列表
        request: 用户当前输入的消息
        llm: ChatDeepSeek LLM 实例
        mcp_client: MCP 客户端实例

    Returns:
        包含所有生成消息的列表
    """
    ret: List[BaseMessage] = []

    # 在函数内部获取可用工具列表
    available_tools = await mcp_client.list_tools()
    if available_tools is None:
        available_tools = []

    # 在内部构造 McpState（封装实现细节）
    merged_message_context: McpState = {
        "messages": context + [request],
        "llm": llm,
        "mcp_client": mcp_client,
        "available_tools": available_tools,
        "tool_outputs": [],
    }

    try:

        # 最终状态
        final_state = None

        # 流式处理所有节点的更新
        async for event in work_flow.astream(merged_message_context):
            for node_name, value in event.items():
                # 持续更新状态，最后一个就是最终状态
                final_state = value

        # ✅ 关键改进：从最终状态的 final_response 字段获取结果，不依赖节点名称
        if final_state:
            final_response = final_state.get("final_response")
            if final_response:
                logger.info("✅ 从状态的 final_response 字段获取最终响应")
                ret.append(final_response)
            else:
                logger.error(
                    "❌ final_response 不存在，这不应该发生（所有节点都应该设置 final_response）"
                )
        else:
            logger.error("❌ 未获取到最终状态")

    except Exception as e:
        logger.error(f"Stream processing error: {e}")

    return ret


############################################################################################################
