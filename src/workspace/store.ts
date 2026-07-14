import { readFile } from 'node:fs/promises';
import { paths } from '../config/paths';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';

interface WorkspaceData {
  chats: Record<string, { cwd: string }>;
  named: Record<string, string>;
}

export class WorkspaceStore {
  private data: WorkspaceData = { chats: {}, named: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = paths.workspacesFile) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as Partial<WorkspaceData>;
      this.data = {
        chats: parsed.chats ?? {},
        named: parsed.named ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  cwdFor(chatId: string): string | undefined {
    return this.data.chats[chatId]?.cwd;
  }

  /**
   * Derive the cwd storage key for a session scope. A topic-group topic has scope
   * `${chatId}:${threadId}` (chatId is `oc_`-prefixed); all topics in a group share
   * ONE project workspace stored at the chatId level, so the topic scope maps to its
   * group (chatId) key. Bare chatId and doc-comment (`comment:…`) scopes map to
   * themselves. Shared by {@link cwdForScope} (read) and {@link setCwdForScope}
   * (write) so writers and readers can never drift onto different keys.
   */
  private groupKeyForScope(scope: string): string {
    if (scope.startsWith('oc_')) {
      const colon = scope.indexOf(':');
      if (colon > 0) return scope.slice(0, colon);
    }
    return scope;
  }

  /**
   * Resolve cwd by session scope. Topic scopes resolve to their group (chatId) cwd;
   * there is intentionally NO per-topic cwd layer (one project = one workspace).
   * Returns undefined when nothing is set; callers add `?? profileConfig.workspaces.default`.
   */
  cwdForScope(scope: string): string | undefined {
    return this.cwdFor(this.groupKeyForScope(scope));
  }

  /**
   * Set cwd keyed by session scope, mirroring {@link cwdForScope}: a topic scope
   * writes the group (chatId) cwd every topic shares; any other scope writes its
   * own entry. Use this (not raw `setCwd(scope, …)`) so writes match what
   * `cwdForScope` reads.
   */
  setCwdForScope(scope: string, cwd: string): void {
    this.setCwd(this.groupKeyForScope(scope), cwd);
  }

  setCwd(chatId: string, cwd: string): void {
    this.data.chats[chatId] = { cwd };
    this.schedulePersist();
  }

  removeCwd(chatId: string): boolean {
    if (!(chatId in this.data.chats)) return false;
    delete this.data.chats[chatId];
    this.schedulePersist();
    return true;
  }

  listCwds(prefix?: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.data.chats)) {
      if (prefix && !key.startsWith(prefix)) continue;
      out[key] = value.cwd;
    }
    return out;
  }

  listNamed(): Record<string, string> {
    return { ...this.data.named };
  }

  getNamed(name: string): string | undefined {
    return this.data.named[name];
  }

  saveNamed(name: string, cwd: string): void {
    this.data.named[name] = cwd;
    this.schedulePersist();
  }

  removeNamed(name: string): boolean {
    if (!(name in this.data.named)) return false;
    delete this.data.named[name];
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((err: unknown) => {
        log.fail('workspace', err, { step: 'persist' });
      });
  }
}
