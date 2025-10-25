# MCP 三大特性设计理念深度分析

> **创建日期**: 2025年10月25日  
> **分析目标**: 理解 MCP (Model Context Protocol) 中 Tools、Resources、Prompts 的设计意图和使用场景

---

## 核心问题

在实现 `_build_tool_instruction_prompt` 时，我们发现它的目的是让 LLM **主动使用 tool**。  
这引发了一个关键疑问：

> **为什么不能让 LLM 主动读取 resource 与 prompt 呢？**  
> **Resources 和 Prompts 被设计出来是给 LLM 用的，还是给与 MCP Client 交互的开发者/用户用的？**

通过深入研究 MCP 官方规范，我们找到了明确的答案。

---

## 一、三大特性的设计定位

### 对比表格

| 特性 | 控制权 | 自动化程度 | 设计意图 | 典型用例 |
|------|--------|------------|----------|----------|
| **Tools** | **LLM 控制** | ⭐⭐⭐ 高 | Model-Controlled | 搜索航班、发送邮件、创建日历事件 |
| **Resources** | **应用程序驱动** | ⭐⭐ 中 | Application-Driven | 文件内容、数据库模式、API 文档 |
| **Prompts** | **用户控制** | ⭐ 低 | User-Controlled | 工作流模板、最佳实践指南 |

---

## 二、Tools (工具) - Model-Controlled

### 官方定义

> "Tools are **model-controlled**, meaning AI models can discover and invoke them automatically."

### 核心特征

- ✅ **LLM 主动调用** - 根据对话上下文自动决定是否使用
- ✅ **执行动作** - 改变系统状态、操作外部资源
- ✅ **需要指导** - 在系统提示中教 LLM 如何使用
- ⚠️ **需要用户授权** - 可能需要用户批准才能执行

### 典型工作流程

```python
# LLM 主导流程：
1. 系统提示包含可用工具的描述和调用格式
2. LLM 分析用户请求，判断是否需要使用工具
3. LLM 生成工具调用指令（JSON 格式）
4. 应用程序解析并执行工具调用
5. 工具执行结果返回给 LLM
6. LLM 基于结果生成回答
```

### 代码示例

```python
def _build_tool_instruction_prompt(available_tools: List[McpToolInfo]) -> str:
    """
    构建系统提示，教 LLM 如何使用工具
    这是正确的做法，因为 Tools 设计为 Model-Controlled
    """
    tool_instruction_prompt = """当你需要获取实时信息或执行特定操作时，可以调用相应的工具。

## 工具调用格式
请严格按照以下JSON格式调用工具：
{
  "tool_call": {
    "name": "工具名称",
    "arguments": {"参数名": "参数值"}
  }
}
"""
    return tool_instruction_prompt
```

### 使用场景示例

```python
# 用户: "帮我搜索从纽约到巴塞罗那的航班"
# LLM 自动调用:
{
  "tool_call": {
    "name": "searchFlights",
    "arguments": {
      "origin": "NYC",
      "destination": "Barcelona",
      "date": "2024-06-15"
    }
  }
}
```

---

## 三、Resources (资源) - Application-Driven

### Resources 的官方定义

> "Resources in MCP are designed to be **application-driven**, with host applications determining how to incorporate context based on their needs."

### Resources 的核心特征

- ✅ **应用程序主导** - 由 MCP Client 决定何时读取、如何处理
- ✅ **提供上下文** - 为 LLM 提供被动的背景信息
- ✅ **只读数据** - 不改变状态，只提供信息
- ❌ **LLM 不主动调用** - LLM 无法自己决定读取哪些资源

### Resources 的设计理由

1. **资源可能很大** - 需要应用程序智能处理（embedding、搜索、过滤）
2. **成本控制** - 避免 LLM 无限制读取所有资源
3. **性能优化** - 应用程序可以缓存、预处理资源
4. **灵活性** - 应用程序可以根据上下文动态选择资源

### Resources 的典型工作流程

```python
# 应用程序主导流程：
1. 应用程序列出可用资源 (resources/list)
2. 应用程序/用户选择需要的资源
3. 应用程序读取资源内容 (resources/read)
4. 应用程序处理资源（可选）:
   - 使用 embedding 进行语义搜索
   - 过滤不相关内容
   - 提取关键信息
5. 应用程序将处理后的内容作为上下文提供给 LLM
```

### UI 交互模式

根据规范，应用程序可以通过多种方式暴露资源：

- 🌲 **树形/列表视图** - 类似文件浏览器
- 🔍 **搜索和过滤界面** - 快速查找特定资源
- 🤖 **自动包含** - 基于启发式或 AI 选择
- 📋 **手动/批量选择** - 用户明确选择多个资源

