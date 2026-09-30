import { describe, expect, it } from 'vitest';
import { HookDispatcher } from '../../src/hooks/dispatcher.js';

describe('HookDispatcher', () => {
  it('rejects event names outside the built-in allowlist', () => {
    const dispatcher = new HookDispatcher();
    expect(() => dispatcher.register('run-shell-command', async () => undefined)).toThrow('Unsupported hook event');
  });

  it('dispatches an explicitly registered built-in event', async () => {
    const dispatcher = new HookDispatcher();
    dispatcher.register('maintenance.tick', async () => ({ state: 'ok' }));
    await expect(dispatcher.dispatch({ event_id: 'e1', event_type: 'maintenance.tick', schema_version: 1, occurred_at: new Date().toISOString(), payload: {} })).resolves.toEqual({ state: 'ok' });
  });
});
