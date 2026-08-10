/**
 * Contract tests for the MCP server itself.
 *
 * These spawn `src/index.mjs` and speak real JSON-RPC over stdio, because the things that
 * break here do not break in a unit test: a `structuredContent` payload that drifts from its
 * declared `outputSchema` is rejected by the SDK at call time, and an annotation that never
 * reaches the wire looks fine in source.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'src', 'index.mjs');

/** Latest protocol the bundled SDK speaks. Asking for it proves we are not pinned to an old one. */
const PROTOCOL = '2025-11-25';

/**
 * Run a whole MCP session in one process and return the responses by id.
 * One spawn per session keeps these tests quick — the server starts in well under a second.
 */
function session(calls) {
  const lines = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, ...c })),
  ];

  const r = spawnSync(process.execPath, [SERVER], {
    input: lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 60_000,
  });

  const byId = new Map();
  for (const line of (r.stdout ?? '').trim().split('\n')) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined) byId.set(msg.id, msg);
  }
  return { byId, stderr: r.stderr ?? '', status: r.status };
}

const call = (name, args = {}) => ({ method: 'tools/call', params: { name, arguments: args } });

let tools;
let init;

before(() => {
  const { byId } = session([{ method: 'tools/list' }]);
  init = byId.get(1).result;
  tools = byId.get(2).result.tools;
});

describe('protocol negotiation', () => {
  test('negotiates the current spec version, not an old one', () => {
    assert.equal(init.protocolVersion, PROTOCOL);
  });

  test('identifies itself by package name', () => {
    assert.equal(init.serverInfo.name, 'fivem-mcp');
  });
});

describe('tool declarations', () => {
  test('all five tools are present', () => {
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['fivemAudit', 'fivemDetectStack', 'fivemDocs', 'fivemNatives', 'fivemSearch']
    );
  });

  test('every tool declares itself read-only so clients can auto-approve', () => {
    for (const t of tools) {
      assert.ok(t.annotations, `${t.name} has no annotations`);
      assert.equal(t.annotations.readOnlyHint, true, `${t.name} must be read-only`);
      assert.equal(t.annotations.destructiveHint, false);
    }
  });

  test('only the tools that reach outside the bundle are open-world', () => {
    const open = tools.filter((t) => t.annotations.openWorldHint).map((t) => t.name).sort();
    assert.deepEqual(open, ['fivemDetectStack', 'fivemNatives'], 'natives fetches; detect reads the disk');
  });

  test('the two structured tools declare an outputSchema', () => {
    const withSchema = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
    assert.deepEqual(withSchema, ['fivemAudit', 'fivemDetectStack']);
  });
});

describe('fivemAudit structured output', () => {
  test('a vulnerable snippet returns typed findings alongside the text', () => {
    const { byId } = session([
      call('fivemAudit', { source: `MySQL.query('SELECT * FROM u WHERE n = "' .. n .. '"')` }),
    ]);
    const res = byId.get(2).result;
    assert.ok(res.content?.[0]?.text, 'the text block is required even with structured output');

    const sc = res.structuredContent;
    assert.equal(sc.ok, true);
    assert.equal(sc.counts.CRITICAL, 1);
    assert.equal(sc.findings[0].rule, 'SEC-5');
    assert.equal(sc.findings[0].severity, 'CRITICAL');
    assert.ok(sc.rulesChecked.includes('SEC-5'));
  });

  test('a clean snippet still returns a valid payload', () => {
    const { byId } = session([call('fivemAudit', { source: 'local function add(a,b) return a+b end' })]);
    const sc = byId.get(2).result.structuredContent;
    assert.equal(sc.ok, true);
    assert.deepEqual(sc.findings, []);
    assert.deepEqual(sc.counts, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
  });

  test('the failure paths satisfy the schema too', () => {
    // Declaring an outputSchema makes structuredContent mandatory on EVERY return, so the
    // error paths are exactly where this breaks if they were left returning bare text.
    const { byId } = session([
      call('fivemAudit', { filePath: '/definitely/not/here.lua' }),
      call('fivemAudit', {}),
    ]);
    for (const id of [2, 3]) {
      const res = byId.get(id).result;
      assert.ok(res, `id ${id} produced no result — the SDK rejected the payload`);
      assert.equal(res.structuredContent.ok, false);
      assert.ok(res.structuredContent.error.length > 0);
      assert.deepEqual(res.structuredContent.findings, []);
    }
  });
});

describe('fivemDetectStack structured output', () => {
  test('a missing server returns found: false rather than an error result', () => {
    const { byId } = session([call('fivemDetectStack', { serverPath: '/definitely/not/a/server' })]);
    const sc = byId.get(2).result.structuredContent;
    assert.equal(sc.found, false);
    assert.equal(sc.dialect, null);
    assert.equal(sc.stack, null);
    assert.ok(sc.guidance.length > 0, 'guidance must still tell the caller what to do');
  });

  test('resources are omitted unless asked for', () => {
    const server = path.join(HERE, 'fixtures');
    const { byId } = session([
      call('fivemDetectStack', { serverPath: server }),
      call('fivemDetectStack', { serverPath: server, includeResources: true }),
    ]);
    // Whether the fixture dir detects as a server or not, the shape rule holds either way.
    assert.ok(!('resources' in byId.get(2).result.structuredContent));
    assert.ok(byId.get(3).result.structuredContent !== undefined);
  });
});
