import type { World } from "../world-definition";

/**
 * 建局的输入与内部引用。
 *
 * `world` 只在创建时读取，之后一律以数据库状态为准——内容是模板，状态是事实。
 */

export type PromptDump = { name: string; prompt: string };
/** 建局期的一次 actor 物化结果：内容 key 之外，后面几步要靠这两个 id。 */
export type OpeningActorRef = { actorId: string; signatureId: string; name: string };

/** `createGame` 的输入；`world` 只在创建时读取，之后以数据库状态为准。 */
export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  world: World;
};
