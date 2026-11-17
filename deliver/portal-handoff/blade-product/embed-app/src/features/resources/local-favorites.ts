const STORAGE_KEY = "blade.portal.favorites.v1";

function readMap(): Record<string, true> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, true> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true && key) map[key] = true;
    }
    return map;
  } catch {
    return {};
  }
}

export function readLocalFavorite(key: string) {
  if (!key) return false;
  return readMap()[key] === true;
}

export function writeLocalFavorite(key: string, favored: boolean) {
  if (!key) return favored;
  const map = readMap();
  if (favored) map[key] = true;
  else delete map[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 写不进时仍让当前页面先切换，避免按钮点了没反应。
  }
  return favored;
}
