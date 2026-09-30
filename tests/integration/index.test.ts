import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openIndex } from '../../src/indexing/database.js';
import { buildFixtureIndex } from '../../src/indexing/build-index.js';

let temporaryDirectory = '';
afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); });

describe('fixture index', () => {
  it('creates FTS and manifest tables for an empty knowledge tree', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ek-index-'));
    const database = await openIndex(path.join(temporaryDirectory, 'runtime'));
    try {
      const count = await buildFixtureIndex(database, temporaryDirectory);
      expect(count).toBe(0);
      expect(database.prepare('SELECT record_count FROM index_manifest').get()).toEqual({ record_count: 0 });
    } finally { database.close(); }
  });
});
