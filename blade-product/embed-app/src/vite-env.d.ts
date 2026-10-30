/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 仅本地开发服务用来生成 /blade-site.js，不会打进生产包。 */
  readonly VITE_BA_ORIGIN?: string;
}

interface Window {
  __BLADE_PUBLIC_HOST__?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
