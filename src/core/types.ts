export type Scope =
  | { kind: 'shared' }
  | { kind: 'team'; team_id: string }
  | { kind: 'repo'; repo_id: string }
  | { kind: 'cross-repo'; repo_ids: string[] };

export interface KnowledgeRecord {
  schema_version: 1;
  id: string;
  title: string;
  summary: string;
  type: 'observed-behavior' | 'approved-policy' | 'decision' | 'practice' | 'troubleshooting' | 'overview';
  scope: Scope;
  status: 'candidate' | 'verified' | 'disputed' | 'superseded' | 'rejected';
  owner: string;
  sources: Array<Record<string, unknown>>;
  relationships: Array<{ type: string; target: string }>;
  created_at: string;
  updated_at: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ValidationIssue {
  file: string;
  message: string;
}
