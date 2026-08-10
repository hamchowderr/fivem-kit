/**
 * Tests for the audit walker — the layer between the rules and real directories.
 *
 * The finding key is the important part: the write-time hook, the security auditor and the
 * beads sync all key on it, so a key that varies by machine would file duplicate issues.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { audit, collectLua, isFrameworkPath, findingKey } from '../../scripts/fivem-audit.mjs';

const VULNERABLE = `
RegisterNetEvent('shop:buy', function(item)
    MySQL.query('SELECT * FROM users WHERE name = "' .. item .. '"')
end)
`;

function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-audit-'));
  const write = (rel, body) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  write('resources/myshop/server/main.lua', VULNERABLE);
  write('resources/ox_inventory/server/main.lua', VULNERABLE);
  write('resources/myshop/web/build/bundle.lua', VULNERABLE);
  write('resources/myshop/readme.md', 'not lua');
  return dir;
}

describe('file collection', () => {
  test('skips build output and NUI bundles', () => {
    const files = collectLua(server()).map((f) => f.replace(/\\/g, '/'));
    assert.ok(files.some((f) => f.endsWith('myshop/server/main.lua')));
    assert.ok(!files.some((f) => f.includes('/web/')), 'web/ is a bundle dir, not source');
    assert.ok(!files.some((f) => f.endsWith('.md')));
  });

  test('accepts a single file as the target', () => {
    const dir = server();
    const one = path.join(dir, 'resources', 'myshop', 'server', 'main.lua');
    assert.deepEqual(collectLua(one), [one]);
  });

  test('recognises framework resources by path segment', () => {
    assert.equal(isFrameworkPath('/srv/resources/ox_inventory/server/main.lua'), true);
    assert.equal(isFrameworkPath('C:\\srv\\resources\\qb-core\\server\\x.lua'), true);
    assert.equal(isFrameworkPath('/srv/resources/my_ox_shop/server/main.lua'), false);
  });
});

describe('audit walking', () => {
  test('skips framework resources by default and reports how many', () => {
    const r = audit(server());
    assert.equal(r.files, 1, 'only the user resource');
    assert.ok(r.skipped.length >= 1);
    assert.ok(r.findings.every((f) => !f.file.includes('ox_inventory')));
  });

  test('--include-framework audits them anyway', () => {
    const r = audit(server(), { includeFramework: true });
    assert.ok(r.files > 1);
    assert.deepEqual(r.skipped, []);
  });

  test('the minimum severity filter drops lower findings', () => {
    const dir = server();
    assert.ok(audit(dir).findings.length > 0);
    const critical = audit(dir, { minSeverity: 'critical' });
    assert.ok(critical.findings.every((f) => f.severity === 'CRITICAL'));
  });

  test('counts are consistent with the findings list', () => {
    const r = audit(server());
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    assert.equal(total, r.findings.length);
  });
});

describe('finding keys are stable across machines', () => {
  test('the key is relative and uses forward slashes', () => {
    const r = audit(server());
    for (const f of r.findings) {
      assert.match(f.key, /^[A-Z]+-\d+:[^:]+:\d+$/);
      assert.ok(!f.key.includes('\\'), 'a Windows separator would differ from CI');
      assert.ok(!path.isAbsolute(f.key.split(':')[1]), 'an absolute path is machine-specific');
    }
  });

  test('two runs over the same tree produce identical keys', () => {
    const dir = server();
    assert.deepEqual(
      audit(dir).findings.map((f) => f.key),
      audit(dir).findings.map((f) => f.key),
      're-auditing must update issues, never duplicate them'
    );
  });

  test('the same resource under a different root yields the same key', () => {
    const a = server();
    const b = server();
    assert.deepEqual(
      audit(a).findings.map((f) => f.key),
      audit(b).findings.map((f) => f.key)
    );
  });

  test('findingKey normalises separators', () => {
    const f = { rule: 'SEC-5', file: path.join('/srv', 'server', 'main.lua'), line: 3 };
    assert.equal(findingKey(f, '/srv'), 'SEC-5:server/main.lua:3');
  });

  test('a file as its own root falls back to the basename, never an empty path', () => {
    // Auditing one file used to make root === the file, so path.relative returned '' and
    // every file collapsed to the same key — silently deduplicating unrelated findings.
    const f = { rule: 'SEC-5', file: path.join('/srv', 'a.lua'), line: 1 };
    assert.equal(findingKey(f, path.join('/srv', 'a.lua')), 'SEC-5:a.lua:1');
    const g = { rule: 'SEC-5', file: path.join('/srv', 'b.lua'), line: 1 };
    assert.notEqual(findingKey(f, f.file), findingKey(g, g.file), 'two files must never share a key');
  });

  test('auditing one file with an explicit root matches a full run', () => {
    const dir = server();
    const one = path.join(dir, 'resources', 'myshop', 'server', 'main.lua');
    const single = audit(one, { root: dir, includeFramework: true }).findings.map((f) => f.key);
    const full = audit(dir, { includeFramework: true })
      .findings.filter((f) => f.file === one)
      .map((f) => f.key);
    assert.deepEqual(single, full, 'the write-time key must equal the full-audit key');
  });
});
