import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeRecord, ValidationIssue } from '../core/types.js';
import { parseKnowledgeMarkdown } from './record.js';
import { validateRecordGraph } from './graph.js';

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Knowledge source links are unsupported.');
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
  }));
  return nested.flat();
}

export async function validateKnowledgeTree(root: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  let files: string[];
  try { files = await markdownFiles(path.join(root, 'knowledge')); }
  catch { return [{ file: 'knowledge', message: 'Required knowledge sources are unavailable.' }]; }
  const records: KnowledgeRecord[] = [];
  const seenIds = new Map<string, string>();
  for (const file of files) {
    try {
      const record = await parseKnowledgeMarkdown(await readFile(file, 'utf8'), root);
      records.push(record);
      const earlier = seenIds.get(record.id);
      if (earlier) issues.push({ file, message: `Duplicate id ${record.id}; already in ${earlier}` });
      else seenIds.set(record.id, file);
    } catch (error) {
      issues.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!issues.length) {
    try { validateRecordGraph(records); }
    catch { issues.push({ file: 'knowledge', message: 'Knowledge records or relationships are invalid.' }); }
  }
  return issues;
}
