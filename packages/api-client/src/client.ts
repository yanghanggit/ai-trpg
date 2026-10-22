import createClient from "openapi-fetch";
import type { paths } from "./schema";

/** 带完整契约类型的 openapi-fetch 实例类型。 */
export type ApiClient = ReturnType<typeof createApiClient>;

/** 创建指向某个服务端地址的客户端；baseUrl 不含结尾斜杠。 */
export function createApiClient(baseUrl: string) {
  return createClient<paths>({
    baseUrl,
    // 延迟到请求发生时才读取 globalThis.fetch：测试可以在 import 之后再 stub 它。
    fetch: (...args) => globalThis.fetch(...args),
  });
}
