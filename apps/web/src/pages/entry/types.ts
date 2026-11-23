/** 入口页要显示的数据。建局是一次交互，不属于数据，由 `onCreate` 注入。 */
export type EntryPageData = {
  identity?: { username: string; displayName: string };
  /** 可选内容包；`undefined` 表示还没读到。 */
  packs?: string[];
  /** 内容包读取失败时的一句话。 */
  packsError?: string;
};

export type CreateGameRequest = {
  seed: string;
  slug?: string;
};

/**
 * 建一局。成功返回 slug，失败抛出可展示的错误。
 *
 * 页面只管调用与显示，跳转由注入方决定——mock 因此可以模拟「建局成功」而不写入任何东西。
 */
export type CreateGameHandler = (input: CreateGameRequest) => Promise<string | undefined>;
