import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../../src/card/run-state';

describe('run state terminal event schema', () => {
  it('maps done termination reasons onto visible terminal states', () => {
    expect(reduce(initialState, { type: 'done', terminationReason: 'normal' }).terminal).toBe(
      'done',
    );
    expect(
      reduce(initialState, { type: 'done', terminationReason: 'interrupted' }).terminal,
    ).toBe('interrupted');
    expect(reduce(initialState, { type: 'done', terminationReason: 'timeout' }).terminal).toBe(
      'idle_timeout',
    );
  });

  it('maps error termination reasons onto visible terminal states', () => {
    expect(
      reduce(initialState, {
        type: 'error',
        message: 'failed',
        terminationReason: 'failed',
      }).terminal,
    ).toBe('error');
    expect(
      reduce(initialState, {
        type: 'error',
        message: 'stopped',
        terminationReason: 'interrupted',
      }).terminal,
    ).toBe('interrupted');
    expect(
      reduce(initialState, {
        type: 'error',
        message: 'timeout',
        terminationReason: 'timeout',
      }).terminal,
    ).toBe('idle_timeout');
  });
});

describe('run state retry tracking', () => {
  it('records retry attempt and flags the footer as retrying', () => {
    const retried = reduce(initialState, {
      type: 'retry',
      attempt: 3,
      maxRetries: 10,
    });
    expect(retried.retry).toEqual({ attempt: 3, maxRetries: 10 });
    expect(retried.footer).toBe('retrying');
  });

  it('clears retry once normal output resumes', () => {
    const retried = reduce(initialState, { type: 'retry', attempt: 1, maxRetries: 10 });
    const resumed = reduce(retried, { type: 'text', delta: 'hi' });
    expect(resumed.retry).toBeNull();
  });

  it('migrates footer off retrying when tool_result follows retry', () => {
    const retried = reduce(initialState, { type: 'retry', attempt: 1, maxRetries: 10 });
    const afterTool = reduce(retried, {
      type: 'tool_result',
      id: 't1',
      output: 'ok',
      isError: false,
    });
    expect(afterTool.retry).toBeNull();
    expect(afterTool.footer).not.toBe('retrying');
  });
});
