# 开发期 Agent 工作流

两套互补入口，只服务开发、走查与 agent 实验，不是产品 API：
- 快照驱动：`agent:game` 直接读写 `worlds/`，不需要服务器。
- HTTP 走查：`agent:api` 逐步请求运行中的业务服务端。

两者最终都必须复用同一套业务服务层。CLI 只负责参数解析、状态装载与结果输出，规则校验、动作执行和持久化不能各写一份。

## 快照驱动

一份快照是完整、自足的状态切片：任意一份都能独立还原并继续推进，不依赖进程内记忆。目录按 `worlds/<user>/<game>/<snapshotId>/` 组织，包含 `manifest.json`、`world.json`、`session.jsonl`，以及可选的领域 JSON 文件。

写入采用临时目录加原子替换；动作失败不会留下半份快照。时间戳即快照标识，因此可以回溯到旧状态重新推进，也可以从同一快照分支探索不同路径。快照目录是开发期留痕层，正式存储仍应落到数据库。

命令：`pnpm agent:game new --user <user> --game <game>` 创建；`list`、`latest`、`show`、`validate` 分别用于枚举、定位、查看与校验。`--root` 可覆盖默认的 `worlds`。当前只有基础设施命令，业务动作会随游戏服务层接入同一条“读快照 → 动作 → 写新快照”链路。

## HTTP 走查

`agent:api` 是一次性进程：一次调用发一次 HTTP 请求，不缓存世界状态。世界状态在服务端内存中，客户端只通过业务 API 寻址与观测。stdout 始终是 JSON，日志与错误写 stderr，非 2xx 以非零退出码结束，便于 agent 判断并自我纠错。

命令：`health` 验证连通性；`openapi` 列出当前契约路径；`request` 对任意路径发起请求，支持方法、JSON body 与额外 header。服务端地址通过 `--base` 或 `AGENT_API_BASE_URL` 提供，鉴权 token 通过 `--token` 或 `AGENT_API_TOKEN` 注入。业务命令（login、status、动作提交）会在对应业务 API 建立后接入。

它不替代固定回归测试：可复现的契约校验仍应写成 `app.inject()` 测试；HTTP 走查用于探索、新特性验证与边界试探。

→ 参见：[架构与契约](architecture.md)
