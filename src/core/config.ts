import { existsSync as fileExists } from 'node:fs';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const registeredRepoSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  owner: z.string().min(1),
  team: z.string().min(1),
  path: z.string().min(1),
  aliases: z.array(z.string()).default([])
});

const localConfigSchema = z.object({
  version: z.literal(1),
  knowledgeRoot: z.string().optional(),
  principal: z.string().default('local-owner'),
  owner: z.string().default('local-owner'),
  teams: z.array(z.string()).default([]),
  repositories: z.array(registeredRepoSchema).default([]),
  budgets: z.object({ maxTokens: z.number().int().positive().max(8000).default(2000), maxResults: z.number().int().positive().max(12).default(12), maxDepth: z.number().int().min(0).max(2).default(1), maxVisited: z.number().int().positive().max(50).default(50), maxBytes: z.number().int().positive().max(32768).default(8192) }).default({ maxTokens: 2000, maxResults: 12, maxDepth: 1, maxVisited: 50, maxBytes: 8192 })
});

export type RegisteredRepo = z.infer<typeof registeredRepoSchema>;
export type LocalConfig = z.infer<typeof localConfigSchema>;
export interface ResolvedPaths { knowledgeRoot: string; runtimeRoot: string; configPath: string; config: LocalConfig }

function executableKnowledgeRoot(): string {
  const entry = fileURLToPath(import.meta.url);
  let current = path.dirname(entry);
  while (true) {
    if (existsSync(path.join(current, 'schemas', 'knowledge.schema.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot discover knowledge root from executable: ${entry}`);
}

function existsSync(file: string): boolean {
  return fileExists(file);
}

export function parseRootOptions(args: string[]): { root?: string; config?: string; args: string[] } {
  const remaining: string[] = [];
  let root: string | undefined;
  let config: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--root' || arg === '--config') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      if (arg === '--root') root = value;
      else config = value;
      index += 1;
    } else remaining.push(arg);
  }
  return { ...(root ? { root } : {}), ...(config ? { config } : {}), args: remaining };
}

export async function resolvePaths(options: { root?: string; config?: string } = {}): Promise<ResolvedPaths> {
  const selectedConfig = options.config ?? process.env.KNOWLEDGE_CONFIG;
  let fromConfig: string | undefined;
  let configData: unknown;
  if (selectedConfig) {
    const selectedPath = path.resolve(selectedConfig);
    configData = JSON.parse(await readFile(selectedPath, 'utf8')) as unknown;
    if (configData && typeof configData === 'object' && 'knowledgeRoot' in configData && typeof configData.knowledgeRoot === 'string') {
      fromConfig = configData.knowledgeRoot;
    }
  }
  const rootInput = options.root ?? process.env.KNOWLEDGE_ROOT ?? fromConfig ?? executableKnowledgeRoot();
  const knowledgeRoot = await realpath(path.resolve(rootInput));
  const runtimeRoot = path.join(knowledgeRoot, '.runtime');
  const configPath = path.join(runtimeRoot, 'config.json');
  let loaded: unknown = configData;
  if (!loaded) {
    try { loaded = JSON.parse(await readFile(configPath, 'utf8')) as unknown; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const parsed = localConfigSchema.safeParse(loaded ?? { version: 1 });
  if (!parsed.success) throw new Error(`Invalid local configuration: ${parsed.error.message}`);
  return { knowledgeRoot, runtimeRoot, configPath, config: parsed.data };
}

export async function saveLocalConfig(paths: ResolvedPaths, config: LocalConfig): Promise<void> {
  await mkdir(paths.runtimeRoot, { recursive: true });
  const runtimeRealPath = await realpath(paths.runtimeRoot);
  if (runtimeRealPath !== paths.runtimeRoot) throw new Error('Runtime root must not resolve through a symlink');
  const temporaryPath = `${paths.configPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  await rename(temporaryPath, paths.configPath);
}

export async function registerRepository(paths: ResolvedPaths, input: { id: string; repoPath: string; owner: string; team: string }): Promise<RegisteredRepo> {
  const canonicalPath = await realpath(path.resolve(input.repoPath));
  const gitRoot = execFileSync('git', ['-C', canonicalPath, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const canonicalGitRoot = await realpath(gitRoot);
  if (canonicalGitRoot !== canonicalPath) throw new Error(`Path must be the Git repository root (${canonicalGitRoot})`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.id)) throw new Error('Repository ID must use lowercase letters, digits, and hyphens');
  const existing = paths.config.repositories.find((repo) => repo.id === input.id);
  if (existing && (await realpath(existing.path)) !== canonicalGitRoot) throw new Error(`Repository ID ${input.id} is already registered to a different path`);
  const repository: RegisteredRepo = {
    id: input.id,
    name: existing?.name ?? input.id,
    owner: input.owner,
    team: input.team,
    path: canonicalGitRoot,
    aliases: existing?.aliases ?? []
  };
  const repositories = paths.config.repositories.filter((repo) => repo.id !== input.id).concat(repository);
  const teams = [...new Set([...paths.config.teams, input.team])];
  const updated = localConfigSchema.parse({ ...paths.config, owner: paths.config.repositories.length ? paths.config.owner : input.owner, principal: paths.config.repositories.length ? paths.config.principal : input.owner, repositories, teams });
  await saveLocalConfig(paths, updated);
  paths.config = updated;
  return repository;
}
