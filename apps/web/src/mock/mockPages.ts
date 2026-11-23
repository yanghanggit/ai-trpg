import { entryMock } from "./pages/entry";
import { gameMock } from "./pages/game";
import type { MockPage } from "./types";

/**
 * mock 目录：页面清单之外的第二份登记，只存在于 dev 入口。
 *
 * 这里列出的页面必须与 `pages/registry.ts` 的 `key` 一致（有用例守住）。
 */
export const mockPages: MockPage[] = [entryMock, gameMock];
