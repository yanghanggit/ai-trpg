# MCP工具调用解析机制深度分析

## 📅 文档信息

- **创建日期**: 2025年11月6日
- **相关文件**: 
  - `src/ai_trpg/deepseek/mcp_client_graph.py`
  - `src/ai_trpg/mcp/parser.py`
- **分析范围**: 工具调用提示词设计 + JSON解析算法实现

---

## 🎯 核心问题

**如何让 AI 以标准化格式调用工具，同时保持足够的容错能力？**

解决方案：

1. **提示词层面**：通过 `TOOL_CALL_INSTRUCTION` 明确规定 JSON 格式
2. **解析器层面**：通过 `ToolCallParser` 智能提取和验证工具调用

---

## 📝 第一部分：TOOL_CALL_INSTRUCTION 提示词设计

### 完整提示词结构

```python
TOOL_CALL_INSTRUCTION: Final[str] = """当你需要获取实时信息或执行特定操作时，可以调用相应的工具。

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
```

### 设计意图分析

#### 1. **明确触发条件**
```
"当你需要获取实时信息或执行特定操作时"
```
- 让 AI 理解何时需要工具
- 避免不必要的工具调用
- 聚焦在需要外部能力的场景

#### 2. **强制标准化格式**
```json
{
  "tool_call": {
    "name": "工具名称",
    "arguments": {...}
  }
}
```
- **为什么用嵌套结构？**
  - 更容易通过关键字 `"tool_call"` 定位
  - 避免与普通 JSON 数据混淆
  - 提供清晰的语义边界

#### 3. **支持批量调用**
```
支持同时调用多个
```
- 通过多个独立 JSON 对象实现
- 不使用数组包装（简化解析）
- AI 可以一次性完成多个任务

#### 4. **防止 AI 幻觉**
```
❌ 不要在未调用工具的情况下假设或推测工具执行结果
```
- 这是关键的约束
- 防止 AI 编造工具返回结果
- 确保信息的真实性

---

## 🔧 第二部分：ToolCallParser 解析器实现

### 类结构概览

```python
class ToolCallParser:
    def __init__(self, available_tools: List[McpToolInfo]):
        self.available_tools = available_tools
        self.tool_names: Set[str] = {tool.name for tool in available_tools}
    
    def parse_tool_calls(self, content: str) -> List[Dict[str, Any]]:
        """主入口：解析 LLM 响应内容"""
        parsed_calls = []
        parsed_calls.extend(self._parse_json_format(content))
        return self._deduplicate_and_validate(parsed_calls)
```

### 核心算法：_parse_json_format

#### 算法步骤详解

##### 步骤1：定位所有 "tool_call" 关键字

```python
tool_call_positions = []
start_pos = 0
while True:
    pos = content.find('"tool_call"', start_pos)
    if pos == -1:
        break
    tool_call_positions.append(pos)
    start_pos = pos + 1
```

**为什么这样做？**
- 通过关键字快速定位可能的工具调用
- 支持在长文本中提取多个工具调用
- 避免从头到尾解析整个字符串

**示例**：
```text
content = """
我会帮你查询。
{
  "tool_call": {
    "name": "get_weather",
    "arguments": {"city": "北京"}
  }
}
然后再查询时间。
{
  "tool_call": {
    "name": "get_time",
    "arguments": {}
  }
}
"""
# 会找到两个位置：pos1, pos2
```

##### 步骤2：向前查找最近的左括号

```python
for pos in tool_call_positions:
    start_brace = content.rfind("{", 0, pos)
    if start_brace == -1:
        continue
```

**为什么向前找？**
- JSON 对象必须以 `{` 开始
- 从 "tool_call" 向前找最近的 `{` 就是 JSON 起点
- `rfind` 确保找到的是最近的一个

**示例**：
```text
一些文本 { "tool_call": { "name": "xxx" ...
         ↑
    start_brace
```

##### 步骤3：括号匹配找到完整 JSON

```python
brace_count = 0
json_end = start_brace
for i in range(start_brace, len(content)):
    if content[i] == "{":
        brace_count += 1
    elif content[i] == "}":
        brace_count -= 1
        if brace_count == 0:  # 找到匹配的右括号
            json_end = i + 1
            break
```

**括号计数算法原理**：

```
{                     brace_count = 1
  "tool_call": {      brace_count = 2
    "name": "xxx",    
    "arguments": {    brace_count = 3
      "key": "val"
    }                 brace_count = 2
  }                   brace_count = 1
}                     brace_count = 0 ← 找到了！
```

**为什么可靠？**
- 处理嵌套结构（arguments 里还可以有对象）
- 不受字符串内容影响（只计数括号）
- 找到的一定是完整、平衡的 JSON