### Resources 的代码示例

```python
# ❌ 错误做法：让 LLM 主动调用 resource
# 不要在系统提示中教 LLM 如何读取 resource

# ✅ 正确做法：应用程序主导
async def provide_context_to_llm(user_query: str):
    # 1. 应用程序分析用户查询
    # 2. 应用程序决定需要哪些资源
    relevant_resources = await select_relevant_resources(user_query)
    
    # 3. 应用程序读取资源
    resource_contents = []
    for resource_uri in relevant_resources:
        content = await mcp_client.read_resource(resource_uri)
        resource_contents.append(content)
    
    # 4. 应用程序将资源作为上下文提供给 LLM
    context = "\n\n".join(resource_contents)
    messages = [
        SystemMessage(content=f"以下是相关背景信息：\n{context}"),
        HumanMessage(content=user_query)
    ]
    
    return await llm.invoke(messages)
```

### Resources 的使用场景示例

```python
# 旅行规划场景
resources = [
    "calendar://events/2024",           # 日历可用性
    "file:///Documents/passport.pdf",   # 护照文档
    "trips://history/barcelona-2023"    # 历史行程
]

# 应用程序读取并提供给 LLM
for uri in resources:
    content = await mcp_client.read_resource(uri)
    # 处理并添加到 LLM 上下文
```

---

## 四、Prompts (提示模板) - User-Controlled

### Prompts 的官方定义

> "Prompts are designed to be **user-controlled**, meaning they are exposed from servers to clients with the intention of the **user being able to explicitly select them** for use."

### Prompts 的核心特征

- ✅ **用户明确选择** - 需要用户主动触发
- ✅ **工作流模板** - 提供结构化的交互模式
- ✅ **参数化** - 支持自定义参数
- ❌ **LLM 不主动调用** - LLM 无法自己决定使用哪个 prompt

### Prompts 的设计理由

1. **用户意图** - Prompts 代表用户的工作流和意图
2. **可控性** - 用户应该决定何时使用何种工作流
3. **透明性** - 用户可以看到 prompt 的内容和效果
4. **一致性** - 确保相同的任务使用相同的流程

### Prompts 的典型工作流程

```python
# 用户主导流程：
1. 用户在 UI 中看到可用的 prompt 列表（如 /plan-vacation）
2. 用户主动选择一个 prompt
3. 用户提供 prompt 需要的参数：
   - destination: "Barcelona"
   - duration: 7
   - budget: 3000
4. 应用程序获取 prompt 内容 (prompts/get)
5. 应用程序将 prompt 内容发送给 LLM
6. LLM 基于 prompt 模板生成响应
```

### Prompts 的 UI 交互模式

根据规范，prompts 通常通过以下方式暴露：

- ⚡ **斜杠命令** - 输入 `/` 查看可用 prompts（如 `/plan-vacation`）
- 🎨 **命令面板** - 可搜索的命令列表
- 🔘 **UI 按钮** - 常用 prompts 的快捷按钮
- 📝 **上下文菜单** - 根据上下文推荐相关 prompts

### Prompts 的代码示例

```python
# ❌ 错误做法：让 LLM 主动选择 prompt
# 不要在系统提示中教 LLM 如何获取 prompt

# ✅ 正确做法：用户通过 UI 选择
@app.prompt()
async def plan_vacation() -> types.GetPromptResult:
    """
    用户通过 UI 选择这个 prompt
    例如：用户输入 /plan-vacation 或点击按钮
    """
    prompt_template = """# 度假规划助手

## 任务
根据以下信息，帮助用户规划一次完美的度假：

- 目的地：{destination}
- 出发日期：{departure_date}
- 返回日期：{return_date}
- 预算：${budget}
- 旅行人数：{travelers}

## 步骤
1. 检查日历可用性
2. 搜索航班选项
3. 查找住宿
4. 推荐活动和景点
5. 创建详细行程"""

    return types.GetPromptResult(
        description="度假规划工作流",
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=prompt_template)
            )
        ]
    )
```

### Prompts 的使用场景示例

```python
# 用户在 UI 中输入 /plan-vacation
# 应用程序展示参数输入界面
parameters = {
    "destination": "Barcelona",
    "departure_date": "2024-06-15",
    "return_date": "2024-06-22",
    "budget": 3000,
    "travelers": 2
}

# 应用程序获取 prompt 并填充参数
prompt_result = await mcp_client.get_prompt(
    name="plan-vacation",
    arguments=parameters
)

# 将 prompt 发送给 LLM
messages = prompt_result.messages
response = await llm.invoke(messages)
```

---

## 五、完整的协同工作流程

### 旅行规划场景示例

