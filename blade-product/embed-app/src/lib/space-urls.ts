import { useEffect, useState } from "react";

export type SpaceUrls = { dev: string; admin: string };

const EMPTY: SpaceUrls = { dev: "", admin: "" };

/** 只接受 http(s)。空字符串表示该标签不跳转。 */
export function usableSpaceUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 2048) return "";
  if (/[\u0000-\u0020<>"'`]/.test(text)) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  } catch {
    return "";
  }
  return text;
}

/** 两个空间标签共用：把运行时配置的地址交给顶层窗口，不在当前 iframe 里加载。 */
export function assignTopHref(href: string) {
  const topWindow = window.top ?? window;
  topWindow.location.href = href;
}

/** 运行时读取 /api/space-urls。不使用打进包里的 VITE 变量。 */
export function useSpaceUrls(): SpaceUrls {
  const [urls, setUrls] = useState<SpaceUrls>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/space-urls", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { dev?: unknown; admin?: unknown } | null) => {
        if (cancelled || !data) return;
        setUrls({
          dev: usableSpaceUrl(data.dev),
          admin: usableSpaceUrl(data.admin),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return urls;
}