##### 步骤4：提取并解析 JSON

```python
if brace_count == 0:  # 确保找到了完整 JSON
    json_str = content[start_brace:json_end]
    try:
        json_obj = json.loads(json_str)
        call = self._json_to_tool_call(json_obj)
        if call:
            calls.append(call)
    except json.JSONDecodeError:
        logger.warning(f"JSON格式错误，跳过此工具调用: {json_str}")
        continue
```

**容错处理**：
- 解析失败只警告，不中断
- 继续处理下一个工具调用
- 确保部分错误不影响整体

---

## 📊 支持的格式全景图

### ✅ 支持的格式类型

#### 格式1：标准单个工具调用

```json
{
  "tool_call": {
    "name": "get_weather",
    "arguments": {
      "city": "北京",
      "unit": "celsius"
    }
  }
}
```

#### 格式2：多个工具调用（连续 JSON）

```json
{
  "tool_call": {
    "name": "get_weather",
    "arguments": {"city": "北京"}
  }
}

{
  "tool_call": {
    "name": "get_time",
    "arguments": {}
  }
}

{
  "tool_call": {
    "name": "calculate",
    "arguments": {"expression": "100 + 200"}
  }
}
```

**解析结果**：
```python
[
    {"name": "get_weather", "args": {"city": "北京"}},
    {"name": "get_time", "args": {}},
    {"name": "calculate", "args": {"expression": "100 + 200"}}
]
```

#### 格式3：混合在文本中

```text
我需要帮你查询天气。

{
  "tool_call": {
    "name": "get_weather",
    "arguments": {
      "city": "上海"
    }
  }
}

查询完成后，我会告诉你结果。
```

**为什么支持这种格式？**
- AI 可以边解释边调用工具
- 更自然的对话体验
- 解析器只提取 JSON 部分

#### 格式4：在 Markdown 代码块中

````markdown
我将使用以下工具查询：

```json
{
  "tool_call": {
    "name": "database_query",
    "arguments": {
      "sql": "SELECT * FROM users",
      "limit": 10
    }
  }
}
```

这样可以获取数据。
````

