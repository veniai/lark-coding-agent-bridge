import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LarkChannel } from '@larksuite/channel';
import { createBoundChat, defaultChatName } from '../../../src/bot/group.js';

describe('group chat helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the current agent display name in generated chat names', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 25, 16, 52, 0));

    expect(defaultChatName('Codex')).toBe('Codex · 5-25 16:52');
  });
});

describe('createBoundChat', () => {
  it('creates a TOPIC group when topic:true and invites the sender', async () => {
    const createChat = vi.fn().mockResolvedValue({ chatId: 'oc_new' });
    const channel = { createChat } as unknown as LarkChannel;

    const created = await createBoundChat({
      channel,
      name: 'myproj',
      inviteOpenId: 'ou_me',
      topic: true,
    });

    expect(created).toEqual({ chatId: 'oc_new', name: 'myproj' });
    expect(createChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatMode: 'topic',
        inviteUserIds: ['ou_me'],
        userIdType: 'open_id',
      }),
    );
  });

  it('creates a regular group (no chatMode) when topic is not set', async () => {
    const createChat = vi.fn().mockResolvedValue({ chatId: 'oc_grp' });
    const channel = { createChat } as unknown as LarkChannel;

    await createBoundChat({ channel, name: 'grp', inviteOpenId: 'ou_me' });

    expect(createChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ chatMode: expect.anything() }),
    );
  });
});
