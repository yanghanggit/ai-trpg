/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 服务端地址；缺省时用 @ai-trpg/shared 的默认端口拼出 localhost。 */
  readonly VITE_API_BASE_URL?: string;
  /** Web dev server 端口；缺省时用 @ai-trpg/shared 的默认值。 */
  readonly VITE_DEV_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
