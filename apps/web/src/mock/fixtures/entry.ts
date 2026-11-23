import type { EntryPageData } from "../../pages/entry/types";

/** 入口页的可见状态。新增一个就必须补 fixture，类型会强制。 */
export const entryFixtures = {
  ready: {
    identity: { username: "demo", displayName: "演示用户" },
    packs: ["dark-fantasy:bell-monastery", "dark-fantasy:crow-grave"],
  },
  noPacks: {
    identity: { username: "demo", displayName: "演示用户" },
    packs: [],
  },
  packsError: {
    identity: { username: "demo", displayName: "演示用户" },
    packsError: "无法连接服务端，请确认服务已启动且地址正确",
  },
  unknownIdentity: {
    packs: ["dark-fantasy:crow-grave"],
  },
  /** 数据与 ready 相同，只是这个状态下的建局回调会失败。 */
  createError: {
    identity: { username: "demo", displayName: "演示用户" },
    packs: ["dark-fantasy:crow-grave"],
  },
} satisfies Record<string, EntryPageData>;

export type EntryMockState = keyof typeof entryFixtures;