**解析能力**：
- 代码块标记 ` ```json` 不影响
- 依然能正确提取 JSON
- 因为解析器基于关键字 + 括号匹配

#### 格式5：复杂嵌套参数

```json
{
  "tool_call": {
    "name": "create_task",
    "arguments": {
      "title": "完成报告",
      "details": {
        "description": "写一份技术分析报告",
        "deadline": "2025-11-10",
        "tags": ["urgent", "tech"]
      },
      "assignee": {
        "name": "张三",
        "email": "zhangsan@example.com"
      }
    }
  }
}
```

**括号匹配算法自动处理嵌套**：
```
{                           count = 1
  "tool_call": {            count = 2
    ...
    "arguments": {          count = 3
      ...
      "details": {          count = 4
        ...
      }                     count = 3
      "assignee": {         count = 4
        ...
      }                     count = 3
    }                       count = 2
  }                         count = 1
}                           count = 0 ← 完整提取
```

---

## ❌ 不支持的格式及原因

### 格式1：缺少 tool_call 包装

```json
{
  "name": "get_weather",
  "arguments": {"city": "北京"}
}
```

**为什么不支持？**
- 缺少 `"tool_call"` 关键字
- 解析器第一步就无法定位
- 容易与普通 JSON 数据混淆

### 格式2：数组包装格式

```json
[
  {
    "tool_call": {
      "name": "tool1",
      "arguments": {}
    }
  },
  {
    "tool_call": {
      "name": "tool2",
      "arguments": {}
    }
  }
]
```

**为什么不支持？**
- 解析器针对独立 JSON 对象设计
- 虽然技术上可以支持，但提示词没有要求这种格式
- 保持简单一致的格式标准

### 格式3：嵌套在其他结构中

```json
{
  "response": "好的，我来帮你查询",
  "action": {
    "tool_call": {
      "name": "get_weather",
      "arguments": {"city": "北京"}
    }
  }
}
```

**为什么不支持？**
- `_json_to_tool_call` 只检查顶层的 `tool_call`
- 嵌套的 `tool_call` 会被忽略
- 避免复杂的递归解析逻辑

### 格式4：字符串形式的 JSON

```json
{
  "tool_call": "{\"name\": \"get_weather\", \"arguments\": {\"city\": \"北京\"}}"
}
```

**为什么不支持？**
- `tool_call` 的值必须是对象，不能是字符串
- `_json_to_tool_call` 期望 `tool_call_obj.get("name")`
- 需要二次 JSON 解析，增加复杂度

---

## 🔍 验证和去重机制

### 去重算法

```python
def _deduplicate_and_validate(self, calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    unique_calls = []
    
    for call in calls:
        # 创建唯一标识：(工具名, 参数JSON)
        call_id = (call["name"], json.dumps(call["args"], sort_keys=True))
        if call_id not in seen:
            seen.add(call_id)
            if self._validate_tool_call(call):
                unique_calls.append(call)
    
    return unique_calls
```

**为什么需要去重？**
- AI 可能重复生成相同的工具调用
- 避免执行重复的操作
- 提升效率

**唯一标识设计**：
```python
call_id = (call["name"], json.dumps(call["args"], sort_keys=True))
```
- 工具名 + 参数内容的组合
- `sort_keys=True` 确保参数顺序不影响
- 例如：`("get_weather", '{"city":"北京"}')`

### 验证机制

```python
def _validate_tool_call(self, call: Dict[str, Any]) -> bool:
    tool_name = call["name"]
    tool_args = call["args"]
    
    # 1. 检查工具是否存在
    tool_info = None
    for tool in self.available_tools:
        if tool.name == tool_name:
            tool_info = tool
            break
    
    if not tool_info:
        return False
    
    # 2. 验证必需参数
    if tool_info.input_schema:
        required_params = tool_info.input_schema.get("required", [])
        for param in required_params:
            if param not in tool_args:
                logger.warning(f"工具 {tool_name} 缺少必需参数: {param}")
                return False
    
    return True
```

**验证层次**：
1. **工具存在性验证**：工具名是否在可用列表中
2. **参数完整性验证**：必需参数是否都提供了
3. **日志记录**：记录验证失败原因

---

## 🔄 工作流集成

### 在 mcp_client_graph.py 中的使用

```python
async def _tool_parse_node(state: McpState) -> McpState:
    """工具解析节点"""
    first_llm_response = state.get("first_llm_response")
    available_tools = state.get("available_tools", [])
    parsed_tool_calls = []
    
    if available_tools:
        response_content = str(first_llm_response.content or "")
        
        # 🔧 核心调用：创建解析器并解析
        parser = ToolCallParser(available_tools)
        parsed_tool_calls = parser.parse_tool_calls(response_content)
    
    return {
        # ... 状态更新
        "parsed_tool_calls": parsed_tool_calls,
        "needs_tool_execution": len(parsed_tool_calls) > 0,
    }
```

### 完整的工作流

```
1. preprocess_node
   ↓ 注入 TOOL_CALL_INSTRUCTION
   
2. llm_invoke_node
   ↓ AI 生成响应（可能包含工具调用）
   
3. tool_parse_node  ← 🎯 解析器在这里工作
   ↓ 提取并验证工具调用
   
4. [条件路由]
   ↓ 有工具调用？
   
5. tool_execution_node
   ↓ 并发执行工具
   
6. llm_re_invoke_node
   ↓ 基于工具结果二次推理
   
7. END
```

---

## 💡 设计亮点总结

### 1. **提示词与解析器的协同设计**

| 维度 | 提示词层面 | 解析器层面 |
|------|-----------|-----------|
| 格式规范 | 明确要求 JSON 格式 | 严格验证结构 |
| 批量支持 | 允许多个独立 JSON | 自动提取所有 |
| 容错能力 | 允许混在文本中 | 基于关键字定位 |
| 防止错误 | 禁止假设结果 | 验证参数完整性 |

### 2. **算法优势**

✅ **关键字定位 + 括号匹配**
- 不需要完整的 JSON 解析上下文
- 支持在长文本中提取
- 处理复杂嵌套结构

✅ **容错性强**
- 部分解析失败不影响整体
- 自动跳过格式错误的部分
- 有详细的日志记录

✅ **性能高效**
- O(n) 复杂度扫描文本
- 只解析必要的 JSON 片段
- 避免重复工作（去重机制）

### 3. **工程实践价值**

🎯 **可维护性**
- 代码逻辑清晰，易于理解
- 单一职责原则（解析器只负责解析）
- 详细的注释和日志

🎯 **可扩展性**
- 容易添加新的验证规则
- 可以支持更多格式（如需要）
- 工具信息独立管理

🎯 **生产可用**
- 充分的错误处理
- 验证机制完善
- 支持实际业务场景

---

## 🚀 实际应用示例

### 场景1：天气查询

**AI 响应**：
```text
好的，我来帮你查询北京的天气情况。

{
  "tool_call": {
    "name": "get_weather",
    "arguments": {
      "city": "北京",
      "unit": "celsius"
    }
  }
}

稍等片刻，我会告诉你结果。
```

**解析结果**：
```python
[
    {
        "name": "get_weather",
        "args": {
            "city": "北京",
            "unit": "celsius"
        }
    }
]
```

### 场景2：复杂任务（多工具调用）

**AI 响应**：
```text
我需要执行以下操作来完成你的任务：

1. 首先查询数据库获取用户信息
{
  "tool_call": {
    "name": "database_query",
    "arguments": {
      "table": "users",
      "filters": {"status": "active"}
    }
  }
}

2. 然后发送通知邮件
{
  "tool_call": {
    "name": "send_email",
    "arguments": {
      "to": "admin@example.com",
      "subject": "数据统计报告"
    }
  }
}

3. 最后生成报告
{
  "tool_call": {
    "name": "generate_report",
    "arguments": {
      "format": "pdf",
      "include_charts": true
    }
  }
}

这些操作将按顺序执行。
```

**解析结果**：
```python
[
    {
        "name": "database_query",
        "args": {"table": "users", "filters": {"status": "active"}}
    },
    {
        "name": "send_email",
        "args": {"to": "admin@example.com", "subject": "数据统计报告"}
    },
    {
        "name": "generate_report",
        "args": {"format": "pdf", "include_charts": True}
    }
]
```

### 场景3：容错处理

**AI 响应（包含错误）**：
```text
我来处理你的请求。

{
  "tool_call": {
    "name": "valid_tool",
    "arguments": {"param": "value"}
  }
}

{
  "tool_call": {
    "name": "invalid_tool",  // 这个工具不存在
    "arguments": {}
  }
}

{
  "tool_call": {
    "name": "another_valid_tool",
    "arguments": {"key": "data"}
  }
}
```

**解析结果**（自动过滤无效工具）：
```python
[
    {"name": "valid_tool", "args": {"param": "value"}},
    # invalid_tool 被验证器过滤掉
    {"name": "another_valid_tool", "args": {"key": "data"}}
]
```

**日志输出**：
```
⚠️ 工具 invalid_tool 不在可用工具列表中，已跳过
✅ 成功解析 2 个有效工具调用
```

---

## 🔮 未来优化方向

### 1. 支持更多格式（可选）

如果需要，可以扩展支持：
- 数组格式的工具调用
- 嵌套结构中的工具调用
- 流式解析（支持 SSE）

### 2. 性能优化

- 使用正则表达式预过滤
- 并行解析多个 JSON
- 缓存解析结果

### 3. 增强验证

- 参数类型验证
- 参数值范围检查
- 工具依赖关系验证

### 4. 更好的错误提示

- 生成修复建议
- 提供格式示例
- 智能纠错

---

## 📚 结论

这套工具调用机制的设计充分体现了：

1. **清晰的接口设计**：提示词明确告诉 AI 该怎么做
2. **健壮的实现**：解析器能处理各种实际情况
3. **工程化思维**：容错、验证、日志一应俱全
4. **实用主义**：不追求完美，但解决实际问题

**核心价值**：让 AI 能够以可靠、标准的方式调用工具，同时保持灵活性和用户体验。

---

## 附录：关键代码片段

### A. 提示词构建函数

```python
def _build_tool_instruction_prompt(available_tools: List[McpToolInfo]) -> str:
    """构建系统提示，仅支持JSON格式工具调用"""
    if not available_tools:
        return "⚠️ 当前没有可用工具，请仅使用你的知识回答问题。"
    
    tool_instruction_prompt = str(TOOL_CALL_INSTRUCTION)
    tool_instruction_prompt += "\n\n## 可用工具"
    
    for tool in available_tools:
        tool_desc = format_tool_description_simple(tool)
        tool_instruction_prompt += f"\n{tool_desc}"
    
    example_tool = available_tools[0]
    tool_instruction_prompt += "\n\n## 调用示例\n\n"
    tool_instruction_prompt += build_json_tool_example(example_tool)
    
    return tool_instruction_prompt
```

### B. 完整解析流程

```python
# 1. 创建解析器
parser = ToolCallParser(available_tools)

# 2. 解析 AI 响应
parsed_calls = parser.parse_tool_calls(response_content)

# 3. 执行工具（并发）
tasks = [
    execute_mcp_tool(call["name"], call["args"], mcp_client)
    for call in parsed_calls
]
results = await asyncio.gather(*tasks, return_exceptions=True)

# 4. 收集结果
tool_outputs = [
    {
        "tool": call["name"],
        "args": call["args"],
        "result": result,
        "success": not isinstance(result, Exception)
    }
    for call, result in zip(parsed_calls, results)
]
```

---

**文档版本**: v1.0  
**最后更新**: 2025年11月6日  
**作者**: AI Assistant  
**审阅**: 待审阅
