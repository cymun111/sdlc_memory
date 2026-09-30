import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { KnowledgeRecord } from '../core/types.js';

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const knowledgeRoot = path.resolve(process.env.KNOWLEDGE_ROOT ?? process.cwd());
const schema = JSON.parse(await readFile(path.join(knowledgeRoot, 'schemas/knowledge.schema.json'), 'utf8')) as object;
const validateRecord = ajv.compile(schema);

export function parseKnowledgeMarkdown(markdown: string): KnowledgeRecord {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) throw new Error('Missing YAML front matter');
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) throw new Error('Unterminated YAML front matter');
  const source = normalized.slice(4, end);
  if (/(^|\s)!!?[\w<]/m.test(source)) throw new Error('YAML tags are not permitted');
  const frontMatter = parse(source, { uniqueKeys: true, schema: 'core' }) as unknown;
  if (frontMatter === null || typeof frontMatter !== 'object' || Array.isArray(frontMatter)) {
    throw new Error('Front matter must be a plain object');
  }
  if (!validateRecord(frontMatter)) {
    throw new Error(ajv.errorsText(validateRecord.errors, { separator: '; ' }));
  }
  return frontMatter as KnowledgeRecord;
}
