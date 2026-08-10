/**
 * Tests for the official-documentation fetchers.
 *
 * The whole design rests on one lesson: ESX's docs site answers HTTP 200 for every path and
 * returns its HTML homepage, which is 100KB and even contains the word `xPlayer`. Checking
 * the status code caches a website's navigation as if it were API reference. So does grepping
 * for the marker without counting it.
 *
 * These tests use an injected fetch, so they run offline and deterministically. One
 * network-dependent test is included and skipped automatically when offline.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  REMOTE_SOURCES,
  validateCorpus,
  loadRemoteCorpus,
  searchRemote,
  describeSources,
} from '../src/corpus-remote.mjs';

/** A fetch that returns exactly what a test wants. */
const fakeFetch = (body, { ok = true, status = 200 } = {}) => async () => ({
  ok,
  status,
  text: async () => body,
});

/** A body that passes validation for a given source. */
function goodBody(source, size = 150_000) {
  const marker = source === REMOTE_SOURCES.ox ? 'lib.callback' : 'QBCore';
  const unit = `## Heading\n${marker} does a thing.\n`;
  return unit.repeat(Math.ceil(size / unit.length));
}

describe('validation rejects a soft-404', () => {
  test('HTML is rejected even at 200 with a plausible size', () => {
    // The real shape of the ESX response: 200, ~100KB, HTML, marker present once.
    const html = `<!DOCTYPE html><html><head><title>ESX</title></head><body>${'x'.repeat(120_000)} xPlayer</body></html>`;
    const r = validateCorpus(html, REMOTE_SOURCES.esx);
    assert.equal(r.ok, false);
    assert.match(r.reason, /HTML/);
  });

  test('a single incidental marker mention is not enough', () => {
    const body = `# Notes\n${'filler '.repeat(30_000)}\nxPlayer appears once.\n`;
    const r = validateCorpus(body, REMOTE_SOURCES.esx);
    assert.equal(r.ok, false);
    assert.match(r.reason, /marker appeared/);
  });

  test('a short body is rejected even when the marker is dense', () => {
    const r = validateCorpus('lib.callback '.repeat(100), REMOTE_SOURCES.ox);
    assert.equal(r.ok, false);
    assert.match(r.reason, /expected at least/);
  });

  test('an empty response is rejected', () => {
    assert.equal(validateCorpus('', REMOTE_SOURCES.ox).ok, false);
    assert.equal(validateCorpus('   ', REMOTE_SOURCES.ox).ok, false);
  });

  test('genuine reference material passes', () => {
    const r = validateCorpus(goodBody(REMOTE_SOURCES.ox), REMOTE_SOURCES.ox);
    assert.equal(r.ok, true);
    assert.ok(r.hits >= REMOTE_SOURCES.ox.minHits);
  });
});

describe('a failing source never poisons the cache', () => {
  test('an HTML body is not cached and not served', async () => {
    const html = `<!doctype html><html>${'x'.repeat(200_000)} xPlayer xPlayer xPlayer</html>`;
    const r = await loadRemoteCorpus('esx', { refresh: true, fetchImpl: fakeFetch(html) });
    assert.equal(r.ok, false);
    assert.equal(r.text, undefined, 'nothing may be served from a failed validation');
    assert.match(r.reason, /HTML/);
  });

  test('a 404 degrades with an explanation rather than throwing', async () => {
    const r = await loadRemoteCorpus('qbox', {
      refresh: true,
      fetchImpl: fakeFetch('', { ok: false, status: 404 }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /404/);
    assert.match(r.reason, /falls back/, 'the caller must be told what happens instead');
  });

  test('a network error degrades rather than throwing', async () => {
    const r = await loadRemoteCorpus('ox', {
      refresh: true,
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /fetch failed/);
  });

  test('an unknown source is an error, not a crash', async () => {
    const r = await loadRemoteCorpus('nonsense', { refresh: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown source/);
  });

  test('a valid body is served', async () => {
    const body = goodBody(REMOTE_SOURCES.ox);
    const r = await loadRemoteCorpus('ox', { refresh: true, fetchImpl: fakeFetch(body) });
    assert.equal(r.ok, true);
    assert.ok(r.text.length > 100_000);
  });
});

describe('searching a corpus', () => {
  const doc = [
    '# ox_lib',
    '',
    '## lib.callback — request/response',
    'Register with lib.callback.register on the server.',
    'The response is routed back automatically.',
    '',
    '## lib.notify',
    'Show a notification with lib.notify({ description = "hi" }).',
  ].join('\n');

  test('reports the heading a hit belongs to', () => {
    const hits = searchRemote(doc, 'lib.callback.register');
    assert.equal(hits.length, 1);
    assert.match(hits[0].heading, /lib\.callback/);
    assert.match(hits[0].excerpt, /register on the server/);
  });

  test('matching is case-insensitive', () => {
    assert.equal(searchRemote(doc, 'LIB.NOTIFY').length, 1);
  });

  test('respects the limit and handles no match', () => {
    assert.deepEqual(searchRemote(doc, 'nothing-here'), []);
    assert.deepEqual(searchRemote('', 'x'), []);
    assert.ok(searchRemote(doc, 'lib', { limit: 1 }).length <= 1);
  });
});

describe('source inventory', () => {
  test('reports which sources are usable and why the others are not', () => {
    const sources = describeSources();
    const byName = Object.fromEntries(sources.map((s) => [s.name, s]));
    assert.equal(byName.ox.available, true);
    assert.equal(byName.qbcore.available, true);
    assert.equal(byName.esx.available, false);
    assert.match(byName.esx.note, /single-page app/);
    assert.equal(byName.qbox.available, false);
  });
});

// One live check, so a silent upstream change surfaces. Skipped when offline.
const online = await fetch('https://overextended.dev/llms-full.txt', { method: 'HEAD' })
  .then((r) => r.ok)
  .catch(() => false);

describe('live sources still behave as documented', { skip: !online }, () => {
  test('ox serves real reference material', async () => {
    const r = await loadRemoteCorpus('ox', { refresh: true });
    assert.equal(r.ok, true, r.reason);
    assert.match(r.text, /lib\.callback/);
  });

  test('ESX is still a soft-404 and is still refused', async () => {
    // If this ever starts passing, ESX has published a real corpus — delete the note and
    // mark the source available.
    const r = await loadRemoteCorpus('esx', { refresh: true });
    assert.equal(r.ok, false, 'ESX unexpectedly served a valid corpus — update REMOTE_SOURCES');
  });
});
