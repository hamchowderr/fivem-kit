/**
 * Official framework documentation, fetched at runtime.
 *
 * fivem-kit ships a hand-written corpus that is deep on ox and deliberately shallow
 * elsewhere. That is backwards for the real world — most live servers run ESX or QBCore — so
 * where a framework publishes a machine-readable corpus, we serve the official one.
 *
 * ## Why every fetch asserts on CONTENT, never on status
 *
 * ESX's documentation site is a Nextra single-page app. It answers **HTTP 200 for any path**,
 * including `/llms-full.txt`, and returns its HTML homepage. Measured 2026-08-10:
 *
 *   ox       200   376 KB   text     `lib.callback` x18        real
 *   qbcore   200   413 KB   text     `Functions.`  x277        real
 *   esx      200   100 KB   HTML     `xPlayer`     x1          SOFT-404
 *   qbox     404                                               none published
 *   fivem    404                                               none published
 *
 * Note the ESX row carefully: it is 200, it is substantial, and it even contains the marker
 * word once. A fetcher checking the status code would cache it. So would one that merely
 * grepped for `xPlayer`. Validation therefore requires all of: not HTML, a plausible size,
 * and the marker appearing enough times to indicate real reference material.
 *
 * A source that fails validation is never cached and never served. Silently serving a
 * website's navigation as if it were API documentation is precisely the failure this whole
 * project exists to prevent.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // docs move faster than the natives database

/**
 * @typedef {Object} RemoteSource
 * @property {string} url
 * @property {string} label
 * @property {RegExp} marker    a term that must appear in genuine reference material
 * @property {number} minHits   how many times, so a single incidental mention cannot pass
 * @property {number} minBytes  smaller than this is not a full corpus
 * @property {string} [note]    why a source is unavailable, shown to the caller
 */

/** @type {Record<string, RemoteSource>} */
export const REMOTE_SOURCES = {
  ox: {
    url: 'https://overextended.dev/llms-full.txt',
    label: 'ox (Overextended) — official',
    marker: /lib\.callback|ox_inventory|ox_target/g,
    minHits: 10,
    minBytes: 100_000,
  },
  qbcore: {
    url: 'https://docs.qbcore.org/llms-full.txt',
    label: 'QBCore — official',
    marker: /QBCore|Functions\.|PlayerData/g,
    minHits: 50,
    minBytes: 100_000,
  },
  esx: {
    url: 'https://documentation.esx-framework.org/llms-full.txt',
    label: 'ESX Legacy — official',
    marker: /xPlayer|es_extended/g,
    minHits: 25,
    minBytes: 100_000,
    note:
      'ESX publishes no usable llms-full.txt: the docs site is a single-page app that answers ' +
      '200 for every path and returns its HTML homepage. fivem-kit falls back to its own ' +
      'hand-written ESX reference, which was verified against the es_extended source.',
  },
  qbox: {
    url: 'https://docs.qbox.re/llms-full.txt',
    label: 'Qbox — official',
    marker: /qbx_core|qbx/g,
    minHits: 25,
    minBytes: 100_000,
    note: 'Qbox publishes no llms-full.txt (404). fivem-kit falls back to its own Qbox reference.',
  },
};

function cacheDir() {
  if (process.env.FIVEM_CACHE_DIR) return process.env.FIVEM_CACHE_DIR;
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'fivem-mcp');
}

const cachePath = (name) => path.join(cacheDir(), `corpus-${name}.txt`);

function fresh(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Does this body look like genuine reference documentation for `source`?
 *
 * @returns {{ok: boolean, reason?: string, hits?: number, bytes?: number}}
 */
export function validateCorpus(text, source) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'empty response' };
  }
  // A single-page app returns its shell for any path. This is the check that catches ESX.
  if (/^\s*(?:<!doctype|<html|<\?xml)/i.test(text)) {
    return { ok: false, reason: 'served HTML, not text — the docs site answered with its homepage' };
  }
  if (text.length < source.minBytes) {
    return {
      ok: false,
      reason: `only ${Math.round(text.length / 1024)}KB, expected at least ${Math.round(source.minBytes / 1024)}KB`,
      bytes: text.length,
    };
  }
  const hits = (text.match(new RegExp(source.marker.source, source.marker.flags)) || []).length;
  if (hits < source.minHits) {
    return {
      ok: false,
      reason: `marker appeared ${hits} time(s), expected at least ${source.minHits} — not reference material`,
      hits,
      bytes: text.length,
    };
  }
  return { ok: true, hits, bytes: text.length };
}

/**
 * Fetch an official corpus, validate it, and cache only what passes.
 *
 * @returns {Promise<{ok: boolean, name: string, text?: string, reason?: string, cached?: boolean}>}
 *   Never throws — an unavailable upstream must degrade to the bundled corpus, not break
 *   the tool call.
 */
export async function loadRemoteCorpus(name, { refresh = false, fetchImpl = fetch } = {}) {
  const source = REMOTE_SOURCES[name];
  if (!source) return { ok: false, name, reason: `unknown source "${name}"` };

  const file = cachePath(name);
  if (!refresh && fresh(file)) {
    try {
      return { ok: true, name, text: fs.readFileSync(file, 'utf8'), cached: true };
    } catch {
      /* corrupt cache — refetch */
    }
  }

  let text;
  try {
    const res = await fetchImpl(source.url, { headers: { 'user-agent': 'fivem-kit' } });
    if (!res.ok) {
      return { ok: false, name, reason: `HTTP ${res.status}${source.note ? ` — ${source.note}` : ''}` };
    }
    text = await res.text();
  } catch (e) {
    return { ok: false, name, reason: `fetch failed: ${e.message}` };
  }

  const check = validateCorpus(text, source);
  if (!check.ok) {
    // Deliberately not cached. A poisoned cache would outlive the outage that caused it.
    return { ok: false, name, reason: `${check.reason}${source.note ? ` — ${source.note}` : ''}` };
  }

  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, text);
  } catch {
    /* cache is an optimisation */
  }
  return { ok: true, name, text, cached: false };
}

/**
 * Search a remote corpus, returning the headed section each hit belongs to.
 *
 * These files are markdown with `#`-style headings, so a hit is far more useful reported as
 * "under this heading" than as a bare line.
 */
export function searchRemote(text, query, { limit = 8, context = 400 } = {}) {
  if (!text || !query) return [];
  const needle = String(query).toLowerCase();
  const lines = text.split('\n');

  const results = [];
  let heading = '(top of document)';
  for (let i = 0; i < lines.length && results.length < limit; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      heading = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (!line.toLowerCase().includes(needle)) continue;

    const start = Math.max(0, i - 2);
    const excerpt = lines.slice(start, i + 8).join('\n').slice(0, context);
    results.push({ heading, line: i + 1, excerpt });
  }
  return results;
}

/** What can actually be served right now, and why anything cannot. */
export function describeSources() {
  return Object.entries(REMOTE_SOURCES).map(([name, s]) => ({
    name,
    label: s.label,
    url: s.url,
    available: !s.note,
    note: s.note ?? null,
  }));
}
