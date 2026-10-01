import { describe, expect, it } from 'vitest';
import { parseKnowledgeMarkdown } from '../../src/validation/record.js';

const validRecord = `---\nschema_version: 1\nid: fixture.valid-record\ntitle: Fixture record\nsummary: A clearly fictional validation fixture.\ntype: overview\nscope:\n  kind: repo\n  repo_id: sdlc-command\nstatus: candidate\nowner: fixture-owner\nsources: []\nrelationships: []\ncreated_at: "2026-09-30T00:00:00Z"\nupdated_at: "2026-09-30T00:00:00Z"\n---\n\nBody.\n`;

describe('parseKnowledgeMarkdown', () => {
  it('accepts valid schema-conforming front matter', async () => {
    expect((await parseKnowledgeMarkdown(validRecord)).id).toBe('fixture.valid-record');
  });

  it('rejects arbitrary object tags in YAML', async () => {
    await expect(parseKnowledgeMarkdown(validRecord.replace('summary: A clearly fictional validation fixture.', 'summary: !!js/function >\n  function () { return true }'))).rejects.toThrow('YAML tags are not permitted');
  });
});
