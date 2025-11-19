# ai_trpg

没想好干啥，测试一下mcp?

## 核心操作见 Makefile

- 如严格检查代码规范、运行测试、安装依赖等。

## 脚本见 `scripts/` 目录

- 如启动游戏服务器、运行测试等。

## VS Code 配置

如果使用 VS Code 进行开发：

1. 打开命令面板 (`Cmd+Shift+P`)
2. 选择解释器 `Python: Select Interpreter`
3. 选择 uv 环境路径：`/.venv/Scripts/python.exe`

## Windows中的注意情况

1.需安装git bash。
2.使用UV后需安装Make工具 使用命令`winget install ezwinports.make`
3.注意python解释器，安装uv后选择    `.\.venv\Scripts\python.exe`

## 其他情况

如遇‘a_request error: Server disconnected without sending a response’ 检查vpn的情况，关掉vpn或者使用WireGuard（Astrill vpn）模式在重新运行。

## PostgreSQL 数据库要求

- PostgreSQL 版本: 14.18+
- 必需扩展: pgvector 0.8.0+

## 激活uv环境

source .venv/bin/activate

## 查看本地数据库列表

psql -l
