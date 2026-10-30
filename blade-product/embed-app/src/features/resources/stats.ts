export type ResourceStat = {
  label: string;
  value?: number;
  hint?: string;
  scale?: number;
};

const usageFields: Array<{ keys: string[]; label: string; hint: string }> = [
  { keys: ["call_count", "calls", "usage", "use_count", "usage_count"], label: "用量", hint: "调用次数" },
  { keys: ["download_count", "downloads"], label: "用量", hint: "下载量" },
  { keys: ["install_count", "install_total", "installs"], label: "用量", hint: "安装量" },
  { keys: ["hot", "heat", "hotness"], label: "热度", hint: "热度" },
];

const ratingKeys = ["rating_avg", "rating", "score", "stars", "star"];

export const emptyUsage: ResourceStat = { label: "暂无用量" };
export const emptyRating: ResourceStat = { label: "暂无评分" };

export function readUsage(row: Record<string, unknown>): ResourceStat {
  for (const field of usageFields) {
    for (const key of field.keys) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
      const value = finite(row[key]);
      if (value === undefined) continue;
      return { label: field.label, value, hint: field.hint };
    }
  }
  return emptyUsage;
}

export function readRating(row: Record<string, unknown>): ResourceStat {
  for (const key of ratingKeys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = finite(row[key]);
    if (value === undefined) continue;
    const scale = finite(row.rating_max) ?? finite(row.score_max) ?? finite(row.max_score);
    return {
      label: "评分",
      value,
      hint: scale === undefined ? undefined : `${trimNumber(scale)} 分制`,
      scale,
    };
  }
  return emptyRating;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function formatStatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const wan = value / 10000;
    const rounded = Math.round(wan * 10) / 10;
    return `${trimNumber(rounded)}万`;
  }
  return trimNumber(Math.round(value * 100) / 100);
}

function trimNumber(value: number) {
  return String(value);
}
