import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitLocalCandidate } from './capture/submit.js';
import { parseKnowledgeMarkdown } from './validation/record.js';
import { validateKnowledgeTree } from './validation/validate-tree.js';
import { openIndex } from './indexing/database.js';
import { buildFixtureIndex } from './indexing/build-index.js';
import { searchFixtureIndex } from './retrieval/search.js';
import { serveStdio } from './mcp/server.js';

const root = process.env.KNOWLEDGE_ROOT ? path.resolve(process.env.KNOWLEDGE_ROOT) : process.cwd();
const [command = 'help', ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (command) {
    case 'help':
    case '--help':
      console.log('knowledge <init|validate|index|query|submit|serve|status|hooks>');
      break;
    case 'init':
      await mkdir(path.join(root, '.runtime'), { recursive: true });
      console.log(`Initialized runtime directory under ${root}`);
      break;
    case 'validate': {
      const issues = await validateKnowledgeTree(root);
      if (issues.length) {
        for (const issue of issues) console.error(`${issue.file}: ${issue.message}`);
        process.exitCode = 1;
      } else console.log('Knowledge records validated.');
      break;
    }
    case 'index': {
      const database = await openIndex(path.resolve(process.env.KNOWLEDGE_RUNTIME_ROOT ?? '.runtime'));
      try {
        const count = await buildFixtureIndex(database, root);
        console.log(`Built local fixture index with ${count} records.`);
      } finally {
        database.close();
      }
      break;
    }
    case 'query': {
      const query = args.join(' ').trim();
      if (!query) throw new Error('Usage: knowledge query <search terms>');
      const database = await openIndex(path.resolve(process.env.KNOWLEDGE_RUNTIME_ROOT ?? '.runtime'));
      try { console.log(JSON.stringify(searchFixtureIndex(database, query), null, 2)); }
      finally { database.close(); }
      break;
    }
    case 'submit': {
      const fileIndex = args.indexOf('--file');
      if (fileIndex < 0 || !args[fileIndex + 1]) throw new Error('Usage: knowledge submit --file <path> --repo <id>');
      const repoIndex = args.indexOf('--repo');
      if (repoIndex < 0 || !args[repoIndex + 1]) throw new Error('Submission requires --repo <id>');
      const source = await import('node:fs/promises').then(({ readFile }) => readFile(path.resolve(args[fileIndex + 1]!), 'utf8'));
      const record = parseKnowledgeMarkdown(source);
      console.log(JSON.stringify(await submitLocalCandidate(root, args[repoIndex + 1]!, record), null, 2));
      break;
    }
    case 'serve':
      if (args.includes('--transport') && args[args.indexOf('--transport') + 1] !== 'stdio') {
        throw new Error('HTTP transport is not implemented in this starter.');
      }
      await serveStdio();
      break;
    case 'status':
      console.log(JSON.stringify({ mode: 'starter', knowledgeRoot: root, index: 'local fixture index only', sharedHttp: 'not implemented' }, null, 2));
      break;
    case 'hooks':
      console.log('Hook schemas and event allowlist are scaffolded; installation, durable receipts, and replay are not implemented.');
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
