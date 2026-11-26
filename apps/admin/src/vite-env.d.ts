/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 服务端地址；缺省时用 @ai-trpg/shared 的默认端口拼出 localhost。 */
  readonly VITE_API_BASE_URL?: string;
  /** 管理后台 dev server 端口；缺省时用 @ai-trpg/shared 的默认值。 */
  readonly VITE_ADMIN_PORT?: string;
  /** 后台身份名；缺省时用 @ai-trpg/shared 的 DEFAULT_ADMIN_USERNAME。 */
  readonly VITE_ADMIN_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
