import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitCandidate, pendingSubmissionCount, listCandidates } from './capture/candidate-store.js';
import { approveCandidate, inspectCandidate, rejectCandidate } from './capture/review.js';
import { finishSession, startSession } from './capture/session.js';
import { parseRootOptions, registerRepository, resolvePaths, saveLocalConfig } from './core/config.js';
import { validateKnowledgeTree } from './validation/validate-tree.js';
import { buildActiveGeneration } from './indexing/build-index.js';
import { KnowledgeService } from './retrieval/service.js';
import { serveStdio } from './mcp/server.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0 && (!args[index + 1] || args[index + 1]!.startsWith('--'))) throw new Error(`${name} requires a value`);
  return index >= 0 ? args[index + 1] : undefined;
}

function requireFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function gitText(repoPath: string, ...args: string[]): string {
  return spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).stdout.trim();
}

function configuredClient(command: string): { available: boolean; version?: string } {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) return { available: false };
  return { available: true, version: (result.stdout || result.stderr).trim() };
}

async function main(): Promise<void> {
  const parsed = parseRootOptions(process.argv.slice(2));
  const paths = await resolvePaths(parsed);
  const root = paths.knowledgeRoot;
  const [command = 'help', ...args] = parsed.args;
  const knowledge = new KnowledgeService(paths);
  switch (command) {
    case 'help':
    case '--help':
      console.log('knowledge [--root <path>] [--config <path>] <init|register-repo|validate|index|query|submit|candidates|candidate|onboard|doctor|session|serve|status>');
      break;
    case 'init':
      await mkdir(paths.runtimeRoot, { recursive: true });
      if (!existsSync(paths.configPath)) await saveLocalConfig(paths, paths.config);
      console.log(JSON.stringify({ state: 'initialized', knowledge_root: root, runtime_root: paths.runtimeRoot, config: paths.configPath }, null, 2));
      break;
    case 'register-repo': {
      const repository = await registerRepository(paths, { id: requireFlag(args, '--id'), repoPath: requireFlag(args, '--path'), owner: requireFlag(args, '--owner'), team: requireFlag(args, '--team') });
      console.log(JSON.stringify({ state: 'registered-local-only', repository }, null, 2));
      break;
    }
    case 'validate': {
      const issues = await validateKnowledgeTree(root);
      if (issues.length) {
        for (const issue of issues) console.error(`${issue.file}: ${issue.message}`);
        process.exitCode = 1;
      } else console.log('Knowledge records validated.');
      break;
    }
    case 'index': {
      if (args.includes('--incremental')) throw new Error('Incremental indexing is not implemented; use --full.');
      if (!args.includes('--full')) throw new Error('Usage: knowledge index --full');
      console.log(JSON.stringify({ state: 'indexed', ...await buildActiveGeneration(root, paths.runtimeRoot) }, null, 2));
      break;
    }
    case 'query': {
      const repoId = flag(args, '--repo');
      const task = flag(args, '--task');
      const query = args.filter((item, index) => item !== '--repo' && item !== '--task' && args[index - 1] !== '--repo' && args[index - 1] !== '--task').join(' ').trim();
      if (task) console.log(JSON.stringify(await knowledge.taskContext({ repo_id: repoId ?? requireFlag(args, '--repo'), task }), null, 2));
      else if (query) console.log(JSON.stringify(await knowledge.search(query, repoId), null, 2));
      else throw new Error('Usage: knowledge query [--repo <id> --task <text>] <search terms>');
      break;
    }
    case 'submit': {
      const source = await readFile(path.resolve(requireFlag(args, '--file')), 'utf8');
      await import('./validation/record.js').then(({ parseKnowledgeMarkdown }) => parseKnowledgeMarkdown(source, root));
      console.log(JSON.stringify(await submitCandidate(paths, { repoId: requireFlag(args, '--repo'), idempotencyKey: requireFlag(args, '--idempotency-key'), markdown: source }), null, 2));
      break;
    }
    case 'candidates':
      if (args[0] !== 'list') throw new Error('Usage: knowledge candidates list [--repo <id>]');
      console.log(JSON.stringify(await listCandidates(paths, flag(args, '--repo')), null, 2));
      break;
    case 'candidate': {
      const action = args[0];
      const id = args[1];
      const expectedHash = flag(args, '--expected-hash');
      if (action === 'inspect' && id) console.log(JSON.stringify(await inspectCandidate(paths, id, flag(args, '--repo')), null, 2));
      else if (action === 'approve' && id) console.log(JSON.stringify(await approveCandidate(paths, { id, expectedHash: requireFlag(args, '--expected-hash') }), null, 2));
      else if (action === 'reject' && id) console.log(JSON.stringify(await rejectCandidate(paths, { id, reason: requireFlag(args, '--reason'), ...(expectedHash ? { expectedHash } : {}) }), null, 2));
      else throw new Error('Usage: knowledge candidate <inspect|approve|reject> <id> [options]');
      break;
    }
    case 'onboard': {
      const repoId = requireFlag(args, '--repo');
      const repoPath = path.resolve(requireFlag(args, '--path'));
      const agent = requireFlag(args, '--agent');
      if (agent !== 'codex') throw new Error('Only the Codex adapter is in scope; its native configuration is not verified in this environment.');
      const client = configuredClient(process.env.CODEX_COMMAND ?? 'codex');
      const report = { repo_id: repoId, target_path: repoPath, agent, client, dry_run: args.includes('--dry-run'), planned_changes: ['local-only source registration', 'Codex MCP configuration', 'scoped bootstrap instructions'], installed: [] as string[], verified: [] as string[], blocked: [] as string[], manual: [] as string[] };
      if (args.includes('--dry-run')) {
        if (!client.available) report.blocked.push('Codex CLI is not installed or not discoverable on PATH; no external files were changed.');
      } else {
        await registerRepository(paths, { id: repoId, repoPath, owner: flag(args, '--owner') ?? paths.config.owner, team: flag(args, '--team') ?? paths.config.teams[0] ?? 'local' });
        if (!client.available) report.blocked.push('Source checkout registered locally; Codex CLI is unavailable, so no client configuration or target instruction files were changed.');
        else report.blocked.push('Codex is present but its current native configuration format has not been verified; refusing to edit client configuration.');
        report.manual.push('Install or select a verified Codex CLI, then rerun onboarding to verify MCP configuration and context delivery.');
      }
      await mkdir(path.join(paths.runtimeRoot, 'onboarding-reports'), { recursive: true });
      const reportPath = path.join(paths.runtimeRoot, 'onboarding-reports', `${repoId}-${Date.now()}.json`);
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
      if (report.blocked.length && !args.includes('--dry-run')) process.exitCode = 2;
      break;
    }
    case 'doctor': {
      const repoId = requireFlag(args, '--repo');
      const repo = paths.config.repositories.find((item) => item.id === repoId || item.aliases.includes(repoId));
      if (!repo) throw new Error(`Repository is not registered: ${repoId}`);
      const codex = configuredClient(process.env.CODEX_COMMAND ?? 'codex');
      const candidates = await listCandidates(paths, repo.id);
      let activeIndex: unknown = null;
      try { activeIndex = JSON.parse(readFileSync(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')); } catch { /* No active generation. */ }
      console.log(JSON.stringify({ repo_id: repo.id, source_path: repo.path, git_revision: gitText(repo.path, 'rev-parse', 'HEAD'), dirty: Boolean(gitText(repo.path, 'status', '--porcelain')), node: process.version, index: activeIndex, pending_candidates: candidates.length, pending_receipts: pendingSubmissionCount(paths), integration: { agent: 'codex', available: codex.available, version: codex.version ?? null, state: 'not-installed-or-not-verified' } }, null, 2));
      break;
    }
    case 'session': {
      if (args[0] === 'start') {
        const launcher = flag(args, '--launcher');
        const result = await startSession(paths, { repoId: requireFlag(args, '--repo'), agent: requireFlag(args, '--agent'), taskFile: requireFlag(args, '--task-file'), prepareOnly: args.includes('--prepare-only'), ...(launcher ? { launcher } : {}) });
        console.log(JSON.stringify(result, null, 2));
        if (result.state === 'blocked-client-unavailable' || result.state === 'agent-exited-with-error' || result.state === 'incomplete-capture') process.exitCode = 2;
      } else if (args[0] === 'finish') {
        console.log(JSON.stringify(await finishSession(paths, requireFlag(args, '--session'), requireFlag(args, '--learning-file')), null, 2));
      } else throw new Error('Usage: knowledge session <start|finish> [options]');
      break;
    }
    case 'serve':
      if (args.includes('--transport') && args[args.indexOf('--transport') + 1] !== 'stdio') throw new Error('HTTP transport is not implemented in this local milestone.');
      await serveStdio(paths);
      break;
    case 'status': {
      let activeIndex: unknown = null;
      try { activeIndex = JSON.parse(readFileSync(path.join(paths.runtimeRoot, 'index-active.json'), 'utf8')); } catch { /* No active generation. */ }
      let revision = 'unversioned';
      try { revision = gitText(root, 'rev-parse', 'HEAD'); } catch { /* No Git checkout. */ }
      const packageData = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
      console.log(JSON.stringify({ version: packageData.version ?? 'unknown', knowledge_root: root, runtime_root: paths.runtimeRoot, active_index: activeIndex, knowledge_revision: revision, registered_repositories: paths.config.repositories.map(({ id, name, owner, team }) => ({ id, name, owner, team })), pending_candidates: (await listCandidates(paths)).length, pending_receipts: pendingSubmissionCount(paths), integration_ready: false }, null, 2));
      break;
    }
    case 'hooks':
      console.log('Native hooks are not enabled. Use the documented session launcher for task context and structured completion capture.');
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
