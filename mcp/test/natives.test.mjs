/**
 * Tests for the natives database.
 *
 * The database is fetched from runtime.fivem.net and cached on disk. These tests skip
 * themselves when it cannot be loaded (offline CI, cold cache with no network) rather
 * than failing — a network outage is not a code defect.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadNatives,
  getNative,
  getNativeVariants,
  searchNatives,
  formatNative,
  luaName,
  summarise,
} from '../src/natives.mjs';

// Loaded at module scope, before describe() runs, so `skip` can be a real boolean.
// node:test treats a FUNCTION passed as `skip` as truthy and silently skips the block.
let index = null;
try {
  index = await loadNatives();
} catch {
  index = null;
}
const available = Boolean(index && index.list.length);
if (!available) {
  console.log('# natives database unavailable (offline?) — database tests skipped');
}

describe('name conversion (no network needed)', () => {
  test('SCREAMING_SNAKE to Lua PascalCase', () => {
    assert.equal(luaName('SET_ENTITY_COORDS'), 'SetEntityCoords');
    assert.equal(luaName('GET_PLAYER_PED'), 'GetPlayerPed');
    assert.equal(luaName('APP_CLOSE_BLOCK'), 'AppCloseBlock');
  });

  test('summarise skips code fences and blockquotes', () => {
    assert.equal(summarise('```\ncode\n```\nReal description here.'), 'Real description here.');
    assert.equal(summarise('> note\n\nActual text.'), 'Actual text.');
    assert.equal(summarise(''), '');
  });

  test('summarise truncates with an ellipsis', () => {
    const long = 'x'.repeat(300);
    const out = summarise(long, 50);
    assert.equal(out.length, 50);
    assert.ok(out.endsWith('…'));
  });
});

describe('database lookups', { skip: available ? false : 'natives database unavailable' }, () => {
  test('indexes both GTA and CFX sources', () => {
    assert.ok(index.list.length > 6000, `expected >6000 natives, got ${index.list.length}`);
    assert.ok(index.list.some((n) => n.source === 'gta'), 'no GTA natives loaded');
    assert.ok(index.list.some((n) => n.source === 'cfx'), 'no CFX natives loaded');
  });

  test('resolves a native by Lua name, snake name and hash', async () => {
    const byLua = await getNative('SetEntityCoords');
    const bySnake = await getNative('SET_ENTITY_COORDS');
    assert.ok(byLua && bySnake);
    assert.equal(byLua.name, 'SET_ENTITY_COORDS');

    const byHash = await getNative(byLua.hash);
    assert.ok(byHash, 'hash lookup failed');
    assert.equal(byHash.name, 'SET_ENTITY_COORDS');
  });

  test('prefers the client native when a server RPC equivalent shares the name', async () => {
    const variants = await getNativeVariants('SetEntityCoords');
    assert.ok(variants.length >= 2, 'expected client and server variants');
    const chosen = await getNative('SetEntityCoords');
    assert.equal(chosen.source, 'gta', 'default should be the client/GTA native');

    const server = await getNative('SetEntityCoords', { apiset: 'server' });
    assert.equal(server.apiset, 'server');
  });

  test('unnamed natives remain resolvable by hash', async () => {
    const unnamed = index.list.find((n) => n.unnamed);
    assert.ok(unnamed, 'expected some undocumented, unnamed natives');
    const found = await getNative(unnamed.hash);
    assert.ok(found, 'hash lookup must work for unnamed natives');
  });

  test('search finds natives by task description', async () => {
    const r = await searchNatives('give weapon to ped', { limit: 5 });
    assert.ok(r.some((n) => n.name === 'GIVE_WEAPON_TO_PED'), `got ${r.map((n) => n.name)}`);
  });

  test('search deduplicates client/server variants and records both sides', async () => {
    const r = await searchNatives('freeze entity position', { limit: 5 });
    const names = r.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, 'variants must be collapsed');
    const freeze = r.find((n) => n.name === 'FREEZE_ENTITY_POSITION');
    if (freeze) assert.ok(freeze.sides.length >= 1);
  });

  test('side filter excludes client natives, which carry no apiset', async () => {
    const r = await searchNatives('player', { limit: 20, apiset: 'server' });
    assert.ok(r.length > 0, 'expected server-side matches');
    for (const n of r) {
      assert.equal(n.apiset, 'server', `${n.name} is not server-side`);
    }
  });

  test('formatNative renders a usable signature', async () => {
    const n = await getNative('GiveWeaponToPed');
    const out = formatNative(n);
    assert.match(out, /GiveWeaponToPed\(/);
    assert.match(out, /native\s+GIVE_WEAPON_TO_PED/);
    assert.match(out, /hash\s+0x/);
  });
});
