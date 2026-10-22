# LLM 基础组件

## 分层

服务端 LLM 分为两层：`llm` 是与 provider 无关的类型、协议、批量与 agent loop；`deepseek` 是 DeepSeek 的 HTTP 实现与默认绑定。依赖方向固定为 `deepseek → llm`，`llm` 不得 import 具体 provider，因此接本地模型或其它兼容网关时，编排层不需要改。

这一层不对外暴露。客户端只与业务 API 交互；模型选择、prompt、tools、密钥与原始响应都留在服务端。

→ 参见：[架构与契约](architecture.md)

## 核心设计

- 请求与结果是值对象，service 无状态：同一个 `DeepSeekClient` 可并发复用，不在实例上残留上一轮响应。
- 预期内失败走结果：超时、连接错误、非 200 填进 `ChatCompletionResult.error`，不抛异常；真正的程序错误与取消仍然抛出。
- 批量有并发上限：`batchComplete` 用信号量限制同时在飞的请求数，结果与请求等长同序，意外异常也收敛为 error。
- agent loop 与 provider 解耦：循环只依赖 `ChatCompletionService`，工具定义与 handler 由调用方注入；终止工具、纠偏重试与历史边界属于编排层。循环层不判断工具能否并发：由 LLM 决定一次返回多个 `tool_calls` 还是分多轮对话，循环按返回顺序串行执行，保证状态变更顺序确定。
- 内部字段 camelCase，snake_case 只存在于 DeepSeek wire 边界，避免 provider 命名扩散到业务层。

## 与参考实现的差异

参考实现是 `ai-rpg` 的 Python 版，整体分层值得保留；TS 版有意修正了以下问题：

- 请求校验不再依赖 `assert`，改为显式抛错，避免优化模式关闭校验。
- `usage` 可选；空 choices、非法 JSON、畸形 tool_calls 收敛为 error，而不是让 200 响应炸掉调用链。
- 模型列表与余额查询改为 async，不在事件循环里做阻塞 IO。
- 对话留痕默认关闭，目录在写入时才创建，避免生产环境写满磁盘与 import 副作用。
- 不再把完整响应正文写入日志，降低 prompt / 回复泄漏风险。

## 对话留痕

`transcript` 记录「这一轮问了什么、模型答了什么、调用了哪些工具」，用于人工复盘，或作为让 LLM 分析提示词与上下文结构的输入。它不是生产遥测，也不替代结构化日志。

目录使用 `logs/llm`：点号目录留给工具状态与缓存，`logs` 表达运行期记录，内容 gitignore，只保留占位文件。默认同时写两种格式：可读的文本文件，以及按日追加的 JSONL；JSONL 一行一轮请求 / 响应，适合直接交给分析脚本或 LLM。同进程并发写入通过队列串行化；跨进程共享目录时应按实例分目录或交给日志收集器。

留痕受两级开关控制：请求级开关与进程级 `LLM_DUMP_ENABLED`，两者同时为真才写入。生产环境保持关闭。

## 错误与重试

`ChatError` 的 retryable 只是元数据，通讯层不自动重试。超时与连接错误可重试；HTTP 408、429、5xx 可重试；400、401、402、422 通常是请求、鉴权或余额问题，不可重试。重试策略由业务层决定，避免在通讯层无条件重放带副作用的请求。

## 验证

真实调用 DeepSeek 的冒烟测试使用 `pnpm smoke:deepseek`，完整版使用 `pnpm smoke:deepseek:full`；会覆盖模型列表、余额、单次补全、usage、批量、工具调用与 agent loop，可能产生费用。脚本读取仓库根 `.env`，默认不写留痕。

→ 参见：[本地开发](dev-setup.md)
