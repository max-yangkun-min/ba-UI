import { EmbedChatSpace } from "./EmbedChatSpace";

/** 普通对话。侧栏顶上只有一个「AI对话」，下面仍是原来的 Blade 对话。 */
export function HomePage() {
  return <EmbedChatSpace mode="chat" />;
}
