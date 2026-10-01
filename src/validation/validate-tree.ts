import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ValidationIssue } from '../core/types.js';
import { parseKnowledgeMarkdown } from './record.js';

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : [];
  }));
  return nested.flat();
}

export async function validateKnowledgeTree(root: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const files = await markdownFiles(path.join(root, 'knowledge'));
  const seenIds = new Map<string, string>();
  for (const file of files) {
    try {
      const record = await parseKnowledgeMarkdown(await readFile(file, 'utf8'), root);
      const earlier = seenIds.get(record.id);
      if (earlier) issues.push({ file, message: `Duplicate id ${record.id}; already in ${earlier}` });
      else seenIds.set(record.id, file);
    } catch (error) {
      issues.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return issues;
}
