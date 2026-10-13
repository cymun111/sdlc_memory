import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resolvePaths, type ResolvedPaths } from '../src/core/config.js';
import { buildActiveGeneration } from '../src/indexing/build-index.js';
import { KnowledgeService, type ContextBundle } from '../src/retrieval/service.js';
import { createMcpServer } from '../src/mcp/server.js';
import { DomainError } from '../src/capture/candidate-store.js';

const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }).strict(),
  z.object({ kind: z.literal('team'), team_id: z.string() }).strict(),
  z.object({ kind: z.literal('repo'), repo_id: z.string() }).strict(),
  z.object({ kind: z.literal('cross-repo'), repo_ids: z.array(z.string()).min(2) }).strict()
]);
const record = z.object({ id: z.string(), scope, title: z.string(), summary: z.string(), type: z.enum(['practice', 'approved-policy']).default('practice'), status: z.enum(['verified', 'disputed', 'superseded']).default('verified'), relationships: z.array(z.object({ type: z.enum(['depends-on', 'related-to', 'contradicts']), target: z.string() }).strict()).default([]), code_revision: z.literal('old').optional(), denied_evidence: z.boolean().optional() }).strict();
const task = z.object({ id: z.string(), repo: z.string(), task: z.string(), annotation: z.string().min(10), expected: z.array(z.string()), scenario: z.enum(['normal', 'conflict', 'stale-policy', 'disputed-policy', 'no-index']).default('normal'), depth: z.number().int().min(0).max(2).optional(), topics: z.array(z.string()).optional(), changed_paths: z.array(z.string()).optional(), max_results: z.number().int().positive().optional(), status: z.enum(['ok', 'POLICY_REVIEW_REQUIRED', 'CONTEXT_BUDGET_EXCEEDED']).default('ok'), error: z.enum(['NOT_FOUND', 'INDEX_UNAVAILABLE']).optional(), freshness: z.record(z.string(), z.string()).default({}), conflict: z.boolean().default(false), issue: z.enum(['needs_revalidation', 'disputed']).optional() }).strict();
export const fixtureSchema = z.object({ version: z.literal('1.0.0'), description: z.string(), records: z.array(record).min(1), tasks: z.array(task).min(30) }).strict().superRefine((fixture, context) => {
  for (const [name, items] of [['records', fixture.records], ['tasks', fixture.tasks]] as const) {
    if (new Set(items.map((item) => item.id)).size !== items.length) context.addIssue({ code: 'custom', message: `Duplicate ${name} identifiers` });
  }
  const ids = new Set([...fixture.records.map((item) => item.id), 'orchard.choicea', 'orchard.choiceb']);
  for (const item of fixture.tasks) for (const id of item.expected) if (!ids.has(id)) context.addIssue({ code: 'custom', message: `Unknown expected record ${id}` });
  for (const item of fixture.records) for (const edge of item.relationships) if (!ids.has(edge.target)) context.addIssue({ code: 'custom', message: `Unknown relationship ${edge.target}` });
});
type Fixture = z.infer<typeof fixtureSchema>;
type Task = Fixture['tasks'][number];
type RecordDefinition = Fixture['records'][number];
export type Envelope = { ok: boolean; data: Record<string, unknown> };
export type Observation = { envelope: Envelope; calls: number; bytes: number; estimated_tokens: number; latency_ms: number };
interface CaseResult {
  id: string; annotation: string; scenario: Task['scenario']; input: object; expected: string[]; mandatory: string[]; denied_record_ids: string[];
  service: Observation; mcp: Observation; full_document: Observation;
  relevant: ReturnType<typeof recall>; full_document_relevant: ReturnType<typeof recall>; mandatory_policy: ReturnType<typeof recall>;
  stale_results: Array<{ id: string; freshness: string }>; unauthorized_exposures: string[];
  interface_match: boolean; expectation_failures: string[]; regressions: string[];
}
const repoTeams: Record<string, string> = { orchard: 'commerce', ledger: 'commerce', studio: 'creative' };
const timestamp = '2020-01-01T00:00:00Z';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const defaultFixturePath = path.join(projectRoot, 'tests/retrieval/fixtures/v1.json');

