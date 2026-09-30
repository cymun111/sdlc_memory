export const hookEventTypes = [
  'agent.session.started',
  'agent.task.started',
  'agent.task.completed',
  'candidate.received',
  'knowledge.change.proposed',
  'knowledge.published',
  'source.changed',
  'maintenance.tick'
] as const;

export type HookEventType = (typeof hookEventTypes)[number];

export interface HookEvent {
  event_id: string;
  event_type: HookEventType;
  schema_version: 1;
  occurred_at: string;
  payload: Record<string, unknown>;
}
