/** 运营在 .env 里改 VITE_ADMIN_SPACE_URL。留空时标签还在，点击不跳转。 */
export function adminSpaceUrl(): string {
  const value = import.meta.env.VITE_ADMIN_SPACE_URL;
  return typeof value === "string" ? value.trim() : "";
}
