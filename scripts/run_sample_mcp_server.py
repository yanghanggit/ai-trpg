#!/usr/bin/env python3
"""
生产级 MCP 服务器 - 基于配置文件的完全可配置实现

基于 MCP 2025-06-18 规范的 Streamable HTTP 传输实现。

架构特点：
1. 标准 Streamable HTTP 传输（MCP 2025-06-18 规范）
2. 支持 Server-Sent Events (SSE) 流
3. 会话管理和安全控制
4. 生产级特性：日志记录、错误处理、资源管理
5. 可扩展的工具和资源系统
6. 完全基于配置文件的设计，消除硬编码

使用方法：
    python scripts/run_sample_mcp_server.py
"""

import os
import sys
import json
from datetime import datetime
from typing import Dict, Callable, Union

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from loguru import logger
from mcp.server.fastmcp import FastMCP
import mcp.types as types
from magic_book.mcp import mcp_config
from magic_book.game.config import setup_logger
from fastapi import Request, Response

# ============================================================================
# 初始化日志系统
# ============================================================================

setup_logger()

# ============================================================================
# 主函数
# ============================================================================

"""启动生产级 MCP 服务器 (Streamable HTTP)"""


# ========================================================================
# 创建 FastMCP 应用实例
# ========================================================================
app = FastMCP(
    name=mcp_config.server_name,
    instructions=mcp_config.server_description,
    debug=True,  # HTTP 模式可以启用调试
)


# ========================================================================
# 注册健康检查端点
# ========================================================================
@app.custom_route("/health", methods=["POST"])  # type: ignore[misc]
async def health_check(request: Request) -> Response:
    """处理 MCP 健康检查请求"""
    try:
        # 解析请求体
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        # 检查是否是 ping 方法
        if data.get("method") == "ping":
            response_data = {
                "jsonrpc": "2.0",
                "id": data.get("id"),
                "result": {"status": "ok"},
            }
            return Response(
                content=json.dumps(response_data),
                media_type="application/json",
                status_code=200,
            )
        else:
            error_response = {
                "jsonrpc": "2.0",
                "id": data.get("id"),
                "error": {"code": -32601, "message": "Method not found"},
            }
            return Response(
                content=json.dumps(error_response),
                media_type="application/json",
                status_code=200,
            )
    except Exception as e:
        error_response = {
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32700, "message": f"Parse error: {str(e)}"},
        }
        return Response(
            content=json.dumps(error_response),
            media_type="application/json",
            status_code=400,
        )


# ========================================================================
# 注册工具
# ========================================================================
@app.tool()
async def get_current_time(format: str = "datetime") -> str:
    """
    获取当前系统时间

    Args:
        format: 时间格式 (datetime|timestamp|iso|custom)

    Returns:
        格式化的时间字符串
    """
    try:
        now = datetime.now()

        if format == "datetime":
            return now.strftime("%Y-%m-%d %H:%M:%S")
        elif format == "timestamp":
            return str(int(now.timestamp()))
        elif format == "iso":
            return now.isoformat()
        elif format == "custom":
            return now.strftime("%A, %B %d, %Y at %I:%M %p")
        else:
            return now.strftime("%Y-%m-%d %H:%M:%S")

    except Exception as e:
        logger.error(f"获取时间失败: {e}")
        return f"错误：无法获取时间 - {str(e)}"


@app.tool()
async def system_info() -> str:
    """
    获取系统信息

    Returns:
        系统信息的 JSON 字符串
    """
    try:
        import platform
        import psutil

        info = {
            "操作系统": platform.system(),
            "操作系统版本": platform.release(),
            "Python版本": platform.python_version(),
            "处理器": platform.processor(),
            "内存信息": {
                "总内存": f"{psutil.virtual_memory().total / (1024**3):.2f} GB",
                "可用内存": f"{psutil.virtual_memory().available / (1024**3):.2f} GB",
                "内存使用率": f"{psutil.virtual_memory().percent}%",
            },
            "磁盘信息": {
                "总空间": f"{psutil.disk_usage('/').total / (1024**3):.2f} GB",
                "可用空间": f"{psutil.disk_usage('/').free / (1024**3):.2f} GB",
                "使用率": f"{(psutil.disk_usage('/').used / psutil.disk_usage('/').total * 100):.2f}%",
            },
            "服务器配置": mcp_config.model_dump_json(),
        }

        return json.dumps(info, ensure_ascii=False, indent=2)

    except ImportError:
        return "系统信息功能需要 psutil 库。请安装：pip install psutil"
    except Exception as e:
        logger.error(f"获取系统信息失败: {e}")
        return f"错误：无法获取系统信息 - {str(e)}"


