#!/usr/bin/env node
/**
 * sentinel-ai MCP E2E Flow Verification Script
 *
 * Tests the full MCP tool chain:
 *   initialize → list_apps → get_selectors → save_tests → run_tests → get_report
 *
 * Usage: node scripts/verify-mcp-flow.mjs
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'packages', 'mcp-server', 'dist', 'index.js');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m';

let pass = 0;
let fail = 0;

async function main() {
  console.log('\n=========================================');
  console.log(' sentinel-ai MCP E2E Flow Verification');
  console.log('=========================================\n');

  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = createInterface({ input: child.stdout });
  const responses = [];
  let resolveNext;

  rl.on('line', (line) => {
    try {
      const parsed = JSON.parse(line);
      responses.push(parsed);
      if (resolveNext) {
        const fn = resolveNext;
        resolveNext = null;
        fn(parsed);
      }
    } catch { /* ignore non-JSON */ }
  });

  function send(obj) {
    child.stdin.write(JSON.stringify(obj) + '\n');
  }

  function waitForResponse() {
    return new Promise((resolve) => {
      resolveNext = resolve;
    });
  }

  function check(name, response, test) {
    const result = test(response);
    if (result) {
      console.log(`${CYAN}[${name}]${NC} ${GREEN}PASS${NC}`);
      pass++;
    } else {
      console.log(`${CYAN}[${name}]${NC} ${RED}FAIL${NC}`);
      console.log(`  Response: ${JSON.stringify(response).slice(0, 200)}`);
      fail++;
    }
  }

  // --- Step 1: Initialize ---
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-script', version: '1.0.0' },
    },
  });

  let resp = await waitForResponse();
  check('1. initialize', resp, (r) =>
    r.result?.serverInfo?.name === 'sentinel-ai',
  );

  // Send initialized notification
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // --- Step 2: list_apps ---
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'list_apps', arguments: {} },
  });

  resp = await waitForResponse();
  check('2. list_apps', resp, (r) => {
    const text = r.result?.content?.[0]?.text ?? '';
    return text.includes('fridgify') && text.includes('arden-web');
  });

  // --- Step 3: get_selectors ---
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_selectors', arguments: { app_id: 'arden-web' } },
  });

  resp = await waitForResponse();
  check('3. get_selectors (arden-web)', resp, (r) => {
    const text = r.result?.content?.[0]?.text ?? '';
    return text.includes('data-testid');
  });

  // --- Step 4: save_tests ---
  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'save_tests',
      arguments: {
        app_id: 'arden-web',
        test_cases: [
          {
            id: 'TC-001',
            title: 'Load home page',
            confidence: 0.95,
            status: 'approved',
            platform: ['web'],
            code: [
              "import { test, expect } from '@playwright/test';",
              '',
              "test('home page loads', async ({ page }) => {",
              "  await page.goto('https://example.com');",
              "  await expect(page.locator('h1')).toContainText('Example Domain');",
              '});',
            ].join('\n'),
          },
        ],
      },
    },
  });

  resp = await waitForResponse();
  check('4. save_tests', resp, (r) => {
    const text = r.result?.content?.[0]?.text ?? '';
    return text.includes('1 test') && text.includes('saved');
  });

  // --- Step 5: run_tests (web) ---
  console.log(`${CYAN}[5. run_tests (web)]${NC} Running Playwright test...`);
  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'run_tests',
      arguments: { app_id: 'arden-web', platform: 'web' },
    },
  });

  resp = await waitForResponse();
  check('5. run_tests (web)', resp, (r) => {
    const text = r.result?.content?.[0]?.text ?? '';
    try {
      const result = JSON.parse(text);
      return result.passed === 1 && result.failed === 0;
    } catch {
      return false;
    }
  });

  // --- Step 6: get_report ---
  send({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'get_report', arguments: { app_id: 'arden-web' } },
  });

  resp = await waitForResponse();
  check('6. get_report (stub)', resp, (r) => {
    const text = r.result?.content?.[0]?.text ?? '';
    return text.includes('arden-web');
  });

  // --- Cleanup ---
  child.stdin.end();
  child.kill();

  console.log('\n=========================================');
  console.log(` Results: ${GREEN}${pass} passed${NC}, ${RED}${fail} failed${NC}`);
  console.log('=========================================\n');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
