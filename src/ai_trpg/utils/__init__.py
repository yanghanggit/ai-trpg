"""
Multi-Agents Game Framework 工具模块

这个包包含了游戏框架中使用的各种工具和实用函数。

主要模块：
- json_format: JSON格式化和处理工具
- excel_utils: Excel文件读取、处理和数据转换工具
"""

# JSON格式化工具
from .json_format import (
    clean_json_string,
    combine_json_fragments,
    contains_duplicate_segments,
    contains_json_code_block,
    strip_json_code_block,
)

from .user_input import parse_command_with_params

# 公开的API
__all__ = [
    # JSON格式化工具
    "clean_json_string",
    "combine_json_fragments",
    "contains_duplicate_segments",
    "contains_json_code_block",
    "strip_json_code_block",
    "parse_command_with_params",
]
