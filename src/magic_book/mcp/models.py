"""
MCP (Model Context Protocol) 数据模型

定义 MCP 协议中使用的数据结构和模型类。
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class McpToolInfo(BaseModel):
    """MCP 工具信息"""

    name: str
    description: str
    input_schema: Dict[str, Any]


class McpToolResult(BaseModel):
    """MCP 工具执行结果"""

    success: bool
    result: Any
    error: Optional[str] = None
    execution_time: float


class McpPromptInfo(BaseModel):
    """MCP 提示词模板信息"""

    name: str
    description: Optional[str] = None
    arguments: Optional[List[Dict[str, Any]]] = None


class McpPromptMessage(BaseModel):
    """MCP 提示词消息"""

    role: str
    content: Dict[str, Any]


class McpPromptResult(BaseModel):
    """MCP 提示词获取结果"""

    description: Optional[str] = None
    messages: List[McpPromptMessage]
