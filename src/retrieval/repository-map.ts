import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ResolvedPaths, RegisteredRepo } from '../core/config.js';
import { DomainError } from '../capture/candidate-store.js';

const sections = ['files', 'packages', 'entry_points', 'commands', 'tests', 'languages'] as const;
const evidence = z.object({ path: z.string(), blob_hash: z.string().regex(/^[a-f0-9]{40,64}$/) });
const item = z.object({ section: z.enum(sections), path: z.string(), label: z.string(), evidence });
export const repositoryMapSchema = z.object({
  schema_version: z.literal(1), extractor_version: z.literal('git-npm-1'), repo_id: z.string(), checkout_identity: z.string(),
  source_revision: z.string().regex(/^[a-f0-9]{40,64}$/), generated_at: z.string(),
  truncated: z.boolean(), warnings: z.array(z.string()), items: z.array(item).max(30000)
});
export const mapReadInput = z.object({ repo_id: z.string().min(1), section: z.enum(['summary', ...sections]).default('summary'), path_prefix: z.string().max(300).default(''), limit: z.number().int().min(1).max(50).default(10), cursor: z.string().max(1024).optional() }).strict();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const extensions: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.cpp': 'C++', '.c': 'C', '.swift': 'Swift', '.kt': 'Kotlin', '.sh': 'Shell' };
const textExtensions = new Set([...Object.keys(extensions), '.json', '.md', '.yaml', '.yml', '.toml', '.html', '.css', '.sql', '.txt']);
function allowed(file: string): boolean {
  return !file.startsWith('/') && !file.includes('\\') && !file.split('/').some((part) => part === '..' || /^(node_modules|vendor|dist|build|coverage|\.git|\.runtime|\.next|target|__pycache__)$/i.test(part) || /(^\.env|credential|secret|token|password|\.pem$|\.key$|^id_rsa|^\.npmrc$)/i.test(part)) && (textExtensions.has(path.posix.extname(file)) || /(^|\/)(Dockerfile|Makefile)$/.test(file)) && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file);
}
function git(repo: RegisteredRepo, args: string[]): string {
  try { return execFileSync('git', ['-C', repo.path, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new DomainError('SOURCE_UNAVAILABLE', 'Cannot read registered Git source within extraction limits'); }
}
function repository(paths: ResolvedPaths, id: string) {
  const repo = paths.config.repositories.find((r) => r.id === id || r.aliases.includes(id));
  if (!repo) throw new DomainError('NOT_FOUND', 'Repository is not registered');
  return repo;
}
function location(paths: ResolvedPaths, repo: RegisteredRepo) { return path.join(paths.runtimeRoot, 'repository-maps', hash(repo.id) + '.json'); }
export async function buildRepositoryMap(paths: ResolvedPaths, repoId: string, revision = 'HEAD') {
  const repo = repository(paths, repoId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/~^+-]{0,199}$/.test(revision)) throw new DomainError('VALIDATION_ERROR', 'Invalid Git revision');
  const commit = git(repo, ['rev-parse', '--verify', '--end-of-options', revision + '^{commit}']).trim();
  let textFiles = '';
  try { textFiles = execFileSync('git', ['-C', repo.path, 'grep', '-I', '-l', '-z', '-e', '', commit, '--'], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw new DomainError('SOURCE_UNAVAILABLE', 'Cannot classify source files within extraction limits'); }
  const textual = new Set(textFiles.split('\0').map((f) => f.slice(commit.length + 1)));
  const tree = git(repo, ['ls-tree', '-r', '-l', '-z', commit]).split('\0').filter(Boolean).map((line) => {
    const match = /^(\d+) blob ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/.exec(line);
    return match ? { mode: match[1]!, blob: match[2]!, size: Number(match[3]), file: match[4]! } : null;
  }).filter((row): row is NonNullable<typeof row> => row !== null && row.mode.startsWith('100') && row.size <= 1024 * 1024 && allowed(row.file) && (row.size === 0 || textual.has(row.file))).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const selected = tree.slice(0, 5000);
  const items: z.infer<typeof item>[] = [];
  const warnings: string[] = [];
  const add = (section: typeof sections[number], file: string, label: string, source: typeof selected[number]) => items.push({ section, path: file, label: label.slice(0, 300), evidence: { path: source.file, blob_hash: source.blob } });
  let manifests = 0;
  let extractionLimited = tree.length > selected.length;
  for (const row of selected) {
    add('files', row.file, path.posix.dirname(row.file), row);
    const language = extensions[path.posix.extname(row.file)];
    if (language) add('languages', row.file, language, row);
    if (/(^|\/)(__tests__|tests?|specs?)(\/|$)|[.-](test|spec)\./i.test(row.file)) add('tests', row.file, path.posix.dirname(row.file), row);
    if (path.posix.basename(row.file) !== 'package.json') continue;
    if (++manifests > 100 || row.size > 65536) { extractionLimited = true; warnings.push('Package extraction limit reached'); continue; }
    try {
      const manifest = JSON.parse(git(repo, ['cat-file', 'blob', row.blob])) as Record<string, unknown>;
      if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error();
      const directory = path.posix.dirname(row.file);
      add('packages', row.file, 'npm package boundary', row);
      if (manifest.workspaces) warnings.push('Workspace declarations present; package boundaries are discovered from tracked package.json files, not expanded workspace globs');
      if (manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)) {
        if (Object.keys(manifest.scripts).length > 100) extractionLimited = true;
        for (const name of Object.keys(manifest.scripts).sort().slice(0, 100)) {
          if (/^(build|test|lint|dev|start|typecheck|format)(:[a-zA-Z0-9_-]+)*$/.test(name)) add('commands', directory, 'npm run ' + name, row);
        }
      }
      const entries: unknown[] = [manifest.main, manifest.module, manifest.types, ...(typeof manifest.bin === 'object' && manifest.bin ? Object.values(manifest.bin) : [manifest.bin])];
      const collectExports = (v: unknown, depth = 0): void => { if (depth > 8) return; if (typeof v === 'string') entries.push(v); else if (v && typeof v === 'object') for (const child of Object.values(v).slice(0, 100)) collectExports(child, depth + 1); };
      collectExports(manifest.exports);
      if (entries.length > 100) extractionLimited = true;
      for (const entry of [...new Set(entries)].slice(0, 100)) {
        if (typeof entry !== 'string' || entry.includes('\\') || entry.startsWith('/') || entry.split('/').includes('..')) continue;
        const target = path.posix.join(directory, entry);
        if (!allowed(target)) continue;
        if (selected.some((f) => f.file === target)) add('entry_points', target, 'manifest-declared tracked entry', row);
      }
    } catch { warnings.push('Malformed or unreadable package manifest: ' + row.file); }
  }
  if (!manifests) warnings.push('No eligible npm manifest: package and entry-point extraction unavailable; generic Git map only');
  const map = repositoryMapSchema.parse({ schema_version: 1, extractor_version: 'git-npm-1', repo_id: repo.id, checkout_identity: hash(repo.path), source_revision: commit, generated_at: new Date().toISOString(), truncated: extractionLimited, warnings: [...new Set(warnings)].slice(0, 20), items });
  const destination = location(paths, repo);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(map), { flag: 'wx', mode: 0o600 });
  await rename(temporary, destination);
  return { repo_id: repo.id, source_revision: commit, mapped_files: selected.length, truncated: map.truncated, warnings: map.warnings };
}
export async function getRepositoryMap(paths: ResolvedPaths, request: unknown) {
  const input = mapReadInput.parse(request);
  const repo = repository(paths, input.repo_id);
  let map: z.infer<typeof repositoryMapSchema>;
  try { map = repositoryMapSchema.parse(JSON.parse(await readFile(location(paths, repo), 'utf8'))); }
  catch (error) { throw new DomainError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'VALIDATION_ERROR', 'Map missing or invalid; run knowledge repos map build --repo <id>'); }
  if (map.repo_id !== repo.id || map.checkout_identity !== hash(repo.path)) throw new DomainError('CONFLICT', 'Registered checkout changed; rebuild the map');
  let head: string | null = null;
  let sourceAvailable = false;
  let dirty = false;
  try {
    head = git(repo, ['rev-parse', 'HEAD']).trim();
    git(repo, ['cat-file', '-e', map.source_revision + '^{commit}']);
    dirty = [...git(repo, ['diff', '--name-only', '-z', 'HEAD', '--']).split('\0'), ...git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].some((f) => f && allowed(f));
    sourceAvailable = true;
  } catch { /* Return explicit unavailable source state, without source path errors. */ }
  const all = map.items.filter((i) => i.path.startsWith(input.path_prefix) && (input.section === 'summary' || i.section === input.section));
  const counts = Object.fromEntries(sections.map((section) => [section, all.filter((i) => i.section === section).length]));
  const summary = { directories: [...new Set(all.filter((i) => i.section === 'files').map((i) => i.path.includes('/') ? i.path.split('/')[0]! : '.'))].sort().slice(0, 20), languages: [...new Set(all.filter((i) => i.section === 'languages').map((i) => i.label))].sort(), language_method: 'tracked-file-extension', symbols: 'not_extracted' };
  const selected = input.section === 'summary' ? [] : all;
  const snapshot = hash(JSON.stringify([map, paths.config.principal, input.section, input.path_prefix, input.limit]));
  let offset = 0;
  if (input.cursor) {
    try { const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()); if (decoded.snapshot !== snapshot || !Number.isInteger(decoded.offset) || decoded.offset < 1 || decoded.offset >= selected.length) throw new Error(); offset = decoded.offset; }
    catch { throw new DomainError('VALIDATION_ERROR', 'Invalid or stale map cursor; restart without cursor'); }
  }
  const page = selected.slice(offset, offset + input.limit);
  const result = () => ({ repo_id: repo.id, source_revision: map.source_revision, extractor_version: map.extractor_version, generated_at: map.generated_at, freshness: { source_available: sourceAvailable, head_changed: head !== null && head !== map.source_revision, dirty_worktree: dirty, head_revision: head }, truncated: map.truncated, warnings: map.warnings, summary, counts, items: page, next_cursor: offset + page.length < selected.length ? Buffer.from(JSON.stringify({ snapshot, offset: offset + page.length })).toString('base64url') : null });
  while (Buffer.byteLength(JSON.stringify({ ok: true, data: result() })) > paths.config.budgets.maxBytes) { if (page.length <= 1) throw new DomainError('CONTEXT_BUDGET_EXCEEDED', 'Map page exceeds byte budget; narrow the section or increase the configured budget'); page.pop(); }
  return result();
}
