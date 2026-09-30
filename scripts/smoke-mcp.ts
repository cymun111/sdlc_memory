import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'engineering-knowledge-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js', 'serve', '--transport', 'stdio'], stderr: 'pipe' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expected = ['get_task_context', 'search_knowledge', 'get_knowledge', 'get_related', 'submit_learning', 'report_conflict'];
  assert.deepEqual(new Set(tools.tools.map(({ name }) => name)), new Set(expected));
  console.log(`MCP stdio discovery passed (${tools.tools.length} tools). Tool behavior remains scaffold-only.`);
} finally {
  await client.close();
}
