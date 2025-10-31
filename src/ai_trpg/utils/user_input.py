from typing import Dict, Tuple


########################################################################################################################
def parse_command_with_params(user_input: str) -> Tuple[str, Dict[str, str]] | None:
    """解析命令行参数格式的输入

    支持格式：command --param1=value1 --param2=value2 ...

    Args:
        user_input: 用户输入的字符串

    Returns:
        如果是命令格式，返回 (command, params_dict)
        如果不是命令格式，返回 None

    Examples:
        >>> parse_command_with_params("move --actor=张三 --stage=客厅")
        ('move', {'actor': '张三', 'stage': '客厅'})

        >>> parse_command_with_params("query --verbose")
        ('query', {'verbose': 'true'})
    """
    # 检查是否包含 -- 参数格式
    if " --" not in user_input:
        return None

    # 分割命令和参数
    parts = user_input.split()
    if not parts:
        return None

    command = parts[0]  # 第一个部分是命令

    # 解析参数
    params: Dict[str, str] = {}
    for part in parts[1:]:
        if part.startswith("--"):
            # 移除 -- 前缀并分割键值对
            param_str = part[2:]  # 去掉 --
            if "=" in param_str:
                key, value = param_str.split("=", 1)
                params[key] = value
            else:
                # 如果没有 =，则视为标志参数（值为 true）
                params[param_str] = "true"

    return (command, params)
