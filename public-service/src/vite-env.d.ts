/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 仅本地开发服务用来生成 /shell-site.js，不会打进生产包。不要写令牌。 */
  readonly VITE_EMBED_ORIGIN?: string;
}

interface Window {
  __EMBED_ORIGIN__?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
