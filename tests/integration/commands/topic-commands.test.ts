import { afterEach, describe, expect, it, vi } from 'vitest';
import { realpath } from 'node:fs/promises';
import type { NormalizedMessage } from '@larksuite/channel';
import { ActiveRuns } from '../../../src/bot/active-runs.js';
import { tryHandleCommand, type CommandContext, type Controls } from '../../../src/commands/index.js';
import { createDefaultProfileConfig, type ProfileConfig } from '../../../src/config/profile-schema.js';
import { SessionStore } from '../../../src/session/store.js';
import { WorkspaceStore } from '../../../src/workspace/store.js';
import { createFakeAgent } from '../../helpers/fake-agent.js';
import { createFakeChannel, type FakeChannel } from '../../helpers/fake-channel.js';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile.js';

const CHAT_ID = 'oc_chat-1';
const THREAD_ID = 'omt_t1';
const SCOPE = `${CHAT_ID}:${THREAD_ID}`;

interface Harness {
  tmp: TmpProfile;
  channel: FakeChannel;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  activeRuns: ActiveRuns;
  controls: Controls;
  run(content: string): Promise<boolean>;
}

const cleanups: Array<() => Promise<void>> = [];

describe('topic-group slash commands', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('/cd in a topic writes the GROUP (chatId) cwd, not the topic scope', async () => {
    const h = await createHarness();
    h.sessions.set(SCOPE, 'old-topic-session', h.tmp.workspace);

    await expect(h.run(`/cd ${h.tmp.workspace}`)).resolves.toBe(true);

    const real = await realpath(h.tmp.workspace);
    expect(h.workspaces.cwdFor(CHAT_ID)).toBe(real); // group-level cwd set
    expect(h.workspaces.cwdFor(SCOPE)).toBeUndefined(); // NOT written to the topic scope
    expect(h.sessions.getRaw(SCOPE)).toBeUndefined(); // current topic session cleared
    expect(lastMarkdown(h.channel)).toContain('本群'); // reply names the group workspace
  });

  it('/resume is allowed in a topic (lists history instead of blocking)', async () => {
    const h = await createHarness();
    h.workspaces.setCwd(CHAT_ID, h.tmp.workspace); // project cwd so /resume has a cwd

    await expect(h.run('/resume')).resolves.toBe(true);

    // NOT the group-block message
    expect(JSON.stringify(lastContent(h.channel))).not.toContain('群聊中不展示');
    // a resume card was sent (went to the listing path, not the block)
    expect(lastContent(h.channel)).toHaveProperty('card');
  });

  it('/ws use in a topic writes the GROUP cwd (not the topic scope)', async () => {
    const h = await createHarness();
    h.workspaces.setCwd(CHAT_ID, h.tmp.workspace); // project cwd so /ws save has a cwd
    await expect(h.run('/ws save main')).resolves.toBe(true);

    h.workspaces.setCwd(CHAT_ID, '/other'); // change it away
    await expect(h.run('/ws use main')).resolves.toBe(true);

    const real = await realpath(h.tmp.workspace);
    expect(h.workspaces.cwdFor(CHAT_ID)).toBe(real); // group cwd restored
    expect(h.workspaces.cwdFor(SCOPE)).toBeUndefined(); // NOT written to the topic scope
  });
});

async function createHarness(): Promise<Harness> {
  const tmp = await createTmpProfile('topic-commands-test-');
  const channel = createFakeChannel();
  const sessions = new SessionStore(`${tmp.profile}/sessions.json`);
  const workspaces = new WorkspaceStore(`${tmp.profile}/workspaces.json`);
  const activeRuns = new ActiveRuns();
  const agent = createFakeAgent();
  const profileConfig = appConfig(tmp.workspace);
  const controls = {
    profile: 'claude',
    profileConfig,
    botOwnerId: 'ou-user',
    ownerRefreshState: 'ok',
    async refreshOwner() {},
    restart: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
    configPath: `${tmp.profile}/config.json`,
    cfg: profileConfig,
    processId: 'proc-1',
  } satisfies Controls;

  const run = (content: string): Promise<boolean> =>
    tryHandleCommand({
      channel: channel as unknown as CommandContext['channel'],
      msg: message(content),
      scope: SCOPE,
      chatMode: 'topic',
      sessions,
      workspaces,
      agent,
      activeRuns,
      controls,
    });

  const cleanup = async (): Promise<void> => {
    await Promise.all([sessions.flush(), workspaces.flush()]);
    await tmp.cleanup();
  };
  cleanups.push(cleanup);

  return { tmp, channel, sessions, workspaces, activeRuns, controls, run };
}

function appConfig(defaultWorkspace: string): ProfileConfig {
  const config = createDefaultProfileConfig({
    agentKind: 'claude',
    accounts: { app: { id: 'app-id', secret: 'secret', tenant: 'feishu' } },
    access: { admins: ['ou-user'] },
  });
  config.workspaces.default = defaultWorkspace;
  return config;
}

function message(content: string): NormalizedMessage {
  return {
    messageId: `om-${content.replace(/\W+/g, '-').slice(0, 20)}`,
    chatId: CHAT_ID,
    threadId: THREAD_ID,
    chatType: 'group',
    senderId: 'ou-user',
    senderName: 'User',
    content,
    resources: [],
    mentionedBot: false,
  } as unknown as NormalizedMessage;
}

function lastContent(channel: FakeChannel): Record<string, unknown> {
  const content = channel.sent.at(-1)?.content;
  expect(content).toBeTypeOf('object');
  return content as Record<string, unknown>;
}

function lastMarkdown(channel: FakeChannel): string {
  const content = lastContent(channel);
  expect(content.markdown).toBeTypeOf('string');
  return content.markdown as string;
}