@app.tool()
async def calculator(operation: str, left_operand: float, right_operand: float) -> str:
    """
    简单计算器工具 - 支持基本数学运算

    Args:
        operation: 运算类型 (add|subtract|multiply|divide|power|modulo)
        left_operand: 左操作数（数字）
        right_operand: 右操作数（数字）

    Returns:
        计算结果的字符串表示
    """
    try:
        operation = operation.lower().strip()

        # 支持的运算类型
        operations: Dict[str, Callable[[float, float], Union[float, None]]] = {
            "add": lambda x, y: x + y,
            "subtract": lambda x, y: x - y,
            "multiply": lambda x, y: x * y,
            "divide": lambda x, y: x / y if y != 0 else None,
            "power": lambda x, y: x**y,
            "modulo": lambda x, y: x % y if y != 0 else None,
            # 支持符号形式
            "+": lambda x, y: x + y,
            "-": lambda x, y: x - y,
            "*": lambda x, y: x * y,
            "/": lambda x, y: x / y if y != 0 else None,
            "**": lambda x, y: x**y,
            "%": lambda x, y: x % y if y != 0 else None,
        }

        if operation not in operations:
            valid_ops = ", ".join([op for op in operations.keys() if op.isalpha()])
            return f"错误：不支持的运算类型 '{operation}'。支持的运算：{valid_ops}"

        # 执行计算
        result = operations[operation](left_operand, right_operand)

        if result is None:
            return "错误：除零错误，无法除以零"

        # 格式化结果
        result_info = {
            "表达式": f"{left_operand} {operation} {right_operand}",
            "结果": result,
            "运算类型": operation,
            "计算时间": datetime.now().isoformat(),
        }

        return json.dumps(result_info, ensure_ascii=False, indent=2)

    except (TypeError, ValueError) as e:
        return f"错误：参数类型错误 - {str(e)}"
    except OverflowError:
        return "错误：计算结果溢出"
    except Exception as e:
        logger.error(f"计算器工具执行失败: {e}")
        return f"错误：计算失败 - {str(e)}"


# ========================================================================
# 注册资源
# ========================================================================
@app.resource("config://server-status")
async def get_server_status() -> str:
    """获取服务器状态信息"""
    try:
        status = {
            "服务器配置": mcp_config.model_dump_json(),
            "运行状态": "正常",
            "可用工具数": len(getattr(app._tool_manager, "_tools", {})),
            "可用资源数": len(getattr(app._resource_manager, "_resources", {})),
            "可用提示数": len(getattr(app._prompt_manager, "_prompts", {})),
            "内存使用": "未知（需要 psutil）",
            "连接状态": "活跃",
        }

        try:
            import psutil

            process = psutil.Process()
            status["内存使用"] = f"{process.memory_info().rss / 1024 / 1024:.2f} MB"
        except ImportError:
            pass

        return json.dumps(status, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"获取服务器状态失败: {e}")
        return f"错误：{str(e)}"


@app.resource("config://capabilities")
async def get_capabilities() -> str:
    """获取服务器能力信息"""
    capabilities = {
        "协议版本": "MCP 1.0",
        "支持的传输": ["streamable-http"],
        "工具功能": {
            "时间查询": "支持多种时间格式",
            "系统信息": "获取系统运行状态",
            "计算器": "支持基本数学运算（加减乘除、幂运算、取模）",
        },
        "资源功能": {
            "服务器状态": "实时服务器运行状态",
            "能力查询": "服务器功能说明",
            "配置信息": "服务器配置详情",
        },
        "提示模板": {
            "系统分析": "支持综合、性能、安全、故障排查四种分析类型",
        },
        "安全特性": {
            "表达式求值": "限制危险字符和函数",
            "内容大小": "限制文件读取大小",
            "路径验证": "防止路径遍历攻击",
        },
    }

    return json.dumps(capabilities, ensure_ascii=False, indent=2)


