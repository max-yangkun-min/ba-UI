export type LocalDiscussion = {
  id: string;
  text: string;
  author: string;
  time: string;
};

const STORAGE_KEY = "blade.portal.discussions.v1";

function readAll(): Record<string, LocalDiscussion[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, LocalDiscussion[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !Array.isArray(value)) continue;
      const posts = value.filter(isDiscussion);
      if (posts.length) map[key] = posts;
    }
    return map;
  } catch {
    return {};
  }
}

function isDiscussion(value: unknown): value is LocalDiscussion {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LocalDiscussion>;
  return typeof row.id === "string" && typeof row.text === "string" && typeof row.author === "string" && typeof row.time === "string";
}

export function readLocalDiscussions(key: string) {
  if (!key) return [];
  return readAll()[key] ?? [];
}

export function addLocalDiscussion(key: string, text: string, author: string) {
  const body = text.trim();
  if (!key || !body) return readLocalDiscussions(key);
  const post: LocalDiscussion = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: body,
    author: author.trim() || "访客",
    time: new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  };
  const map = readAll();
  map[key] = [post, ...(map[key] ?? [])];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 写不进时仍把这条留在当前列表里。
  }
  return map[key];
}
