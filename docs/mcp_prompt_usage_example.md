# MCP 提示词模板使用示例

## 1. 基本概念

MCP 提示词模板(Prompts)是预定义的分析框架,用于指导 AI 如何处理特定类型的任务。

## 2. 完整使用流程

```python
# ============================================================
# 步骤 1: 连接 MCP 服务器并获取可用提示词
# ============================================================
mcp_client = await initialize_mcp_client(
    mcp_server_url="http://127.0.0.1:8765",
    mcp_protocol_version="2025-06-18",
    mcp_timeout=30
)

# 列出所有可用的提示词模板
prompts = await mcp_client.list_prompts()
print(f"可用提示词: {[p.name for p in prompts]}")
# 输出: ['system_analysis']

# ============================================================
# 步骤 2: 获取系统数据(使用工具)
# ============================================================
system_data_result = await mcp_client.call_tool(
    tool_name="system_info",
    arguments={}
)
system_data = system_data_result.result

# ============================================================
# 步骤 3: 获取提示词模板
# ============================================================
prompt = await mcp_client.get_prompt(
    name="system_analysis",
    arguments={"analysis_type": "performance"}  # 选择性能分析模板
)

# prompt 包含:
# - description: "系统performance分析提示模板"
# - messages: [{"role": "user", "content": {"text": "..."}}]

# ============================================================
# 步骤 4: 填充模板中的数据占位符
# ============================================================
prompt_text = prompt.messages[0].content.text
filled_prompt = prompt_text.replace("{system_data}", system_data)

# ============================================================
# 步骤 5: 发送给 AI 进行分析
# ============================================================
messages = [
    SystemMessage(content="你是一个系统分析专家"),
    HumanMessage(content=filled_prompt)
]

response = await deepseek_chat_client.chat(messages)
print(response.content)
```

## 3. 不同分析类型示例

### 3.1 综合分析
```python
prompt = await mcp_client.get_prompt(
    name="system_analysis",
    arguments={"analysis_type": "general"}
)
```

### 3.2 性能分析
```python
prompt = await mcp_client.get_prompt(
    name="system_analysis",
    arguments={"analysis_type": "performance"}
)
```

### 3.3 安全分析
```python
prompt = await mcp_client.get_prompt(
    name="system_analysis",
    arguments={"analysis_type": "security"}
)
```

### 3.4 故障诊断
```python
prompt = await mcp_client.get_prompt(
    name="system_analysis",
    arguments={"analysis_type": "troubleshooting"}
)
```

## 4. 与工具调用的对比

| 功能 | 工具(Tool) | 提示词(Prompt) |
|------|-----------|---------------|
| 用途 | 执行实际操作,获取数据 | 提供分析框架,指导 AI |
| 返回 | 实际数据(JSON/字符串) | 提示词文本模板 |
| 示例 | `system_info()` 返回系统数据 | `system_analysis()` 返回分析指导 |

## 5. 典型工作流

```mermaid
graph LR
    A[用户请求分析] --> B[list_prompts获取模板列表]
    B --> C[call_tool获取实际数据]
    C --> D[get_prompt获取分析模板]
    D --> E[填充模板占位符]
    E --> F[发送给AI分析]
    F --> G[返回分析结果]
```

## 6. 实际应用场景

### 场景: 用户说 "帮我分析一下系统性能"

```python
async def handle_performance_analysis(mcp_client, ai_client):
    # 1. 获取系统数据
    system_data = await mcp_client.call_tool("system_info", {})
    
    # 2. 获取性能分析提示词模板
    prompt = await mcp_client.get_prompt(
        "system_analysis", 
        {"analysis_type": "performance"}
    )
    
    # 3. 填充数据
    analysis_prompt = prompt.messages[0].content.text.replace(
        "{system_data}", 
        system_data.result
    )
    
    # 4. AI 分析
    response = await ai_client.chat([
        HumanMessage(content=analysis_prompt)
    ])
    
    return response.content
```

## 7. 注意事项

1. **提示词模板**是静态的分析框架,需要手动填充数据
2. **工具调用**是动态的数据获取,直接返回结果
3. 两者通常**配合使用**: 工具获取数据 → 提示词指导分析
4. 提示词模板中的 `{system_data}` 是占位符,需要替换为实际数据
