import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { KnowledgeRecord } from '../core/types.js';

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const schemaCache = new Map<string, Promise<ReturnType<Ajv2020['compile']>>>();

function findSchemaRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (process.getBuiltinModule('node:fs').existsSync(path.join(current, 'schemas', 'knowledge.schema.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Cannot locate knowledge record schema from module path');
}

async function validatorFor(root = path.resolve(process.env.KNOWLEDGE_ROOT ?? findSchemaRoot())) {
  const schemaPath = path.join(root, 'schemas/knowledge.schema.json');
  const cached = schemaCache.get(schemaPath);
  if (cached) return cached;
  const pending = readFile(schemaPath, 'utf8').then((source) => {
    const compiler = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    return compiler.compile(JSON.parse(source) as object);
  });
  schemaCache.set(schemaPath, pending);
  try { return await pending; }
  catch (error) { schemaCache.delete(schemaPath); throw error; }
}

export async function parseKnowledgeMarkdown(markdown: string, knowledgeRoot?: string): Promise<KnowledgeRecord> {
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
  const validateRecord = await validatorFor(knowledgeRoot);
  if (!validateRecord(frontMatter)) {
    throw new Error(ajv.errorsText(validateRecord.errors, { separator: '; ' }));
  }
  return frontMatter as KnowledgeRecord;
}
