/**
 * 客户端读模型：HTTP 返回体里「actor 看到的」「stage 看到的」这些形状。
 *
 * 只服务客户端 API：结构化字段、引用由引擎按观察者渲染、不缓存状态。模型回合读的文本
 * 不在这里（那在各自的 `*-turn/`）；数据库行的读取在 `read/`，别把三层混成一层。
 */

export { getActorView } from "./actor";
export { getStageView } from "./stage";
export * from "./types";
