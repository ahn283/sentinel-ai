import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppRegistry } from './registry/registry.js';
import { TestStore } from './store/test-store.js';
import { logger } from './utils/logger.js';

import { registerListApps } from './tools/list-apps.js';
import { registerGetSelectors } from './tools/get-selectors.js';
import { registerSaveTests } from './tools/save-tests.js';
import { registerRunTests } from './tools/run-tests.js';
import { registerGetReport } from './tools/get-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const registryDir =
    process.env.SENTINEL_REGISTRY_DIR ?? resolve(__dirname, '..', '..', '..', 'registry');

  const registry = new AppRegistry(registryDir);
  await registry.load();

  const store = new TestStore();

  const server = new McpServer({
    name: 'sentinel-ai',
    version: '0.1.0',
  });

  registerListApps(server, registry);
  registerGetSelectors(server, registry);
  registerSaveTests(server, store);
  registerRunTests(server, store, registry);
  registerGetReport(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('sentinel-ai MCP server started (stdio)');
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
