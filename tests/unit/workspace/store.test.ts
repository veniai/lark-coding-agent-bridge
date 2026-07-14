import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../../../src/workspace/store';

describe('WorkspaceStore scope-keyed cwd (cwdForScope / setCwdForScope)', () => {
  let dir: string;
  let store: WorkspaceStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ws-store-'));
    store = new WorkspaceStore(join(dir, 'workspaces.json'));
  });
  afterEach(async () => {
    await store.flush();
    rmSync(dir, { recursive: true, force: true });
  });

  // ── cwdForScope (read) ────────────────────────────────────────────────
  it('topic scope (oc_xxx:threadId) falls back to the group (chatId) cwd', () => {
    store.setCwd('oc_chat1', '/code/proj');
    expect(store.cwdForScope('oc_chat1:omt_t1')).toBe('/code/proj');
  });

  it('topic scope with no group cwd returns undefined (caller adds ?? default)', () => {
    expect(store.cwdForScope('oc_chat1:omt_t1')).toBeUndefined();
  });

  it('does NOT read a per-topic cwd entry — group cwd wins (no per-topic layer)', () => {
    store.setCwd('oc_chat1:omt_t1', '/topic-only');
    store.setCwd('oc_chat1', '/group');
    expect(store.cwdForScope('oc_chat1:omt_t1')).toBe('/group');
    store.removeCwd('oc_chat1');
    expect(store.cwdForScope('oc_chat1:omt_t1')).toBeUndefined();
  });

  it('bare chatId (no colon) behaves like cwdFor', () => {
    store.setCwd('oc_chat1', '/code/proj');
    expect(store.cwdForScope('oc_chat1')).toBe('/code/proj');
    expect(store.cwdForScope('oc_chat1')).toBe(store.cwdFor('oc_chat1'));
  });

  it('comment: scope is NOT misclassified as topic (no split, no group leak)', () => {
    expect(store.cwdForScope('comment:abc123')).toBeUndefined();
    store.setCwd('oc_chat1', '/code/proj');
    expect(store.cwdForScope('comment:abc123')).toBeUndefined();
  });

  it('p2p / non-oc scope without colon returns its own cwd', () => {
    store.setCwd('oc_p2p', '/home/me');
    expect(store.cwdForScope('oc_p2p')).toBe('/home/me');
  });

  // ── setCwdForScope (write) ────────────────────────────────────────────
  it('topic scope writes the GROUP (chatId) cwd, not the topic scope', () => {
    store.setCwdForScope('oc_chat1:omt_t1', '/code/proj');
    expect(store.cwdFor('oc_chat1')).toBe('/code/proj');
    expect(store.cwdFor('oc_chat1:omt_t1')).toBeUndefined();
  });

  it('bare chatId writes its own entry', () => {
    store.setCwdForScope('oc_chat1', '/code/proj');
    expect(store.cwdFor('oc_chat1')).toBe('/code/proj');
  });

  it('comment: scope writes its own entry (no split, no group write)', () => {
    store.setCwdForScope('comment:abc', '/x');
    expect(store.cwdFor('comment:abc')).toBe('/x');
    expect(store.cwdFor('comment')).toBeUndefined();
  });

  it('write then read round-trips, and another topic inherits the group cwd', () => {
    store.setCwdForScope('oc_chat1:omt_t1', '/code/proj');
    expect(store.cwdForScope('oc_chat1:omt_t1')).toBe('/code/proj');
    expect(store.cwdForScope('oc_chat1:omt_t2')).toBe('/code/proj');
  });
});
