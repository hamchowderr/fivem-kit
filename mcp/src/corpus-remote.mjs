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

/**
 * Only the FiveM sections that fill a real gap. `game-references` is deliberately excluded:
 * 1.3 MB of weapon and vehicle hash tables, which the natives database already covers better,
 * and including it would quadruple the download for material nobody greps here.
 */
const FIVEM_SECTIONS = ['server-manual', 'scripting-manual', 'scripting-reference', 'cookbook']
  .map((s) => `content/docs/${s}/`);

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
  // ESX's docs site is the soft-404 described above, and Qbox's publishes nothing at all —
  // but both RENDER from markdown in git, so the real source is the repository. Serving
  // those means every framework fivem-kit claims to support has official coverage.
  esx: {
    label: 'ESX Legacy — official',
    marker: /xPlayer|es_extended|ESX\./g,
    minHits: 25,
    minBytes: 60_000,
    build: repoCorpus({
      repo: 'esx-framework/esx-legacy-documentation',
      branch: 'tested',
      prefixes: ['src/pages/'],
      strip: 'src/pages/',
    }),
    source: 'https://github.com/esx-framework/esx-legacy-documentation',
  },
  qbox: {
    label: 'Qbox — official',
    marker: /qbx_core|qbx|ox_lib/g,
    minHits: 25,
    minBytes: 50_000,
    build: repoCorpus({
      repo: 'Qbox-project/qbox-docs',
      branch: 'main',
      prefixes: ['docs/'],
      strip: 'docs/',
    }),
    source: 'https://github.com/Qbox-project/qbox-docs',
  },
  fivem: {
    label: 'FiveM / Cfx.re — official',
    marker: /RegisterNetEvent|GetConvar|fx_version|OneSync|resource/g,
    minHits: 50,
    minBytes: 150_000,
    build: repoCorpus({
      repo: 'citizenfx/fivem-docs',
      branch: 'master',
      prefixes: FIVEM_SECTIONS,
      strip: 'content/docs/',
    }),
    source: 'https://github.com/citizenfx/fivem-docs',
  },
};

/**
 * Headers for a GitHub API request.
 *
 * `GITHUB_TOKEN` is used when the environment already has one. Unauthenticated API access is
 * 60 requests/hour **per IP**, and on shared infrastructure that budget is not ours — a CI
 * runner shares its address with every other job on the host, so "we only make one request"
 * says nothing about whether the quota is left. That assumption is what put a 403 in this
 * project's CI: three matrix jobs, four corpora, one exhausted allowance.
 *
 * Authenticated raises it to 1,000/hour for the repository. The variable is read only if it
 * is already set — nothing here asks anyone to create a token, and the file fetches
 * themselves go to raw.githubusercontent, which is not rate-limited this way.
 */
function githubHeaders() {
  const headers = { 'user-agent': 'fivem-kit' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/**
 * One retry on the two statuses that mean "not now" rather than "no".
 *
 * A rate limit is temporary by definition, and failing the whole corpus build over a shared
 * allowance that refills makes the check flaky — and a flaky check is one people learn to
 * re-run without reading.
 */
async function fetchWithRetry(fetchImpl, url, { attempts = 3 } = {}) {
  let res;
  for (let i = 0; i < attempts; i++) {
    res = await fetchImpl(url, { headers: githubHeaders() });
    if (res.ok || (res.status !== 403 && res.status !== 429)) return res;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return res;
}

/** Fetch with bounded concurrency — 188 files at once would be rude and get us throttled. */
async function fetchAll(paths, fetchImpl, base, concurrency = 8) {
  const out = new Array(paths.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
      while (next < paths.length) {
        const i = next++;
        try {
          const r = await fetchImpl(base + paths[i], { headers: { 'user-agent': 'fivem-kit' } });
          out[i] = r.ok ? await r.text() : '';
        } catch {
          out[i] = '';
        }
      }
    })
  );
  return out;
}

/**
 * Build a corpus from a documentation repository's markdown.
 *
 * Several projects render their docs from markdown in git but publish nothing
 * machine-readable from the site itself — FiveM's is a Hugo site, ESX's and Qbox's are SPAs.
 * The markdown is the real source, so we assemble from it.
 *
 * None of these repositories publish a license, so nothing is redistributed: the corpus is
 * fetched onto the user's own machine at runtime, the same reasoning that keeps the natives
 * database out of the npm package.
 *
 * Enumeration is ONE git-tree request per corpus; the files themselves come from
 * raw.githubusercontent, which is not rate-limited the same way. See githubHeaders() for why
 * one request is not, on its own, enough to stay under the limit.
 */
function repoCorpus({ repo, branch, prefixes, strip }) {
  return async function build(fetchImpl = fetch) {
    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetchWithRetry(fetchImpl, treeUrl);
    if (!res.ok) {
      throw new Error(
        res.status === 403 || res.status === 429
          ? `tree listing -> HTTP ${res.status} (GitHub API rate limit; set GITHUB_TOKEN to raise it)`
          : `tree listing -> HTTP ${res.status}`
      );
    }
    const tree = await res.json();
    if (tree.truncated) throw new Error('tree listing was truncated; refusing a partial corpus');

    const paths = (tree.tree || [])
      .filter(
        (e) =>
          e.type === 'blob' &&
          /\.mdx?$/.test(e.path) &&
          prefixes.some((p) => e.path.startsWith(p))
      )
      .map((e) => e.path)
      .sort();

    if (!paths.length) throw new Error('no markdown found in the expected sections');

    const base = `https://raw.githubusercontent.com/${repo}/${branch}/`;
    const bodies = await fetchAll(paths, fetchImpl, base);

    const parts = [];
    for (let i = 0; i < paths.length; i++) {
      if (!bodies[i]) continue;
      // A `# path` heading per file so search reports which page a hit came from.
      const title = paths[i].replace(strip ?? '', '').replace(/\.mdx?$/, '');
      parts.push(`# ${title}\n\n${bodies[i]}`);
    }
    return parts.join('\n\n---\n\n');
  };
}

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
    if (source.build) {
      // Assembled from many files rather than served as one. Same validation applies.
      text = await source.build(fetchImpl);
    } else {
      const res = await fetchImpl(source.url, { headers: { 'user-agent': 'fivem-kit' } });
      if (!res.ok) {
        return { ok: false, name, reason: `HTTP ${res.status}${source.note ? ` — ${source.note}` : ''}` };
      }
      text = await res.text();
    }
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
