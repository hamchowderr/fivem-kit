/**
 * Tests for the beads sync.
 *
 * The single thing that decides whether this feature survives contact with a user is
 * idempotency: an audit that files 40 duplicates on its second run gets switched off the same
 * day. So the tests drive a FAKE `bd` runner and assert on the exact argv it receives — no
 * real database, no port conflicts, and every branch reachable.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  syncFindings,
  beadsAvailable,
  findingKey,
  titleFor,
  descriptionFor,
} from '../../scripts/beads-sync.mjs';

const ROOT = path.resolve('/srv');

const finding = (over = {}) => ({
  rule: 'SEC-5',
  severity: 'CRITICAL',
  title: 'SQL built by string concatenation',
  file: path.join(ROOT, 'resources', 'shop', 'server', 'main.lua'),
  line: 41,
  code: `MySQL.query('SELECT ' .. x)`,
  message: 'The query string is assembled from values with no ? placeholder.',
  fix: 'Bind values as parameters.',
  ...over,
});

/**
 * A stand-in for the `bd` CLI. Records every invocation and serves a fixed issue list, so a
 * test can assert exactly what would have been run.
 */
function fakeBd({ issues = [], broken = false } = {}) {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (broken) return { status: 1, stdout: '', stderr: 'no database' };
    if (args[0] === 'list') return { status: 0, stdout: JSON.stringify(issues), stderr: '' };
    if (args[0] === 'create') return { status: 0, stdout: 'Created issue: probe-abc\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls, of: (verb) => calls.filter((c) => c[0] === verb) };
}

describe('detect, do not require', () => {
  test('reports unavailable rather than throwing when bd is missing', () => {
    const { exec } = fakeBd({ broken: true });
    assert.equal(beadsAvailable(exec), false);
  });

  test('auto mode files nothing and explains itself when there is no database', () => {
    const { exec, calls } = fakeBd({ broken: true });
    const r = syncFindings({ findings: [finding()], root: ROOT, exec });
    assert.equal(r.ran, false);
    assert.match(r.reason, /no beads database/);
    assert.equal(calls.filter((c) => c[0] === 'create').length, 0);
  });

  test('off mode never even probes for a database', () => {
    const { exec, calls } = fakeBd();
    const r = syncFindings({ findings: [finding()], root: ROOT, mode: 'off', exec });
    assert.equal(r.ran, false);
    assert.deepEqual(calls, [], 'off must cost nothing at all');
  });

  test('on mode says so when beads was expected but absent', () => {
    const { exec } = fakeBd({ broken: true });
    const r = syncFindings({ findings: [finding()], root: ROOT, mode: 'on', exec });
    assert.match(r.reason, /set to on but no database/);
  });
});

describe('idempotency — the part that decides whether this stays enabled', () => {
  test('a new finding is filed once', () => {
    const bd = fakeBd();
    const r = syncFindings({ findings: [finding()], root: ROOT, exec: bd.exec });
    assert.equal(r.filed.length, 1);
    assert.equal(bd.of('create').length, 1);
  });

  test('re-running with the finding already filed creates nothing', () => {
    const key = findingKey(finding(), ROOT);
    const bd = fakeBd({ issues: [{ id: 'x-1', title: `${key} — SQL built by string concatenation`, status: 'open' }] });
    const r = syncFindings({ findings: [finding()], root: ROOT, exec: bd.exec });
    assert.equal(r.filed.length, 0, 'must not duplicate');
    assert.equal(bd.of('create').length, 0);
    assert.equal(r.closed.length, 0, 'and must not close a finding that is still present');
  });

  test('three findings in one file get three distinct issues', () => {
    const bd = fakeBd();
    const findings = [finding(), finding({ line: 55, rule: 'SEC-7' }), finding({ line: 90, rule: 'SEC-3' })];
    const r = syncFindings({ findings, root: ROOT, exec: bd.exec });
    assert.equal(r.filed.length, 3);
    assert.equal(new Set(r.filed.map((f) => f.key)).size, 3, 'keys must be distinct');
  });

  test('the same rule at the same line in DIFFERENT files does not collide', () => {
    const bd = fakeBd();
    const a = finding();
    const b = finding({ file: path.join(ROOT, 'resources', 'bank', 'server', 'main.lua') });
    const r = syncFindings({ findings: [a, b], root: ROOT, exec: bd.exec });
    assert.equal(r.filed.length, 2);
    assert.notEqual(r.filed[0].key, r.filed[1].key);
  });

  test('a fixed finding closes its issue', () => {
    const key = findingKey(finding(), ROOT);
    const bd = fakeBd({ issues: [{ id: 'x-1', title: `${key} — old`, status: 'open' }] });
    // The file was audited (it appears in findings) but SEC-5 at line 41 is gone.
    const stillThere = finding({ rule: 'SEC-7', line: 12 });
    const r = syncFindings({ findings: [stillThere], root: ROOT, exec: bd.exec });
    assert.equal(r.closed.length, 1);
    assert.equal(r.closed[0].id, 'x-1');
    assert.ok(bd.of('close').some((c) => c[1] === 'x-1'));
  });

  test('issues for files outside this audit are left alone', () => {
    // Auditing one resource must never close another resource's issues.
    const bd = fakeBd({
      issues: [{ id: 'other-1', title: '[SEC-5] resources/bank/server/main.lua:9 — x', status: 'open' }],
    });
    const r = syncFindings({ findings: [finding()], root: ROOT, exec: bd.exec });
    assert.equal(r.closed.length, 0, 'a different file was not part of this audit');
  });

  test('a reappearing finding reopens its closed issue instead of filing a new one', () => {
    const key = findingKey(finding(), ROOT);
    const bd = fakeBd({ issues: [{ id: 'x-1', title: `${key} — old`, status: 'closed' }] });
    const r = syncFindings({ findings: [finding()], root: ROOT, exec: bd.exec });
    assert.equal(r.filed.length, 0);
    assert.equal(r.updated.length, 1);
    assert.equal(r.updated[0].action, 'reopened');
  });
});

describe('severity threshold', () => {
  test('MEDIUM and LOW are reported but not filed by default', () => {
    const bd = fakeBd();
    const findings = [finding(), finding({ severity: 'MEDIUM', rule: 'SEC-12', line: 7 }), finding({ severity: 'LOW', rule: 'X-1', line: 8 })];
    const r = syncFindings({ findings, root: ROOT, exec: bd.exec });
    assert.equal(r.filed.length, 1, 'only the CRITICAL');
    assert.equal(r.skipped, 2);
  });

  test('a lower threshold files them', () => {
    const bd = fakeBd();
    const findings = [finding(), finding({ severity: 'MEDIUM', rule: 'SEC-12', line: 7 })];
    const r = syncFindings({ findings, root: ROOT, minSeverity: 'medium', exec: bd.exec });
    assert.equal(r.filed.length, 2);
    assert.equal(r.skipped, 0);
  });
});

describe('what actually gets sent to bd', () => {
  test('nothing is ever passed as a shell string', () => {
    const bd = fakeBd();
    syncFindings({ findings: [finding()], root: ROOT, exec: bd.exec });
    for (const call of bd.calls) {
      assert.ok(Array.isArray(call), 'every invocation must be an argv array');
      for (const arg of call) assert.equal(typeof arg, 'string');
    }
  });

  test('a finding containing shell metacharacters is passed through safely', () => {
    const bd = fakeBd();
    const nasty = finding({ code: `MySQL.query('; rm -rf / #' .. $(whoami))` });
    syncFindings({ findings: [nasty], root: ROOT, exec: bd.exec });
    const create = bd.of('create')[0];
    const desc = create.find((a) => a.startsWith('--description='));
    assert.ok(desc.includes('rm -rf'), 'the text is preserved verbatim…');
    assert.ok(Array.isArray(create), '…as one argv element, never a shell string');
  });

  test('the issue carries priority matched to severity', () => {
    const bd = fakeBd();
    syncFindings({ findings: [finding({ severity: 'CRITICAL' })], root: ROOT, exec: bd.exec });
    assert.ok(bd.of('create')[0].includes('--priority=0'));
  });

  test('the external ref is set even though identity runs on the title', () => {
    const bd = fakeBd();
    syncFindings({ findings: [finding()], root: ROOT, exec: bd.exec });
    assert.ok(bd.of('create')[0].some((a) => a.startsWith('--external-ref=fivem:[SEC-5]')));
  });

  test('dry run changes nothing', () => {
    const bd = fakeBd();
    const r = syncFindings({ findings: [finding()], root: ROOT, dryRun: true, exec: bd.exec });
    assert.equal(r.filed.length, 1);
    assert.equal(bd.of('create').length, 0, 'a dry run must not create');
  });
});

describe('issue content', () => {
  test('the title carries the key and the rule title', () => {
    assert.equal(
      titleFor(finding(), ROOT),
      '[SEC-5] resources/shop/server/main.lua:41 — SQL built by string concatenation'
    );
  });

  test('keys use forward slashes so they match across machines', () => {
    assert.ok(!findingKey(finding(), ROOT).includes('\\'));
  });

  test('the description carries the defect, the line and the fix', () => {
    const d = descriptionFor(finding(), ROOT);
    assert.match(d, /CRITICAL/);
    assert.match(d, /resources\/shop\/server\/main\.lua:41/);
    assert.match(d, /## Fix/);
    assert.match(d, /Bind values as parameters/);
  });
});
