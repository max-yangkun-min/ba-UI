/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 仅本地开发服务用来生成 /shell-site.js，不会打进生产包。不要写令牌。 */
  readonly VITE_EMBED_ORIGIN?: string;
  /** 对话工作台「开发空间」跳转地址。留空则标签可见但不跳转。 */
  readonly VITE_DEV_SPACE_URL?: string;
  /** 管理页「管理空间」跳转地址。留空则标签可见但不跳转。 */
  readonly VITE_ADMIN_SPACE_URL?: string;
}

interface Window {
  __EMBED_ORIGIN__?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