结合三大特性的完整流程：

```python
# 1️⃣ 用户通过 UI 触发 Prompt
用户操作: 在聊天界面输入 /plan-vacation
应用程序: 展示参数输入表单
用户填写: {
    "destination": "Barcelona",
    "departure_date": "2024-06-15",
    "return_date": "2024-06-22",
    "budget": 3000,
    "travelers": 2
}

# 2️⃣ 应用程序选择并读取相关 Resources
应用程序逻辑:
- 分析 prompt 参数
- 确定需要的背景信息
- 读取相关资源:
  resources = [
      "calendar://my-calendar/June-2024",
      "travel://preferences/europe",
      "travel://past-trips/Spain-2023"
  ]
  
  context = ""
  for uri in resources:
      content = await mcp_client.read_resource(uri)
      context += f"\n{content}"

# 3️⃣ LLM 分析需求，主动调用 Tools
LLM 思考: "用户想去巴塞罗那，我需要搜索航班和酒店"

LLM 生成工具调用:
{
  "tool_call": {
    "name": "searchFlights",
    "arguments": {
      "origin": "NYC",
      "destination": "Barcelona",
      "date": "2024-06-15"
    }
  }
}

{
  "tool_call": {
    "name": "searchHotels",
    "arguments": {
      "city": "Barcelona",
      "checkIn": "2024-06-15",
      "checkOut": "2024-06-22",
      "budget": 1500
    }
  }
}

# 4️⃣ 应用程序执行工具并返回结果
应用程序:
- 解析工具调用
- 执行 MCP 工具
- 收集执行结果

# 5️⃣ LLM 综合所有信息生成最终回答
LLM 输入:
- Prompt 模板（用户意图）
- Resources 内容（背景信息）
- Tools 执行结果（实时数据）

LLM 输出:
"根据您的需求，我为您找到了以下选项：
- 航班：[具体航班信息]
- 酒店：[具体酒店推荐]
- 行程：[根据历史偏好和天气的详细规划]"
```

---

## 六、架构设计的智慧

### 为什么要这样设计？

#### 1. **分层控制权**

```text
用户层 (User Layer)
  ↓ 选择工作流
Prompts - 用户决定使用哪个工作流模板
  ↓
应用程序层 (Application Layer)
  ↓ 管理数据
Resources - 应用决定提供哪些背景信息
  ↓
AI 层 (AI Layer)
  ↓ 执行动作
Tools - AI 决定调用哪些工具
```

#### 2. **避免的问题**

| 如果让 LLM 控制一切 | 后果 |
|---------------------|------|
| LLM 主动读取所有 Resources | 💸 成本爆炸、⏱️ 性能下降 |
| LLM 自主选择 Prompts | 🎯 偏离用户意图、🔀 工作流混乱 |
| 缺少 Tools 的自动化 | 🤷 频繁打断用户、📉 体验下降 |

#### 3. **职责边界清晰**

```python
# ✅ 清晰的职责划分

# 用户职责：决定做什么
user_choice = select_prompt("/plan-vacation")

# 应用程序职责：准备数据
context = prepare_resources(user_choice)

# AI 职责：执行和分析
ai_actions = llm_decides_tools(user_choice, context)
```

---

## 七、实战建议

### 如果真的需要让 LLM "感知" Resources 或 Prompts？

虽然不推荐，但如果确实有需求，可以通过以下方式：

#### 方案 1: 将 Resource 包装为 Tool

```python
@app.tool()
async def read_game_resource(resource_name: str) -> str:
    """
    允许 LLM 通过 tool 读取特定游戏资源
    
    注意：这偏离了 MCP 设计初衷，应谨慎使用
    """
    # 映射资源名称到 URI
    resource_map = {
        "世界": "game://dynamic/测试世界",
        "森林": "game://dynamic/神秘森林",
        "城堡": "game://dynamic/古老城堡"
    }
    
    uri = resource_map.get(resource_name)
    if not uri:
        return f"未找到名为 '{resource_name}' 的资源"
    
    content = await mcp_client.read_resource(uri)
    return content.text if content else "资源读取失败"
```

#### 方案 2: 在系统提示中包含 Prompt 列表

```python
system_prompt = """你是一个智能助手。

可用的工作流模板：
1. /plan-vacation - 度假规划
2. /code-review - 代码审查
3. /debug-analysis - 调试分析

当用户需要这些工作流时，建议他们使用对应的命令。"""
```

#### ⚠️ 警告

这些方法会：

- 🔴 偏离 MCP 设计理念
- 🔴 增加系统复杂性
- 🔴 可能导致意外行为
- 🔴 难以维护和调试

---

## 八、关键要点总结

### 🎯 核心原则

