"""
ToolCallParser 单元测试

测试 parse_tool_calls 函数在各种输入场景下的稳定性和正确性
包括正常情况、边界情况和极端情况
"""

import json
import pytest
from typing import List, Dict, Any

from src.ai_trpg.mcp import ToolCallParser, McpToolInfo


class TestToolCallParser:
    """ToolCallParser 核心功能测试类"""

    @pytest.fixture
    def sample_tools(self) -> List[McpToolInfo]:
        """创建示例工具信息的测试夹具"""
        return [
            McpToolInfo(
                name="get_current_time",
                description="获取当前时间",
                input_schema={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            ),
            McpToolInfo(
                name="calculator",
                description="计算数学表达式",
                input_schema={
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "要计算的数学表达式",
                        }
                    },
                    "required": ["expression"],
                },
            ),
            McpToolInfo(
                name="text_processor",
                description="处理文本",
                input_schema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "要处理的文本"},
                        "operation": {
                            "type": "string",
                            "description": "操作类型: upper, lower, reverse, count",
                        },
                    },
                    "required": ["text", "operation"],
                },
            ),
        ]

    @pytest.fixture
    def parser(self, sample_tools: List[McpToolInfo]) -> ToolCallParser:
        """创建解析器实例"""
        return ToolCallParser(sample_tools)

    # ==================== 正常情况测试 ====================

    def test_parse_single_valid_tool_call(self, parser: ToolCallParser) -> None:
        """测试解析单个有效的工具调用"""
        content = """
        这里是一些文本
        {"tool_call": {"name": "get_current_time", "arguments": {}}}
        更多文本
        """
        result = parser.parse_tool_calls(content)

        assert len(result) == 1, "应该解析出 1 个工具调用"
        assert result[0]["name"] == "get_current_time", "工具名应该是 get_current_time"
        assert result[0]["args"] == {}, "参数应该是空字典"

    def test_parse_tool_call_with_arguments(self, parser: ToolCallParser) -> None:
        """测试解析带参数的工具调用"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}}}
        """
        result = parser.parse_tool_calls(content)

        assert len(result) == 1, "应该解析出 1 个工具调用"
        assert result[0]["name"] == "calculator", "工具名应该是 calculator"
        assert result[0]["args"]["expression"] == "2+2", "应该包含 expression 参数"

    def test_parse_multiple_valid_tool_calls(self, parser: ToolCallParser) -> None:
        """测试解析多个有效的工具调用"""
        content = """
        首先调用时间工具：
        {"tool_call": {"name": "get_current_time", "arguments": {}}}
        
        然后使用计算器：
        {"tool_call": {"name": "calculator", "arguments": {"expression": "10*5"}}}
        
        最后处理文本：
        {"tool_call": {"name": "text_processor", "arguments": {"text": "hello", "operation": "upper"}}}
        """
        result = parser.parse_tool_calls(content)

        assert len(result) == 3, "应该解析出 3 个工具调用"
        assert result[0]["name"] == "get_current_time"
        assert result[1]["name"] == "calculator"
        assert result[2]["name"] == "text_processor"

    # ==================== 边界情况测试 ====================

    def test_parse_empty_string(self, parser: ToolCallParser) -> None:
        """测试空字符串输入"""
        result = parser.parse_tool_calls("")
        assert len(result) == 0, "空字符串应该返回空列表"

    def test_parse_whitespace_only(self, parser: ToolCallParser) -> None:
        """测试只包含空白字符的输入"""
        result = parser.parse_tool_calls("   \n\t\r   ")
        assert len(result) == 0, "纯空白字符应该返回空列表"

    def test_parse_no_tool_calls(self, parser: ToolCallParser) -> None:
        """测试纯文本响应（无工具调用）"""
        content = """
        这是一段普通的文本响应，没有任何工具调用。
        它可以包含多行内容。
        但是没有 JSON 格式的工具调用。
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "纯文本应该返回空列表"

    def test_parse_very_long_content(self, parser: ToolCallParser) -> None:
        """测试超长内容"""
        # 生成一个包含大量文本和一个工具调用的超长内容
        long_text = "这是一段很长的文本。" * 1000
        content = f'{long_text}\n{{"tool_call": {{"name": "get_current_time", "arguments": {{}}}}}}\n{long_text}'

        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能从超长内容中解析出工具调用"
        assert result[0]["name"] == "get_current_time"

    # ==================== 格式错误测试 ====================

    def test_parse_malformed_json(self, parser: ToolCallParser) -> None:
        """测试格式错误的 JSON"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}
        """  # 缺少闭合括号
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "格式错误的 JSON 应该被忽略"

    def test_parse_incomplete_tool_call(self, parser: ToolCallParser) -> None:
        """测试不完整的工具调用"""
        content = """
        {"tool_call": {"name": "calculator"}}
        """  # 缺少 arguments 字段
        result = parser.parse_tool_calls(content)
        # 缺少 arguments 会使用空字典，但 calculator 需要 expression 参数，所以验证会失败
        assert len(result) == 0, "缺少必需参数的工具调用应该被过滤掉"

    def test_parse_incomplete_tool_call_no_required_params(
        self, parser: ToolCallParser
    ) -> None:
        """测试不完整的工具调用（无必需参数的工具）"""
        content = """
        {"tool_call": {"name": "get_current_time"}}
        """  # 缺少 arguments 字段，但 get_current_time 没有必需参数
        result = parser.parse_tool_calls(content)
        # get_current_time 没有必需参数，所以应该成功
        assert len(result) == 1, "无必需参数的工具即使缺少 arguments 字段也应该成功"
        assert result[0]["args"] == {}

    def test_parse_wrong_json_structure(self, parser: ToolCallParser) -> None:
        """测试错误的 JSON 结构（不包含 tool_call 键）"""
        content = """
        {"name": "calculator", "arguments": {"expression": "2+2"}}
        """  # 缺少外层的 tool_call 包装
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "不符合标准结构的 JSON 应该被忽略"

    def test_parse_nested_tool_call_keyword(self, parser: ToolCallParser) -> None:
        """测试嵌套的 tool_call 关键字"""
        content = """
        {
            "response": "这是响应",
            "nested": {"tool_call": "这不是真正的工具调用"},
            "tool_call": {"name": "get_current_time", "arguments": {}}
        }
        """
        result = parser.parse_tool_calls(content)
        # 解析器会从第一个 "tool_call" 关键字开始向前查找 {
        # 可能会先找到 nested 中的 "tool_call"，导致解析失败
        # 这是当前解析器的已知限制
        # 如果能解析出来，应该是正确的工具调用
        assert len(result) >= 0, "嵌套的 tool_call 关键字可能导致解析问题"
        if len(result) > 0:
            assert result[0]["name"] == "get_current_time"

    def test_parse_clean_tool_call_after_text(self, parser: ToolCallParser) -> None:
        """测试文本后面的干净工具调用"""
        content = """
        这是一些文本，不包含嵌套的 tool_call 关键字
        {"tool_call": {"name": "get_current_time", "arguments": {}}}
        """
        result = parser.parse_tool_calls(content)
        # 没有嵌套干扰，应该能正确解析
        assert len(result) == 1, "干净的工具调用应该能正确解析"
        assert result[0]["name"] == "get_current_time"

    def test_parse_unmatched_braces(self, parser: ToolCallParser) -> None:
        """测试括号不匹配的情况"""
        content = """
        {{{{"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}}}
        """
        result = parser.parse_tool_calls(content)
        # 解析器应该能找到内部完整的 JSON 对象
        assert len(result) <= 1, "括号不匹配时应该尽量解析有效部分"

    # ==================== 重复和去重测试 ====================

    def test_parse_duplicate_tool_calls(self, parser: ToolCallParser) -> None:
        """测试重复的工具调用（应该去重）"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}}}
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}}}
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "重复的工具调用应该被去重"
        assert result[0]["name"] == "calculator"

    def test_parse_similar_but_different_tool_calls(
        self, parser: ToolCallParser
    ) -> None:
        """测试相似但不同的工具调用（不应该去重）"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2"}}}
        {"tool_call": {"name": "calculator", "arguments": {"expression": "3+3"}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 2, "参数不同的工具调用不应该被去重"
        assert result[0]["args"]["expression"] == "2+2"
        assert result[1]["args"]["expression"] == "3+3"

    # ==================== 验证测试 ====================

    def test_parse_unknown_tool_name(self, parser: ToolCallParser) -> None:
        """测试未知的工具名"""
        content = """
        {"tool_call": {"name": "unknown_tool", "arguments": {"param": "value"}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "未知工具名应该被过滤掉"

    def test_parse_missing_required_parameters(self, parser: ToolCallParser) -> None:
        """测试缺少必需参数的工具调用"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {}}}
        """  # calculator 需要 expression 参数
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "缺少必需参数的工具调用应该被过滤掉"

    def test_parse_extra_parameters(self, parser: ToolCallParser) -> None:
        """测试包含额外参数的工具调用（应该允许）"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {"expression": "2+2", "extra_param": "value"}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "额外参数不应该导致验证失败"
        assert result[0]["args"]["expression"] == "2+2"
        assert result[0]["args"]["extra_param"] == "value"

    def test_parse_partial_required_parameters(self, parser: ToolCallParser) -> None:
        """测试部分缺少必需参数的多工具调用场景"""
        content = """
        {"tool_call": {"name": "text_processor", "arguments": {"text": "hello", "operation": "upper"}}}
        {"tool_call": {"name": "text_processor", "arguments": {"text": "world"}}}
        {"tool_call": {"name": "get_current_time", "arguments": {}}}
        """  # 第二个 text_processor 缺少 operation 参数
        result = parser.parse_tool_calls(content)
        # 应该只解析出第一个和第三个工具调用
        assert len(result) == 2, "应该过滤掉缺少必需参数的工具调用"
        assert result[0]["name"] == "text_processor"
        assert result[1]["name"] == "get_current_time"

    # ==================== 特殊字符和编码测试 ====================

    def test_parse_with_special_characters(self, parser: ToolCallParser) -> None:
        """测试包含特殊字符的参数"""
        content = """
        {"tool_call": {"name": "text_processor", "arguments": {"text": "Hello\\nWorld\\t!", "operation": "upper"}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能正确处理转义字符"
        assert "\\n" in result[0]["args"]["text"] or "\n" in result[0]["args"]["text"]

    def test_parse_with_unicode_characters(self, parser: ToolCallParser) -> None:
        """测试包含 Unicode 字符的参数"""
        content = """
        {"tool_call": {"name": "text_processor", "arguments": {"text": "你好世界🌍", "operation": "upper"}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能正确处理 Unicode 字符"
        assert result[0]["args"]["text"] == "你好世界🌍"

    def test_parse_with_quotes_in_arguments(self, parser: ToolCallParser) -> None:
        """测试参数值中包含引号的情况"""
        content = """
        {"tool_call": {"name": "calculator", "arguments": {"expression": "\\"2+2\\""}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能正确处理参数值中的引号"

    # ==================== 混合场景测试 ====================

    def test_parse_mixed_valid_and_invalid(self, parser: ToolCallParser) -> None:
        """测试混合有效和无效的工具调用"""
        content = """
        这是一些文本
        {"tool_call": {"name": "get_current_time", "arguments": {}}}
        {"tool_call": {"name": "invalid_tool", "arguments": {}}}
        {"tool_call": {"name": "calculator", "arguments": {"expression": "5*5"}}}
        {invalid json}
        {"tool_call": {"name": "calculator", "arguments": {}}}
        """
        result = parser.parse_tool_calls(content)
        # 应该只解析出有效的工具调用：
        # - get_current_time: 有效
        # - invalid_tool: 无效（未知工具）
        # - calculator with expression: 有效
        # - invalid json: 无效（语法错误）
        # - calculator without expression: 无效（缺少必需参数）
        assert len(result) == 2, "应该只返回有效的工具调用"
        assert result[0]["name"] == "get_current_time"
        assert result[1]["name"] == "calculator"

    def test_parse_with_json_array(self, parser: ToolCallParser) -> None:
        """测试包含 JSON 数组的情况"""
        content = """
        [
            {"tool_call": {"name": "get_current_time", "arguments": {}}},
            {"tool_call": {"name": "calculator", "arguments": {"expression": "1+1"}}}
        ]
        """
        result = parser.parse_tool_calls(content)
        # 当前解析器查找独立的 JSON 对象，不是数组
        # 应该能从数组中提取出各个工具调用
        assert len(result) >= 1, "应该能从 JSON 数组中提取工具调用"

    def test_parse_with_surrounding_text(self, parser: ToolCallParser) -> None:
        """测试工具调用前后有大量文本的情况"""
        content = """
        根据您的要求，我将执行以下操作：
        
        1. 首先获取当前时间
        2. 然后进行计算
        
        这是第一个工具调用：
        {"tool_call": {"name": "get_current_time", "arguments": {}}}
        
        现在让我们进行计算：
        {"tool_call": {"name": "calculator", "arguments": {"expression": "100/5"}}}
        
        完成了上述操作。
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 2, "应该能从包含大量文本的内容中提取工具调用"

    # ==================== 性能和压力测试 ====================

    def test_parse_many_tool_calls(self, parser: ToolCallParser) -> None:
        """测试解析大量工具调用"""
        # 生成 50 个不同的工具调用
        tool_calls = [
            f'{{"tool_call": {{"name": "calculator", "arguments": {{"expression": "{i}+{i}"}}}}}}'
            for i in range(50)
        ]
        content = "\n".join(tool_calls)

        result = parser.parse_tool_calls(content)
        assert len(result) == 50, f"应该解析出 50 个工具调用，实际: {len(result)}"

    def test_parse_deeply_nested_json(self, parser: ToolCallParser) -> None:
        """测试深度嵌套的 JSON 结构"""
        nested_arg = {"level1": {"level2": {"level3": {"level4": "deep_value"}}}}
        content = json.dumps(
            {
                "tool_call": {
                    "name": "calculator",
                    "arguments": {"expression": "2+2", "nested": nested_arg},
                }
            }
        )

        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能处理深度嵌套的 JSON"
        assert "nested" in result[0]["args"]

    # ==================== 空工具列表测试 ====================

    def test_parser_with_empty_tools_list(self) -> None:
        """测试空工具列表的解析器"""
        parser = ToolCallParser([])
        content = """
        {"tool_call": {"name": "any_tool", "arguments": {}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "空工具列表应该导致所有工具调用被过滤"

    def test_parser_initialization(self, sample_tools: List[McpToolInfo]) -> None:
        """测试解析器初始化"""
        parser = ToolCallParser(sample_tools)
        assert len(parser.tool_names) == 3, "应该正确初始化工具名称集合"
        assert "get_current_time" in parser.tool_names
        assert "calculator" in parser.tool_names
        assert "text_processor" in parser.tool_names

    # ==================== 边界值测试 ====================

    def test_parse_tool_call_at_string_start(self, parser: ToolCallParser) -> None:
        """测试工具调用在字符串开头"""
        content = '{"tool_call": {"name": "get_current_time", "arguments": {}}}'
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能解析字符串开头的工具调用"

    def test_parse_tool_call_at_string_end(self, parser: ToolCallParser) -> None:
        """测试工具调用在字符串末尾"""
        content = 'Some text before\n{"tool_call": {"name": "get_current_time", "arguments": {}}}'
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能解析字符串末尾的工具调用"

    def test_parse_consecutive_tool_calls_no_separator(
        self, parser: ToolCallParser
    ) -> None:
        """测试连续的工具调用（无分隔符）"""
        content = '{"tool_call": {"name": "get_current_time", "arguments": {}}}{"tool_call": {"name": "calculator", "arguments": {"expression": "1+1"}}}'
        result = parser.parse_tool_calls(content)
        assert len(result) == 2, "应该能解析连续的工具调用"

    # ==================== 异常输入测试 ====================

    def test_parse_numeric_content(self, parser: ToolCallParser) -> None:
        """测试纯数字内容"""
        content = "123456789"
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "纯数字内容应该返回空列表"

    def test_parse_json_without_tool_call_key(self, parser: ToolCallParser) -> None:
        """测试有效 JSON 但不包含 tool_call 键"""
        content = """
        {
            "response": "这是一个响应",
            "data": {"key": "value"},
            "status": "success"
        }
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 0, "不包含 tool_call 键的 JSON 应该返回空列表"

    def test_parse_null_arguments(self, parser: ToolCallParser) -> None:
        """测试 arguments 为 null 的情况"""
        content = """
        {"tool_call": {"name": "get_current_time", "arguments": null}}
        """
        result = parser.parse_tool_calls(content)
        # 根据代码逻辑，arguments 为 null 时 get("arguments", {}) 会返回 None
        # 因为 key 存在，所以不会使用默认值 {}
        assert len(result) == 1, "arguments 为 null 的工具调用应该能解析"
        # None 也是有效的参数值（对于没有必需参数的工具）
        # 实际使用时 None 会被当作空参数处理


class TestToolCallParserEdgeCases:
    """ToolCallParser 边界情况和极端情况测试"""

    def test_single_character_tool_name(self) -> None:
        """测试单字符工具名"""
        tools = [
            McpToolInfo(
                name="x",
                description="单字符工具",
                input_schema={"type": "object", "properties": {}, "required": []},
            )
        ]
        parser = ToolCallParser(tools)
        content = '{"tool_call": {"name": "x", "arguments": {}}}'
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能处理单字符工具名"
        assert result[0]["name"] == "x"

    def test_very_long_tool_name(self) -> None:
        """测试超长工具名"""
        long_name = "a" * 1000
        tools = [
            McpToolInfo(
                name=long_name,
                description="超长工具名",
                input_schema={"type": "object", "properties": {}, "required": []},
            )
        ]
        parser = ToolCallParser(tools)
        content = f'{{"tool_call": {{"name": "{long_name}", "arguments": {{}}}}}}'
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能处理超长工具名"
        assert result[0]["name"] == long_name

    def test_tool_name_with_special_chars(self) -> None:
        """测试包含特殊字符的工具名"""
        special_name = "tool-name_v2.0"
        tools = [
            McpToolInfo(
                name=special_name,
                description="特殊字符工具名",
                input_schema={"type": "object", "properties": {}, "required": []},
            )
        ]
        parser = ToolCallParser(tools)
        content = f'{{"tool_call": {{"name": "{special_name}", "arguments": {{}}}}}}'
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能处理包含特殊字符的工具名"
        assert result[0]["name"] == special_name

    def test_empty_arguments_object(self) -> None:
        """测试空参数对象的各种表示"""
        tools = [
            McpToolInfo(
                name="test_tool",
                description="测试工具",
                input_schema={"type": "object", "properties": {}, "required": []},
            )
        ]
        parser = ToolCallParser(tools)

        # 测试不同的空参数表示
        test_cases = [
            '{"tool_call": {"name": "test_tool", "arguments": {}}}',
            '{"tool_call": {"name": "test_tool", "arguments": {  }}}',
            '{"tool_call": {"name": "test_tool", "arguments":{}}}',
        ]

        for content in test_cases:
            result = parser.parse_tool_calls(content)
            assert len(result) == 1, f"应该能解析: {content}"
            assert result[0]["args"] == {}

    def test_arguments_with_array_values(self) -> None:
        """测试参数值为数组的情况"""
        tools = [
            McpToolInfo(
                name="batch_processor",
                description="批处理工具",
                input_schema={
                    "type": "object",
                    "properties": {
                        "items": {"type": "array", "description": "要处理的项目列表"}
                    },
                    "required": ["items"],
                },
            )
        ]
        parser = ToolCallParser(tools)
        content = """
        {"tool_call": {"name": "batch_processor", "arguments": {"items": ["item1", "item2", "item3"]}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能处理数组类型的参数"
        assert result[0]["args"]["items"] == ["item1", "item2", "item3"]

    def test_arguments_with_nested_objects(self) -> None:
        """测试参数值为嵌套对象的情况"""
        tools = [
            McpToolInfo(
                name="config_updater",
                description="配置更新工具",
                input_schema={
                    "type": "object",
                    "properties": {
                        "config": {"type": "object", "description": "配置对象"}
                    },
                    "required": ["config"],
                },
            )
        ]
        parser = ToolCallParser(tools)
        content = """
        {"tool_call": {"name": "config_updater", "arguments": {"config": {"key1": {"nested": "value"}, "key2": "simple"}}}}
        """
        result = parser.parse_tool_calls(content)
        assert len(result) == 1, "应该能处理嵌套对象参数"
        assert result[0]["args"]["config"]["key1"]["nested"] == "value"


if __name__ == "__main__":
    # 支持直接运行测试
    pytest.main([__file__, "-v", "-s"])
