/**
 * Tests for the optional HTTP transport.
 *
 * These are mostly SECURITY tests, because that is what changes when a server stops being a
 * child process on a pipe and starts listening on a socket. `fivemDetectStack` reads a path
 * the caller names — over stdio that is the privilege the editor already had, over a socket
 * it is a stranger reading `server.cfg`, which is where a FiveM server keeps its database
 * credentials and license key.
 *
 * Every rule here fails closed, and each test below is written to fail if it stops doing so.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { checkConfig, isLoopback, withinRoot, DEFAULT_HOST, DEFAULT_PORT } from '../src/http.mjs';
import { parseArgs } from '../src/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'src', 'index.mjs');

describe('startup refuses unsafe configurations', () => {
  test('binding off-loopback without a token is refused, not warned about', () => {
    const r = checkConfig({ host: '0.0.0.0', token: '', root: null });
    assert.equal(r.ok, false);
    // The message has to carry the fix. An operator who hits this at 2am should not have to
    // go and find the documentation.
    assert.match(r.error, /FIVEM_MCP_TOKEN/);
    assert.match(r.error, /Authorization: Bearer/);
  });

  test('loopback needs no token — sharing is the thing that requires a decision', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      assert.ok(isLoopback(host), `${host} should count as loopback`);
      assert.equal(checkConfig({ host, token: '', root: null }).ok, true);
    }
  });

  test('a LAN address with a token starts, but says what is still unconfined', () => {
    const r = checkConfig({ host: '192.168.1.10', token: 'x'.repeat(64), root: null });
    assert.equal(r.ok, true);
    assert.ok(
      r.warnings.some((w) => w.includes('FIVEM_SERVER_ROOT')),
      'an unconfined off-loopback instance must say so'
    );
  });

  test('a short token is flagged', () => {
    const r = checkConfig({ host: '192.168.1.10', token: 'hunter2', root: '/srv' });
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes('characters')));
  });

  test('the process actually exits rather than listening anyway', () => {
    // checkConfig returning false is worth nothing if main() ignores it.
    const r = spawnSync(process.execPath, [ENTRY, '--http', '--host', '0.0.0.0'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, FIVEM_MCP_TOKEN: '' },
    });
    assert.equal(r.status, 2, 'must exit non-zero without binding');
    assert.match(`${r.stdout}${r.stderr}`, /Refusing to listen/);
  });
});

describe('path confinement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-root-'));

  test('the root itself and anything under it is allowed', () => {
    assert.ok(withinRoot(root, root));
    assert.ok(withinRoot(path.join(root, 'server', 'resources'), root));
  });

  test('a sibling with the root as a name prefix is NOT inside it', () => {
    // The classic off-by-one: startsWith('/srv/fivem') also matches '/srv/fivem-evil'.
    assert.ok(!withinRoot(`${root}-evil`, root));
  });

  test('a traversal that climbs out is rejected after resolution', () => {
    assert.ok(!withinRoot(path.join(root, '..', '..', 'etc'), root));
  });

  test('no configured root means unconfined, which is the stdio default', () => {
    assert.ok(withinRoot('/anywhere/at/all', null));
  });
});

describe('argument parsing', () => {
  test('stdio is the default — HTTP is never reached by accident', () => {
    assert.equal(parseArgs([]).http, false);
    assert.equal(parseArgs(['--port', '9000']).http, false, '--port alone must not start HTTP');
  });

  test('--http defaults to loopback', () => {
    const o = parseArgs(['--http']);
    assert.equal(o.http, true);
    assert.equal(o.host, DEFAULT_HOST);
    assert.equal(o.port, DEFAULT_PORT);
  });

  test('there is no --token flag', () => {
    // A command line is readable by every other process on the machine via `ps`. The token
    // comes from the environment, and a flag that looks like it works would be worse than
    // no flag at all.
    // Checks for a token flag being PARSED, not merely mentioned — the comment in index.mjs
    // that explains why there is no --token flag contains the string "--token".
    const src = fs.readFileSync(ENTRY, 'utf8');
    assert.ok(!/flag\(\s*['"]token['"]/.test(src), 'no --token flag may be parsed');
    assert.ok(!/argv\.indexOf\(\s*['"]--token['"]/.test(src));

    // And it must genuinely be ignored if someone passes it anyway.
    assert.equal(parseArgs(['--http', '--token', 'sekrit']).token, undefined);
  });

  test('a nonsense port exits instead of defaulting to something surprising', () => {
    const r = spawnSync(process.execPath, [ENTRY, '--http', '--port', 'banana'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /--port must be 1-65535/);
  });
});
