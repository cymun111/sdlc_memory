import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolContracts } from './tools/contracts.js';

const server = new McpServer({ name: 'engineering-knowledge', version: '0.1.0' });

function unavailable(name: string) {
  return async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ code: 'NOT_IMPLEMENTED', tool: name, message: 'The starter exposes the MCP contract; production retrieval and durable capture are not implemented.' }) }]
  });
}

server.registerTool('get_task_context', { description: 'Retrieve a bounded context bundle for a task. Starter contract only.', inputSchema: toolContracts.get_task_context.shape }, unavailable('get_task_context'));
server.registerTool('search_knowledge', { description: 'Search published knowledge. Starter contract only.', inputSchema: toolContracts.search_knowledge.shape }, unavailable('search_knowledge'));
server.registerTool('get_knowledge', { description: 'Load an authorized knowledge record. Starter contract only.', inputSchema: toolContracts.get_knowledge.shape }, unavailable('get_knowledge'));
server.registerTool('get_related', { description: 'Traverse typed knowledge relationships. Starter contract only.', inputSchema: toolContracts.get_related.shape }, unavailable('get_related'));
server.registerTool('submit_learning', { description: 'Submit a learning candidate. Starter contract only.', inputSchema: toolContracts.submit_learning.shape }, unavailable('submit_learning'));
server.registerTool('report_conflict', { description: 'Submit a conflict report without editing published records. Starter contract only.', inputSchema: toolContracts.report_conflict.shape }, unavailable('report_conflict'));

export async function serveStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Engineering Knowledge MCP server listening on stdio');
}
