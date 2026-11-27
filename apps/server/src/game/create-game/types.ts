import type { World } from "../world-definition";

/**
 * 建局的输入与内部引用。
 *
 * `world` 只在创建时读取，之后一律以数据库状态为准——内容是模板，状态是事实。
 */

export type PromptDump = { name: string; prompt: string };
/** 建局期的一次 actor 物化结果：后面几步要靠 id、签名编号与名字。 */
export type OpeningActorRef = {
  actorId: string;
  signatureId: string;
  /** 签名的实体序号；开局观察里的 `#编号` 与回合输入同一套。 */
  signatureSeq: number;
  name: string;
};

/** `createGame` 的输入；`world` 只在创建时读取，之后以数据库状态为准。 */
export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  world: World;
};
