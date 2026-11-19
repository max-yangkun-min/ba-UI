import { EmbedChatSpace } from "./EmbedChatSpace";

/** 普通对话。切换标签在内层对话侧栏顶部，下面仍是原来的 Blade 对话。 */
export function HomePage() {
  return <EmbedChatSpace mode="chat" />;
}
