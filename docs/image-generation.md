# 图像生成基建（imagegen）

本模块只提供图像生成基建：provider 无关的生成服务、资产落盘与批量编排；不包含世界 / 舞台绑定、HTTP 契约与客户端展示。

## 分层与命名

服务端图像能力分两层：`imagegen` 定义请求、模型能力、生成服务与资产边界；`imagegen/providers/` 放厂商适配器。依赖方向固定为适配器 → 接口，领域层不 import 适配器，新增 provider 不改变生成流程。

厂商名只作为专有名词存在于适配器与鉴权配置。它同时是常见英文词，拿它命名领域目录或函数会让代码检索与后续多 provider 扩展失真；因此领域层只把 provider id 当数据，边界由 `test/imagegen-boundary.test.ts` 守住。

## 生成与失败边界

图像生成是内容工具，不进入游戏事务；基础设施不暴露 HTTP 入口。调用方拿到的是已落盘的资产与 meta，而不是会过期的远端 URL。请求按模型能力校验，模型不支持的参数直接拒绝，避免「调用成功但参数被静默忽略」。

预期内失败抛 `ImageGenError`，传输层不自动重试；批量入口限制并发并按请求顺序返回，单项失败不影响其它项。失败分类与重试责任沿用 LLM 层的约定。

→ 参见：[LLM 基础组件](llm.md)

## CLI

`apps/server/scripts/image.ts` 是这套基建目前唯一的命令行入口：commander 装配子命令，每个子命令 = 一段 help 文案 + 一份 zod 参数 schema + 一个执行函数，新增命令只加一个描述符；参数校验、`--json` 判定与退出码在装配层统一处理，命令体只负责「入参 → 服务层调用 → 输出」。

stdout 只放结果：默认是人类可读摘要，加 `--json` 输出 `{ ok, ... }` 信封。失败时 stdout 为空，错误以 `{ ok: false, error }` 写到 stderr（`ImageGenError` 额外带 `kind`、`statusCode`、`retryable`、`details`），调用方始终只解析一份 JSON；退出码 0 成功、1 失败。CLI 只是调用方之一：它不改写 provider 边界，也不把生成引入 HTTP 契约。

## 资产

raw 文件与 meta 成对存在，filename 是唯一键，目录按运行期约定放置。meta 记录可复现的生成溯源，但不写入本地输入文件的 data URL——否则 meta 会随输入体积膨胀，并可能泄露不该落盘的字节。扩展名以产物实际字节与响应头为准，避免声明格式与文件内容不符。

资产是生成事实，不是游戏状态；把 filename 交给世界 / 舞台属于业务侧接入。

→ 参见：[开发规范](conventions.md)

## 接入边界

业务侧接入时只消费 `ImageGenerationService` 与 meta，不改变 provider 边界；世界 / 舞台如何持有资产、何时生成、如何展示都不在本模块定义。

→ 参见：[架构与契约](architecture.md)