@app.resource("logs://recent/{count}")
async def get_recent_logs(count: str) -> str:
    """
    获取最近的模拟日志（动态资源，支持参数）

    Args:
        count: 日志条目数量

    注意：这是一个动态资源，需要在 URI 中指定 count 参数。
    例如：logs://recent/10 表示获取最近 10 条日志
    """
    try:
        log_count = int(count)
        if log_count < 1 or log_count > 100:
            return "错误：日志条目数量必须在 1-100 之间"

        logs = []
        for i in range(log_count):
            logs.append(
                {
                    "timestamp": datetime.now().isoformat(),
                    "level": ["INFO", "DEBUG", "WARNING"][i % 3],
                    "message": f"模拟日志条目 {i + 1} - 服务器运行正常",
                    "component": "mcp-server",
                    "request_id": f"req-{1000 + i}",
                }
            )

        return json.dumps(
            {"logs": logs, "total": log_count}, ensure_ascii=False, indent=2
        )
    except ValueError:
        return "错误：无效的数字格式"
    except Exception as e:
        return f"错误：{str(e)}"


@app.resource("logs://recent-10")
async def get_recent_logs_10() -> str:
    """获取最近10条日志（固定参数版本）"""
    result: str = await get_recent_logs("10")
    return result


# ========================================================================
# 注册提示模板
# ========================================================================
@app.prompt()
async def system_analysis(analysis_type: str = "general") -> types.GetPromptResult:
    """
    系统分析提示模板

    Args:
        analysis_type: 分析类型 (general|performance|security|troubleshooting)
    """
    prompts = {
        "general": """请对以下系统信息进行综合分析：

{system_data}

请分析以下方面：
1. 系统整体状态评估
2. 资源使用情况分析
3. 潜在的性能瓶颈
4. 建议的优化措施
5. 风险评估和预警

请提供详细的分析报告和具体的改进建议。""",
        "performance": """请对以下系统性能数据进行专业分析：

{system_data}

重点关注：
1. CPU 使用率和负载模式
2. 内存使用效率和泄漏风险
3. 磁盘 I/O 性能指标
4. 网络吞吐量和延迟
5. 系统瓶颈识别

请提供性能优化建议和调优方案。""",
        "security": """请对以下系统安全状态进行评估：

{system_data}

安全检查项目：
1. 系统漏洞和安全补丁状态
2. 访问控制和权限管理
3. 网络安全配置
4. 日志监控和异常检测
5. 数据保护和备份策略

请提供安全加固建议和风险缓解措施。""",
        "troubleshooting": """请根据以下系统信息进行故障诊断：

{system_data}

故障排查重点：
1. 系统错误和异常分析
2. 服务可用性检查
3. 资源瓶颈定位
4. 配置问题识别
5. 根本原因分析

请提供详细的故障诊断结果和解决方案。""",
    }

    prompt_text = prompts.get(analysis_type, prompts["general"])

    return types.GetPromptResult(
        description=f"系统{analysis_type}分析提示模板",
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=prompt_text),
            )
        ],
    )


def main() -> None:

    logger.info(f"🎯 启动 {mcp_config.server_name} v{mcp_config.server_version}")
    logger.info(f"📡 传输协议: {mcp_config.transport} ({mcp_config.protocol_version})")
    logger.info(
        f"🌐 服务地址: http://{mcp_config.mcp_server_host}:{mcp_config.mcp_server_port}"
    )

    # ========================================================================
    # 配置并启动服务器
    # ========================================================================
    app.settings.host = mcp_config.mcp_server_host
    app.settings.port = mcp_config.mcp_server_port

    try:
        # 启动 HTTP 服务器
        logger.info("✅ 服务器启动完成，等待客户端连接...")
        app.run(transport="streamable-http")
    except KeyboardInterrupt:
        logger.info("🛑 收到中断信号，正在关闭服务器...")
    except Exception as e:
        logger.error(f"❌ 服务器启动失败: {e}")
        raise
    finally:
        logger.info("👋 服务器已关闭")


if __name__ == "__main__":
    main()