function applicable(item: RecordDefinition, repo: string): boolean {
  if (!(repo in repoTeams)) return false;
  switch (item.scope.kind) {
    case 'shared': return true;
    case 'team': return item.scope.team_id === repoTeams[repo];
    case 'repo': return item.scope.repo_id === repo;
    case 'cross-repo': return item.scope.repo_ids.includes(repo);
  }
}
function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: timestamp, GIT_COMMITTER_DATE: timestamp } }).trim();
}
function commit(root: string, message: string) {
  git(root, 'add', '.'); git(root, '-c', 'user.name=Fictional Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message);
}
function errorEnvelope(error: unknown): Envelope {
  return { ok: false, data: { error: { code: error instanceof DomainError ? error.code : 'EVALUATOR_ERROR', message: error instanceof Error ? error.message : String(error) } } };
}
function observed(envelope: Envelope, calls: number, latency_ms: number): Observation {
  const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  return { envelope, calls, bytes, estimated_tokens: Math.ceil(bytes / 3), latency_ms };
}
export function recordIds(envelope: Envelope): string[] {
  if (!envelope.ok) return [];
  const results = (envelope.data.results ?? []) as Array<{ id: string }>;
  return results.map((item) => item.id);
}
export function recall(expected: string[], returned: string[]) {
  const unique = [...new Set(expected)];
  const found = new Set(returned);
  const hits = unique.filter((id) => found.has(id)).length;
  return { hits, expected: unique.length, ratio: unique.length ? hits / unique.length : null, missing: unique.filter((id) => !found.has(id)) };
}
function policyReferences(envelope: Envelope): string[] {
  return [...recordIds(envelope), ...((envelope.data.policy_issues ?? []) as Array<{ id: string }>).map((issue) => issue.id), ...((envelope.data.omitted_mandatory_ids ?? []) as string[])];
}
function status(envelope: Envelope): string {
  return envelope.ok ? String(envelope.data.status ?? 'ok') : String((envelope.data.error as { code?: string } | undefined)?.code ?? 'MALFORMED_ERROR');
}
export function exposure(envelope: Envelope, denied: string[]): string[] {
  const serialized = JSON.stringify(envelope);
  return denied.filter((value) => serialized.includes(value));
}
function comparable(envelope: Envelope): string { return JSON.stringify(envelope); }

async function world(fixture: Fixture, scenario: Task['scenario']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-retrieval-eval-'));
  try {
    await mkdir(path.join(root, 'knowledge')); await mkdir(path.join(root, 'schemas'));
    await copyFile(path.join(projectRoot, 'schemas/knowledge.schema.json'), path.join(root, 'schemas/knowledge.schema.json'));
    await writeFile(path.join(root, '.gitignore'), '.runtime/\nsource/\n');
    const revisions: Record<string, { old: string; current: string }> = {};
    for (const id of Object.keys(repoTeams)) {
      const source = path.join(root, 'source', id); await mkdir(source, { recursive: true }); git(source, 'init');
      await writeFile(path.join(source, 'behavior.ts'), 'export const fixture = 1;\n'); commit(source, 'Fictional source before change');
      const old = git(source, 'rev-parse', 'HEAD');
      await writeFile(path.join(source, 'behavior.ts'), 'export const fixture = 2;\n'); commit(source, 'Fictional source after change');
      revisions[id] = { old, current: git(source, 'rev-parse', 'HEAD') };
    }
    const records = fixture.records.map((item) => structuredClone(item));
    if (scenario === 'conflict') {
      for (const suffix of ['a', 'b']) records.push(record.parse({ id: `orchard.choice${suffix}`, scope: { kind: 'repo', repo_id: 'orchard' }, title: `Consistency option ${suffix}`, summary: `Consistency alternative ${suffix}.`, relationships: suffix === 'a' ? [{ type: 'contradicts', target: 'orchard.choiceb' }] : [] }));
    }
    const safety = records.find((item) => item.id === 'orchard.safety')!;
    if (scenario === 'stale-policy') safety.code_revision = 'old';
    if (scenario === 'disputed-policy') safety.status = 'disputed';
    for (const item of records) {
      const sources: object[] = item.type === 'approved-policy' ? [{ kind: 'decision', url: 'https://example.invalid/fixture-approval', approver: 'synthetic-owner', approved_at: timestamp }] : [];
      if (item.code_revision) sources.push({ kind: 'code', repo_id: 'orchard', commit: revisions.orchard!.old, path: 'behavior.ts' });
      if (item.denied_evidence) sources.push({ kind: 'code', repo_id: 'vault', commit: 'f'.repeat(40), path: 'private/vault-secret.ts' });
      const header = { schema_version: 1, id: item.id, title: item.title, summary: item.summary, type: item.type, scope: item.scope, status: item.status, owner: 'synthetic-owner', sources, relationships: item.relationships, created_at: timestamp, updated_at: timestamp };
      // Long reference prose makes the full-document comparison meaningful and remains below get's cap.
      const body = `# ${item.title}\n\n${item.summary}\n\n` + 'Fictional reference detail explains assumptions and manual verification.\n'.repeat(80);
      await writeFile(path.join(root, 'knowledge', item.id + '.md'), '---\n' + stringify(header) + '---\n' + body);
    }
    git(root, 'init'); commit(root, 'Versioned fictional knowledge');
    const paths = await resolvePaths({ root });
    paths.config.repositories = Object.entries(repoTeams).map(([id, team]) => ({ id, team, name: id, owner: 'synthetic-owner', path: path.join(root, 'source', id), aliases: [] }));
    paths.config.teams = ['commerce', 'creative'];
    if (scenario !== 'no-index') await buildActiveGeneration(root, paths.runtimeRoot);
    return { root, paths, records, revisions };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
async function fullDocuments(service: KnowledgeService, definitions: RecordDefinition[], item: Task): Promise<Observation> {
  const start = performance.now(); let calls = 0; const documents: unknown[] = [];
  const ids = definitions.filter((definition) => definition.status === 'verified' && applicable(definition, item.repo)).map((definition) => definition.id).sort();
  try {
    // The manifest supplies authorized applicability, rather than a search that would inherit strict-term misses.
    for (const id of ids.length ? ids : ['shared.logging']) {
      calls += 1; documents.push(await service.get(id, item.repo, 32768));
    }
    const envelope: Envelope = { ok: true, data: { results: documents.map((document) => (document as { record: unknown }).record), documents } };
    const bytes = documents.reduce<number>((total, document) => total + Buffer.byteLength(JSON.stringify({ ok: true, data: document }), 'utf8'), 0);
    return { envelope, calls, bytes, estimated_tokens: Math.ceil(bytes / 3), latency_ms: performance.now() - start };
  } catch (error) { return observed(errorEnvelope(error), calls, performance.now() - start); }
}
export async function evaluateRetrieval(fixturePath = defaultFixturePath) {
  const fixtureText = await readFile(fixturePath, 'utf8'); const fixture = fixtureSchema.parse(JSON.parse(fixtureText));
  const cases: CaseResult[] = [];
  for (const scenario of [...new Set(fixture.tasks.map((item) => item.scenario))]) {
    const environment = await world(fixture, scenario);
    const { root, paths, revisions, records } = environment;
    const service = new KnowledgeService(paths); const server = createMcpServer(paths); const client = new Client({ name: 'retrieval-evaluator', version: fixture.version });
    try {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport); await client.connect(clientTransport);
      for (const item of fixture.tasks.filter((entry) => entry.scenario === scenario)) {
        const input = { repo_id: item.repo, task: item.task, ...(revisions[item.repo] ? { source_revision: revisions[item.repo]!.current } : {}), ...(item.depth !== undefined ? { depth: item.depth } : {}), ...(item.topics ? { topics: item.topics } : {}), ...(item.changed_paths ? { changed_paths: item.changed_paths } : {}), ...(item.max_results ? { max_results: item.max_results } : {}) };
        let start = performance.now(); let serviceEnvelope: Envelope;
        try { serviceEnvelope = { ok: true, data: await service.taskContext(input) as unknown as Record<string, unknown> }; } catch (error) { serviceEnvelope = errorEnvelope(error); }
        const direct = observed(serviceEnvelope, 1, performance.now() - start);
        start = performance.now(); const wire = await client.callTool({ name: 'get_task_context', arguments: input });
        const mcpEnvelope = wire.structuredContent as Envelope;
        if (!mcpEnvelope || typeof mcpEnvelope.ok !== 'boolean') throw new Error('MCP did not return a structured envelope');
        const mcp = observed(mcpEnvelope, 1, performance.now() - start);
        const full = await fullDocuments(service, records, item);
        const mandatory = item.error ? [] : records.filter((definition) => definition.type === 'approved-policy' && definition.status !== 'superseded' && applicable(definition, item.repo)).map((definition) => definition.id);
        const denied = records.filter((definition) => !applicable(definition, item.repo)).map((definition) => definition.id);
        // Stable sentinel checks include denied titles, summaries, repo IDs and projected source paths.
        const sentinels = [...denied, 'DENIED_VAULT_TITLE', 'DENIED_VAULT_SUMMARY', 'DENIED_TEAM_TITLE', 'DENIED_TEAM_SUMMARY', 'private/vault-secret.ts', '"vault"', '"secretteam"'];
        // An error task itself contains the denied lookup, but no task text should be echoed into the payload.
        const exposed = [...new Set([direct, mcp, full].flatMap((measurement) => exposure(measurement.envelope, sentinels)))];
        const failures: string[] = [];
        if (status(serviceEnvelope) !== (item.error ?? item.status)) failures.push(`Expected ${item.error ?? item.status}, received ${status(serviceEnvelope)}`);
        const data = serviceEnvelope.data as unknown as ContextBundle;
        for (const [id, freshness] of Object.entries(item.freshness)) if (data.results?.find((result) => result.id === id)?.freshness !== freshness) failures.push(`Freshness mismatch for ${id}`);
        if (item.conflict && !data.conflicts?.length) failures.push('Expected explicit conflict');
        if (item.issue && !data.policy_issues?.some((issue) => issue.reason === item.issue)) failures.push(`Missing policy issue ${item.issue}`);
        if (serviceEnvelope.ok && direct.bytes > paths.config.budgets.maxBytes) failures.push('Context exceeded serialized byte budget');
        if (serviceEnvelope.ok && data.estimated_tokens > paths.config.budgets.maxTokens) failures.push('Context exceeded token estimate budget');
        const relevant = recall(item.expected, recordIds(serviceEnvelope));
        const baseline = recall(item.expected, recordIds(full.envelope));
        const policies = recall(mandatory, policyReferences(serviceEnvelope));
        const stale = data.results?.filter((result) => ['needs_revalidation', 'dirty_worktree', 'unknown', 'revision_not_checked'].includes(result.freshness)).map((result) => ({ id: result.id, freshness: result.freshness })) ?? [];
        cases.push({ id: item.id, annotation: item.annotation, scenario, input: { ...input, source_revision: revisions[item.repo]?.current ?? null }, expected: item.expected, mandatory, denied_record_ids: denied, service: direct, mcp, full_document: full, relevant, full_document_relevant: baseline, mandatory_policy: policies, stale_results: stale, unauthorized_exposures: exposed, interface_match: comparable(serviceEnvelope) === comparable(mcpEnvelope), expectation_failures: failures, regressions: baseline.missing.length ? relevant.missing.filter((id) => !baseline.missing.includes(id)) : relevant.missing });
      }
    } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
  }
  cases.sort((a, b) => a.id.localeCompare(b.id));
  const ratio = (field: 'relevant' | 'mandatory_policy' | 'full_document_relevant') => {
    const expected = cases.reduce((sum, item) => sum + item[field].expected, 0); const hits = cases.reduce((sum, item) => sum + item[field].hits, 0);
    return { hits, expected, measured: expected ? hits / expected : null };
  };
  const failures = cases.flatMap((item) => item.expectation_failures.map((failure) => `${item.id}: ${failure}`));
  const exposures = cases.reduce((sum, item) => sum + item.unauthorized_exposures.length, 0);
  const mismatches = cases.filter((item) => !item.interface_match).length;
  const relevant = ratio('relevant'); const policies = ratio('mandatory_policy');
  const totals = (field: 'service' | 'mcp' | 'full_document') => ({ calls: cases.reduce((sum, item) => sum + item[field].calls, 0), bytes: cases.reduce((sum, item) => sum + item[field].bytes, 0), estimated_tokens: cases.reduce((sum, item) => sum + item[field].estimated_tokens, 0), latency_ms: cases.reduce((sum, item) => sum + item[field].latency_ms, 0) });
  return { report_version: 1, fixture_version: fixture.version, fixture_sha256: createHash('sha256').update(fixtureText).digest('hex'), generated_at: new Date().toISOString(), environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model ?? 'unknown', git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(), knowledge_source_commit: git(projectRoot, 'rev-parse', 'HEAD'), mcp_sdk: '1.31.0', transport: 'SDK InMemoryTransport', sqlite: 'node:sqlite' }, method: { retrieval: 'current strict-AND FTS plus mandatory policies and authorized curated graph expansion; no ranking changes', full_document: 'all manifest-authorized applicable verified records via get(byte_limit=32768); no task filtering; fixture bodies below cap', byte_measurement: 'UTF-8 application envelope {ok,data}; summed per get for full-document; excludes JSON-RPC framing and duplicate MCP text content', tokens: 'ceil(serialized UTF-8 bytes / 3), conservative estimate, not model tokens', mandatory_policy_recall: 'visible mandatory result OR explicit policy issue OR omitted-mandatory blocking reference; separate from normative compliance', aggregation: 'micro recall over annotated record-task pairs; empty denominators null; quality error cases have no relevant records', latency: 'one sequential sample per case, service before MCP before full-doc; setup excluded; no timing CI threshold' }, safety: { passed: failures.length === 0 && exposures === 0 && mismatches === 0, expectation_failures: failures, unauthorized_exposures: exposures, interface_mismatches: mismatches }, targets: { relevant_record_coverage: { ...relevant, target: 0.9, met: relevant.measured !== null && relevant.measured >= 0.9 }, mandatory_policy_recall: { ...policies, target: 1, met: policies.measured !== null && policies.measured === 1 }, full_document_relevant_coverage: ratio('full_document_relevant') }, totals: { service: totals('service'), mcp: totals('mcp'), full_document: totals('full_document'), stale_results: cases.reduce((sum, item) => sum + item.stale_results.length, 0), regressions: cases.filter((item) => item.regressions.length > 0).map((item) => ({ id: item.id, missing: item.regressions })) }, cases };
}
