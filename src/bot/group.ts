import type { LarkChannel } from '@larksuite/channel';

export interface CreateBoundChatOptions {
  channel: LarkChannel;
  name: string;
  inviteOpenId: string;
  description?: string;
  /** Create a topic group (chat_mode "topic") instead of a regular group. */
  topic?: boolean;
}

export interface CreatedChat {
  chatId: string;
  name: string;
}

/**
 * Create a private group chat with the bot (as creator) and one user, and
 * return its chat_id. Pass `topic: true` to create a **topic group** instead of
 * a regular group: the `@larksuite/channel` wrapper types `chatMode` as
 * `'group'` only, but it passes `chat_mode` straight through at runtime, so
 * casting `'topic'` makes Feishu create a topic group (verified end-to-end —
 * the resulting chat's `getChatMode` returns `'topic'`). Requires `im:chat:create`.
 */
export async function createBoundChat(opts: CreateBoundChatOptions): Promise<CreatedChat> {
  const { channel, name, inviteOpenId, description, topic } = opts;
  const { chatId } = await channel.createChat({
    name,
    description,
    ...(topic ? { chatMode: 'topic' as 'group' } : {}),
    inviteUserIds: [inviteOpenId],
    userIdType: 'open_id',
  });
  return { chatId, name };
}

export function defaultChatName(agentName = 'Agent'): string {
  const d = new Date();
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return `${agentName} · ${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
