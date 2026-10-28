/**
 * 图像生成基建入口（provider 无关）。
 *
 * 分层（由上到下）：
 *
 * 1. 语义化入口：`generateText` / `edit`（挂在默认服务上）；
 * 2. 服务层：`ImageGenerationService`（预测 → 下载 → raw + meta）；
 * 3. 批量引擎：`batchGenerateImages`（并发上限、失败隔离、等长同序）；
 * 4. 资产层：`ImageAssetStore` / `downloadImage` / meta schema；
 * 5. provider：`providers/` 下的厂商适配器，领域层只依赖 `ImageProvider` 接口。
 *
 * 独立 CLI 见 `apps/server/scripts/image.ts`；本模块不提供 HTTP 路由，也不接游戏业务。
 */

export {
  type DownloadedImage,
  defaultImagesDir,
  detectImageFormat,
  downloadImage,
  IMAGE_FORMATS,
  IMAGE_META_SCHEMA_VERSION,
  IMAGE_META_SUFFIX,
  ImageAssetStore,
  type ImageMeta,
  imageFormatFromContentType,
  imageFormatFromUrl,
  imageMetaSchema,
  isImageSource,
  newImageFilename,
  normalizeImageFormat,
  type SavedImageAsset,
} from "./assets";
export {
  type BatchGenerateImagesOptions,
  batchGenerateImages,
  type ImageBatchFailure,
  type ImageBatchResult,
  type ImageBatchSuccess,
} from "./batch";
export { ImageGenError, type ImageGenErrorKind, type ImageGenErrorOptions } from "./errors";
export {
  consoleLogger,
  type ImageLogger,
  loggerFromPino,
  type PinoLikeLogger,
  silentLogger,
} from "./logger";
export {
  createImageProvider,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_PROVIDER,
  IMAGE_PROVIDER_ID,
} from "./providers";
export {
  type EditImageInput,
  type GeneratedImage,
  ImageGenerationService,
  type ImageGenerationServiceOptions,
  type TextToImageInput,
} from "./service";
export {
  type FetchLike,
  type ImageGenerationRequest,
  type ImageModelCapabilities,
  type ImageModelInfo,
  type ImageOutputFormat,
  type ImageProvider,
  type ImageSource,
  imageGenerationRequestSchema,
  imageOutputFormatSchema,
  imageSourceSchema,
  type ProviderGeneration,
  type ProviderStatus,
} from "./types";

import { DEFAULT_IMAGE_PROVIDER } from "./providers";
import { ImageGenerationService } from "./service";

/** 全项目共用的默认图像服务：无状态，可并发复用。 */
export const IMAGE_SERVICE = new ImageGenerationService({ provider: DEFAULT_IMAGE_PROVIDER });