1. **Tools** = LLM 的"手"
   - LLM 主动调用
   - 执行具体动作
   - 需要在系统提示中说明

2. **Resources** = LLM 的"眼"
   - 应用程序提供
   - 作为背景信息
   - 智能处理和过滤

3. **Prompts** = 用户的"声音"
   - 用户明确选择
   - 定义工作流
   - 通过 UI 触发

### 📊 决策树

```text
需要 AI 执行动作？
  ├─ 是 → 使用 Tools（教 LLM 如何调用）
  └─ 否 → 需要背景信息？
         ├─ 是 → 使用 Resources（应用程序提供）
         └─ 否 → 需要工作流模板？
                ├─ 是 → 使用 Prompts（用户选择）
                └─ 否 → 直接对话
```

### 💡 最佳实践

```python
# ✅ 推荐的实现模式

class MCPEnhancedApplication:
    """正确使用 MCP 三大特性的示例"""
    
    def __init__(self):
        self.mcp_client = McpClient(...)
        self.llm = ChatDeepSeek(...)
    
    async def handle_user_request(self, user_input: str):
        # 1. 检查是否是 prompt 命令
        if user_input.startswith('/'):
            prompt_result = await self._handle_prompt(user_input)
            user_input = prompt_result.messages[0].content.text
        
        # 2. 应用程序决定需要的 resources
        resources = await self._select_relevant_resources(user_input)
        resource_context = await self._load_resources(resources)
        
        # 3. 构建包含 tools 说明的系统提示
        tools = await self.mcp_client.list_tools()
        tool_instruction = self._build_tool_instruction(tools)
        
        # 4. 发送给 LLM（LLM 会自动决定是否调用 tools）
        messages = [
            SystemMessage(content=tool_instruction),
            SystemMessage(content=f"背景信息：\n{resource_context}"),
            HumanMessage(content=user_input)
        ]
        
        response = await self.llm.invoke(messages)
        
        # 5. 如果 LLM 调用了 tools，执行并二次推理
        if self._has_tool_calls(response):
            tool_results = await self._execute_tools(response)
            final_response = await self._llm_re_invoke(tool_results)
            return final_response
        
        return response
    
    async def _handle_prompt(self, command: str):
        """用户选择的 prompt"""
        prompt_name = command[1:]  # 移除 '/'
        return await self.mcp_client.get_prompt(prompt_name)
    
    async def _select_relevant_resources(self, query: str):
        """应用程序决定的 resources"""
        # 基于查询内容智能选择资源
        all_resources = await self.mcp_client.list_resources()
        return self._filter_resources(all_resources, query)
    
    def _build_tool_instruction(self, tools):
        """构建 tools 使用说明（供 LLM 使用）"""
        return _build_tool_instruction_prompt(tools)
```

---

## 九、参考资料

### 官方文档链接

- [MCP Architecture Overview](https://modelcontextprotocol.io/docs/learn/architecture)
- [Server Concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [Resources Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [Prompts Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)
- [Tools Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

### 关键引用

#### Resources 是 Application-Driven

> "Resources in MCP are designed to be **application-driven**, with host applications determining how to incorporate context based on their needs."

#### Prompts 是 User-Controlled

> "Prompts are designed to be **user-controlled**, meaning they are exposed from servers to clients with the intention of the **user being able to explicitly select them** for use."

#### Tools 是 Model-Controlled

> "Tools are **model-controlled**, meaning AI models can discover and invoke them automatically."

---

## 十、总结

MCP 的三层设计体现了深刻的架构智慧：

1. **权责分明** - 用户、应用程序、AI 各司其职
2. **安全可控** - 不同层次的自主权有明确边界
3. **高效灵活** - 在自动化和控制之间找到平衡
4. **可扩展性** - 清晰的职责划分便于系统演进

**核心启示**：

- ✅ 在系统提示中教 LLM 使用 **Tools** - 这是正确的！
- ❌ 不要让 LLM 主动调用 **Resources** - 应用程序管理
- ❌ 不要让 LLM 自主选择 **Prompts** - 用户决定

这种设计确保了 AI 系统既能发挥自主性（通过 Tools），又保持了必要的控制权（通过 Resources 和 Prompts），是一个非常优雅的架构解决方案。

---

**最后的建议**：在设计你的 MCP 应用时，始终问自己三个问题：

1. 这个功能应该由 **谁** 来控制？（用户 / 应用 / AI）
2. 这个功能的 **目的** 是什么？（执行动作 / 提供信息 / 定义流程）
3. 这个功能需要 **多大** 的自主性？（自动 / 半自动 / 手动）

根据答案选择合适的 MCP 特性，你的架构会更加清晰和可维护！
