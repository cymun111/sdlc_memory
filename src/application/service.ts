import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ResolvedPaths } from '../core/config.js';
import { DomainError, submitCandidate } from '../capture/candidate-store.js';
import { KnowledgeService } from '../retrieval/service.js';
import { parseKnowledgeMarkdown } from '../validation/record.js';
import * as contracts from './contracts.js';
import { provenance } from '../indexing/provenance.js';
import { setupRepository, uninstallRepository, inspectOnboarding } from '../onboarding/service.js';

/** Trusted local consumer boundary. Caller payloads cannot choose their principal or roots. */
export class KnowledgeApplication {
  private readonly knowledge: KnowledgeService;
  constructor(private readonly paths: ResolvedPaths) { this.knowledge = new KnowledgeService(paths); }

  private canonical(id: string): string {
    const matches = this.paths.config.repositories.filter((repo) => repo.id === id || repo.aliases.includes(id));
    if (!matches.length) throw new contracts.IntegrationContractError('NOT_FOUND', 'Repository is not registered.');
    if (matches.length !== 1) throw new contracts.IntegrationContractError('CONFLICT', 'Repository identity is ambiguous.');
    return matches[0]!.id;
  }

  private async checked<T>(schema: z.ZodType<T>, action: () => Promise<unknown>): Promise<T> {
    try {
      const result = schema.safeParse(await action());
      if (!result.success) throw new contracts.IntegrationContractError('INTERNAL_ERROR', 'The service returned an invalid integration response.');
      return result.data;
    } catch (error) {
      if (error instanceof contracts.IntegrationContractError) throw error;
      if (error instanceof DomainError) {
        const code = contracts.errorOutput.shape.code.safeParse(error.code);
        if (code.success) throw new contracts.IntegrationContractError(code.data, 'The knowledge operation could not complete.', ['INDEX_UNAVAILABLE', 'INDEX_REBUILD_REQUIRED', 'INDEX_SOURCE_CHANGED', 'INDEX_QUERY_FAILED', 'INDEX_SOURCE_UNAVAILABLE', 'INDEX_BUILD_FAILED'].includes(code.data));
      }
      throw new contracts.IntegrationContractError('INTERNAL_ERROR', 'The knowledge operation could not complete.');
    }
  }

  async setup(request: unknown) {
    return this.checked(contracts.setupOutput,() => setupRepository(this.paths,request));
  }
  async uninstall(request: unknown) { return this.checked(contracts.setupOutput,() => uninstallRepository(this.paths,request)); }

  async readiness(request: unknown) {
    const input = contracts.parseRequest(contracts.readinessRequest, request);
    const repo_id = this.canonical(input.repo_id);
    return this.checked(contracts.readinessOutput, async () => {
      let generation: string | null = null;
      let metadata: ReturnType<typeof provenance> | null = null;
      let manifest: string;
      try { manifest = await readFile(path.join(this.paths.runtimeRoot, 'index-active.json'), 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new contracts.IntegrationContractError('INDEX_UNAVAILABLE', 'Cannot read the active index.', true);
        return { contract_version: 1, repo_id, state: 'registered', index_generation: null, knowledge_snapshot: null, checkout_drift: null, context_delivery_verified: false, scope_mode: 'local-config-allowlist', onboarding: await inspectOnboarding(this.paths,repo_id) };
      }
      let database: DatabaseSync | undefined;
      try {
        const active = z.object({ database: z.string().min(1), generation: z.string().min(1) }).parse(JSON.parse(manifest));
        const filename = path.resolve(this.paths.runtimeRoot, active.database);
        if (!filename.startsWith(path.resolve(this.paths.runtimeRoot) + path.sep)) throw new Error('Invalid path');
        database = new DatabaseSync(filename, { readOnly: true });
        const row = database.prepare('SELECT generation FROM index_manifest WHERE singleton = 1').get();
        if (!row || row.generation !== active.generation) throw new Error('Invalid generation');
        generation = active.generation;
        metadata = provenance(database, this.paths.knowledgeRoot);
      } catch (error) { if (error instanceof DomainError) throw error; throw new contracts.IntegrationContractError('INDEX_UNAVAILABLE', 'Cannot read the active index.', true); }
      finally { database?.close(); }
      return { contract_version: 1, repo_id, state: 'index-available', index_generation: generation, knowledge_snapshot: metadata!.knowledge_snapshot, checkout_drift: metadata!.checkout_drift, context_delivery_verified: false, scope_mode: 'local-config-allowlist', onboarding: await inspectOnboarding(this.paths,repo_id) };
    });
  }

  async retrieve(request: unknown) {
    const input = contracts.parseRequest(contracts.retrievalRequest, request);
    const repo_id = this.canonical(input.repo_id);
    const ready = await this.readiness({ contract_version: 1, repo_id });
    if (ready.state !== 'index-available') throw new contracts.IntegrationContractError('INDEX_UNAVAILABLE', 'Build an index before retrieving context.', true);
    return this.checked(contracts.retrievalOutput, async () => ({ contract_version: 1, repo_id, context: await this.knowledge.taskContext({ repo_id, task: input.task,
      ...(input.topics !== undefined ? { topics: input.topics } : {}),
      ...(input.changed_paths !== undefined ? { changed_paths: input.changed_paths } : {}),
      ...(input.source_revision !== undefined ? { source_revision: input.source_revision } : {}),
      ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
      ...(input.max_results !== undefined ? { max_results: input.max_results } : {}),
      ...(input.depth !== undefined ? { depth: input.depth } : {})
    }) }));
  }

  async prepareDelivery(request: unknown) {
    const input = contracts.parseRequest(contracts.deliveryRequest, request);
    const { task_id, ...retrieval } = input;
    const result = await this.retrieve(retrieval);
    return contracts.deliveryOutput.parse({ ...result, task_id, state: 'prepared', consumed: false });
  }

  async capture(request: unknown) {
    const input = contracts.parseRequest(contracts.captureRequest, request);
    const repo_id = this.canonical(input.repo_id);
    if (input.outcome === 'no-learning') return contracts.captureOutput.parse({ contract_version: 1, repo_id, state: 'no-learning', durable: false });
    try { await parseKnowledgeMarkdown(input.markdown, this.paths.knowledgeRoot); }
    catch { throw new contracts.IntegrationContractError('VALIDATION_ERROR', 'Learning Markdown is invalid.'); }
    return this.checked(contracts.captureOutput, async () => {
      const receipt = await submitCandidate(this.paths, { repoId: repo_id, idempotencyKey: input.idempotency_key, markdown: input.markdown, submitter: this.paths.config.principal });
      return { contract_version: 1, repo_id, state: receipt.state, candidate_id: receipt.candidate_id, receipt_id: receipt.receipt_id, content_hash: receipt.content_hash, duplicate: receipt.duplicate };
    });
  }
}
