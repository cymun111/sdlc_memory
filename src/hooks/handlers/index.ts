import type { HookHandler } from '../dispatcher.js';

export const unavailableHandler: HookHandler = async (event) => ({
  state: 'not-configured',
  event_id: event.event_id,
  detail: 'This starter defines the event contract only; durable hook processing is not implemented.'
});
