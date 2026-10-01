import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRootOptions, registerRepository, resolvePaths, saveLocalConfig } from '../../src/core/config.js';

let temporaryDirectory = '';
afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); });

describe('local configuration', () => {
  it('strips explicit global root/config options without changing command arguments', () => {
    expect(parseRootOptions(['--root', 'C:/knowledge', 'register-repo', '--id', 'fixture'])).toEqual({ root: 'C:/knowledge', args: ['register-repo', '--id', 'fixture'] });
    expect(parseRootOptions(['--config', 'local.json', 'status'])).toEqual({ config: 'local.json', args: ['status'] });
  });

  it('registers an unrelated Git checkout without implicit aliases and preserves configured aliases', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-config-'));
    const sourceRoot = path.join(temporaryDirectory, 'source');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(sourceRoot));
    execFileSync('git', ['init', sourceRoot], { stdio: 'ignore' });
    const knowledgeRoot = path.join(temporaryDirectory, 'memory');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(knowledgeRoot));
    const paths = await resolvePaths({ root: knowledgeRoot });
    const input = { id: 'sample-app', repoPath: sourceRoot, owner: 'owner', team: 'platform' };
    const registered = await registerRepository(paths, input);
    expect(registered.path).toBe(sourceRoot);
    expect(registered.name).toBe('sample-app');
    expect(registered.aliases).toEqual([]);
    paths.config.repositories[0]!.aliases.push('legacy-app');
    await saveLocalConfig(paths, paths.config);
    const reloaded = await resolvePaths({ root: knowledgeRoot });
    expect((await registerRepository(reloaded, input)).aliases).toEqual(['legacy-app']);
    const persisted = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(paths.configPath, 'utf8'))) as { repositories: Array<{ path: string }> };
    expect(persisted.repositories[0]?.path).toBe(sourceRoot);
  });
});
