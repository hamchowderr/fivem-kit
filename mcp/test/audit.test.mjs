/**
 * Regression tests for the static analyser.
 *
 * The value of this engine is its false-positive rate: a report padded with noise buries
 * the real CRITICAL finding and gets the tool uninstalled. Every clean fixture here is a
 * pattern that DID false-positive during development, distilled from real ox / qb-core
 * sources. They must stay at zero.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditLua, detectSide } from '../src/audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');

const read = (kind, name) => fs.readFileSync(path.join(FIX, kind, name), 'utf8');
const rulesIn = (r) => [...new Set(r.findings.map((f) => f.rule))].sort();

describe('clean fixtures produce no findings', () => {
  const files = fs.readdirSync(path.join(FIX, 'clean'));

  assert.ok(files.length > 0, 'expected clean fixtures to exist');

  for (const file of files) {
    test(`${file} -> 0 findings`, () => {
      const result = auditLua(read('clean', file), file);
      assert.deepEqual(
        result.findings,
        [],
        `expected no findings, got:\n${result.findings
          .map((f) => `  ${f.rule} line ${f.line}: ${f.code}`)
          .join('\n')}`
      );
    });
  }
});

describe('known false-positive patterns stay suppressed', () => {
  test('lib.load() is not treated as load()', () => {
    const r = auditLua(`lib.load('@ox_core.lib.init')\nlocal x = self:load(1)\nmyLoad(2)`, 's.lua');
    assert.equal(r.findings.filter((f) => f.rule === 'SEC-10').length, 0);
  });

  test('real loadstring IS still caught', () => {
    const r = auditLua(`local fn = loadstring(userInput)`, 's.lua');
    assert.equal(r.findings.filter((f) => f.rule === 'SEC-10').length, 1);
  });

  test('nested tables do not truncate the addCommand config', () => {
    const src = `lib.addCommand('x', { params = { { name = 'a' } }, restricted = 'group.admin' }, function() end)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-7').length, 0);
  });

  test('an inner end does not terminate the while-true scan', () => {
    const src = `CreateThread(function()\n while true do\n  if a then b() end\n  Wait(100)\n end\nend)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'PERF-1').length, 0);
  });

  test('while true with genuinely no Wait IS caught', () => {
    const src = `CreateThread(function()\n while true do\n  if a then b() end\n end\nend)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'PERF-1').length, 1);
  });

  test('benign broadcast is not flagged, sensitive one is', () => {
    const benign = auditLua(`TriggerClientEvent('ox_inventory:closeInventory', -1, true)`, 's.lua');
    assert.equal(benign.findings.filter((f) => f.rule === 'SEC-12').length, 0);

    const bad = auditLua(`TriggerClientEvent('sync', -1, GetPlayerIdentifiers(src))`, 's.lua');
    assert.equal(bad.findings.filter((f) => f.rule === 'SEC-12').length, 1);
  });

  test('an ungated command that does nothing privileged is not flagged', () => {
    // qbx_core's /job prints the caller's own job — no gate needed
    const src = `lib.addCommand('job', { help = 'show job' }, function(source)\n local j = GetPlayer(source).PlayerData.job\n Notify(source, j.label)\nend)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-7').length, 0);
  });

  test('an ungated command that grants value IS flagged', () => {
    const src = `lib.addCommand('give', { help = 'give' }, function(source, args)\n exports.ox_inventory:AddItem(args.target, args.item, 1)\nend)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-7').length, 1);
  });

  test('ESX-named privileged actions count as privileged', () => {
    // `AddMoney` does not match `addAccountMoney`, and `AddItem` does not match
    // `addInventoryItem`. Those are the ESX Legacy spellings and appear in the hundreds
    // across real addon collections, so an ungated command using them was invisible.
    const cases = [
      `xPlayer.addAccountMoney('bank', tonumber(args[2]))`,
      `xPlayer.removeAccountMoney('bank', 100)`,
      `xPlayer.addInventoryItem(args[2], tonumber(args[3]))`,
      `xPlayer.removeInventoryItem('bread', 1)`,
      `xPlayer.addWeapon('WEAPON_PISTOL', 250)`,
    ];
    for (const action of cases) {
      const src = `RegisterCommand('x', function(source, args)\n ${action}\nend, false)`;
      assert.equal(
        auditLua(src, 'server/main.lua').findings.filter((f) => f.rule === 'SEC-7').length,
        1,
        `should flag: ${action}`
      );
    }
  });

  test('a read-only ESX call is still not privileged', () => {
    // getAccount/canCarryItem read state; flagging them would put every /balance command
    // in the report and bury the commands that actually grant value.
    for (const action of [`local a = xPlayer.getAccount('bank')`, `if xPlayer.canCarryItem(i, 1) then end`]) {
      const src = `RegisterCommand('x', function(source, args)\n ${action}\nend, false)`;
      assert.equal(
        auditLua(src, 'server/main.lua').findings.filter((f) => f.rule === 'SEC-7').length,
        0,
        `should not flag: ${action}`
      );
    }
  });

  test('framework command wrappers with their own gate are not flagged', () => {
    // ESX.RegisterCommand takes the permission group as argument 2
    const src = `ESX.RegisterCommand('setjob', 'admin', function(xPlayer, args)\n xPlayer.setJob(args.job, args.grade)\nend)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-7').length, 0);
  });

  test('module-loader load() with a chunkname is not flagged', () => {
    const src = `local fn = load(chunk, ('@@ox_lib/imports/%s.lua'):format(m))\nlocal g = load(file, '@@res/f.lua', 't', env)`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-10').length, 0);
  });

  test('SQL interpolating a column while binding values is not flagged', () => {
    const src = `MySQL.single.await('SELECT expire FROM bans WHERE ' ..column.. ' = ?', { value })`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-5').length, 0);
  });

  test('SQL with no placeholder at all IS flagged', () => {
    const src = `MySQL.single.await('SELECT * FROM bans WHERE license = "' .. license .. '"')`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-5').length, 1);
  });

  test('while true with break is not a tick-loop defect', () => {
    const src = `local function siftDown(items, i, n)\n while true do\n  local left = i * 2\n  if left > n then return end\n  i = left\n end\nend`;
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'PERF-1').length, 0);
  });

  test('source captured before a yield is not flagged', () => {
    const ok = `RegisterNetEvent('e', function()\n local src = source\n local r = MySQL.scalar.await('SELECT 1', {})\n use(src)\nend)`;
    assert.equal(auditLua(ok, 's.lua').findings.filter((f) => f.rule === 'SEC-3').length, 0);
  });
});

describe('vulnerable fixtures are detected', () => {
  test('shop_server.lua reports every planted rule', () => {
    const r = auditLua(read('vulnerable', 'shop_server.lua'), 'shop_server.lua');
    const expected = ['COMPAT-2', 'PERF-1', 'SEC-10', 'SEC-12', 'SEC-3', 'SEC-5', 'SEC-7', 'SEC-8'];
    assert.deepEqual(rulesIn(r), expected);
    // two separate unguarded commands
    assert.equal(r.findings.filter((f) => f.rule === 'SEC-7').length, 2);
  });

  test('restricted = false is reported', () => {
    const r = auditLua(read('vulnerable', 'restricted_false_server.lua'), 'restricted_false_server.lua');
    assert.equal(r.findings.filter((f) => f.rule === 'SEC-7').length, 1);
  });

  test('comments and strings are ignored, real code is not', () => {
    const r = auditLua(read('vulnerable', 'comments_server.lua'), 'comments_server.lua');
    assert.equal(r.findings.filter((f) => f.rule === 'SEC-10').length, 0, 'commented loadstring must not fire');
    assert.equal(r.findings.filter((f) => f.rule === 'COMPAT-2').length, 0, 'MySQL.Async inside a string must not fire');
    const sql = r.findings.filter((f) => f.rule === 'SEC-5');
    assert.equal(sql.length, 1, 'the real concatenated query must be found');
    assert.equal(sql[0].line, 15);
  });
});

describe('findings are ordered and shaped for reporting', () => {
  test('sorted by severity, most severe first', () => {
    const r = auditLua(read('vulnerable', 'shop_server.lua'), 'shop_server.lua');
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const seq = r.findings.map((f) => rank[f.severity]);
    assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
  });

  test('every finding carries rule, severity, line, code and fix', () => {
    const r = auditLua(read('vulnerable', 'shop_server.lua'), 'shop_server.lua');
    for (const f of r.findings) {
      for (const k of ['rule', 'severity', 'title', 'line', 'code', 'message', 'fix']) {
        assert.ok(f[k] !== undefined && f[k] !== '', `finding ${f.rule} missing ${k}`);
      }
    }
  });

  test('semantic rules come back as review prompts, not guesses', () => {
    const r = auditLua(read('vulnerable', 'shop_server.lua'), 'shop_server.lua');
    const ids = r.reviewRequired.flatMap((p) => p.rules);
    for (const id of ['SEC-1', 'SEC-2', 'SEC-4', 'SEC-6']) {
      assert.ok(ids.includes(id), `expected a review prompt covering ${id}`);
    }
    // they must never appear as concrete findings
    assert.equal(r.findings.filter((f) => ['SEC-1', 'SEC-2', 'SEC-4'].includes(f.rule)).length, 0);
  });
});

describe('side detection', () => {
  for (const [file, side] of [
    ['server/main.lua', 'server'],
    ['client/main.lua', 'client'],
    ['modules/inventory/server.lua', 'server'],
  ]) {
    test(`${file} -> ${side}`, () => assert.equal(detectSide('', file), side));
  }

  test('falls back to marker natives when the name is ambiguous', () => {
    assert.equal(detectSide('TriggerClientEvent("x", 1) MySQL.query.await("", {})', 'main.lua'), 'server');
    assert.equal(detectSide('local p = PlayerPedId() SendNUIMessage({})', 'main.lua'), 'client');
  });
});

describe('SQL identifier interpolation', () => {
  test('backtick-wrapped table name in DDL is not flagged', () => {
    const src = "MySQL.query.await(('SHOW COLUMNS FROM `%s`'):format(vehicleTable))";
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-5').length, 0);
  });

  test('a value interpolated into a WHERE clause is still flagged', () => {
    const src = "MySQL.query.await(('SELECT * FROM bans WHERE license = \"%s\"'):format(license))";
    assert.equal(auditLua(src, 's.lua').findings.filter((f) => f.rule === 'SEC-5').length, 1);
  });
});
