import { hookEventTypes, type HookEvent } from './events.js';

export type HookHandler = (event: HookEvent) => Promise<unknown>;

export class HookDispatcher {
  readonly #handlers = new Map<string, HookHandler>();

  register(eventType: string, handler: HookHandler): void {
    if (!hookEventTypes.includes(eventType as (typeof hookEventTypes)[number])) {
      throw new Error(`Unsupported hook event: ${eventType}`);
    }
    this.#handlers.set(eventType, handler);
  }

  async dispatch(event: HookEvent): Promise<unknown> {
    if (!hookEventTypes.includes(event.event_type)) throw new Error('Unsupported hook event');
    const handler = this.#handlers.get(event.event_type);
    if (!handler) throw new Error(`No handler registered for ${event.event_type}; hook runtime is not configured`);
    return handler(event);
  }
}
