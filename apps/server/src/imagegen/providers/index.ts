/**
 * provider 注册表。
 *
 * 领域层只从这里拿默认 provider，不直接依赖任何厂商文件；新增 provider 时
 * 在这里显式注册，保持「显式覆盖隐式默认」的约定。
 */

export {
  API_TOKEN_ENV,
  createReplicateProvider as createImageProvider,
  DEFAULT_MODEL as DEFAULT_IMAGE_MODEL,
  PROVIDER_ID as IMAGE_PROVIDER_ID,
  ReplicateProvider as HostedImageProvider,
} from "./replicate";

import { createReplicateProvider } from "./replicate";

/** 全项目共用的默认图像 provider：无状态，可并发复用。 */
export const DEFAULT_IMAGE_PROVIDER = createReplicateProvider();
