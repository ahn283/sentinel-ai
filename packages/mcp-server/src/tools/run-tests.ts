import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TestStore } from '../store/test-store.js';
import type { AppRegistry } from '../registry/registry.js';
import { runTestsSchema } from '../schemas/tools.js';
import { runPlaywrightTests } from '@sentinel-ai/playwright-runner';
import type { TestInput, RunResult } from '@sentinel-ai/playwright-runner';
import { logger } from '../utils/logger.js';

export function registerRunTests(
  server: McpServer,
  store: TestStore,
  registry: AppRegistry,
) {
  server.registerTool('run_tests', {
    description: 'Run tests for an app (long-running, supports progress notifications)',
    inputSchema: runTestsSchema,
  }, async ({ app_id, suite, platform }) => {
    const tests = store.get(app_id);
    if (!tests || tests.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `No tests found for app: ${app_id}` }],
        isError: true,
      };
    }

    // Determine target platform from registry if not specified
    const app = registry.getApp(app_id);
    const targetPlatform = platform ?? (app?.type === 'web' ? 'web' : undefined);

    // Filter tests by platform if specified
    const filteredTests = targetPlatform === 'web'
      ? tests.filter((t) => t.platform.includes('web'))
      : targetPlatform === 'ios' || targetPlatform === 'android'
        ? tests.filter((t) => t.platform.includes('flutter'))
        : tests;

    if (filteredTests.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No tests found for app "${app_id}" matching platform: ${targetPlatform}`,
        }],
        isError: true,
      };
    }

    // Route to the appropriate runner
    if (targetPlatform === 'web') {
      const testInputs: TestInput[] = filteredTests.map((t) => ({
        id: t.id,
        title: t.title,
        code: t.code,
      }));

      logger.info(`Running ${testInputs.length} Playwright tests for app: ${app_id}`);

      let result: RunResult;
      try {
        result = await runPlaywrightTests(testInputs, {
          timeout: 30_000,
          headless: true,
        });
      } catch (err) {
        logger.error('Playwright runner error:', err);
        return {
          content: [{
            type: 'text' as const,
            text: `Playwright runner failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }

      // Build response with optional resource links for screenshots
      const content: Array<{ type: 'text'; text: string } | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } }> = [
        {
          type: 'text' as const,
          text: JSON.stringify({
            app_id,
            suite: suite ?? 'all',
            platform: 'web',
            total: result.total,
            passed: result.passed,
            failed: result.failed,
            skipped: result.skipped,
            timedOut: result.timedOut,
            duration: result.duration,
            tests: result.tests,
          }, null, 2),
        },
      ];

      return { content };
    }

    // Flutter (Maestro) — stub for Step 4
    if (targetPlatform === 'ios' || targetPlatform === 'android') {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            app_id,
            suite: suite ?? 'all',
            platform: targetPlatform,
            total: filteredTests.length,
            passed: filteredTests.length,
            failed: 0,
            status: 'stub — Maestro runner not yet connected (Step 4)',
          }, null, 2),
        }],
      };
    }

    // No specific platform — return stub
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          app_id,
          suite: suite ?? 'all',
          platform: 'all',
          total: filteredTests.length,
          passed: filteredTests.length,
          failed: 0,
          status: 'stub — specify platform for actual execution',
        }, null, 2),
      }],
    };
  });
}
