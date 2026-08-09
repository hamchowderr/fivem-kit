/**
 * The complete FiveM / GTA V natives database.
 *
 * ~6,400 GTA V natives plus ~940 CFX (FiveM-specific, largely server-side) natives, with
 * parameter names, types, return types and descriptions.
 *
 * Fetched at runtime and cached on disk rather than bundled:
 *
 *   1. The CitizenFX natives repositories publish NO license file, so redistributing the
 *      data inside an npm package would be legally ambiguous. Fetching what the user's
 *      own machine requests from the official endpoint is not redistribution.
 *   2. The database tracks game builds. A bundled copy goes stale; a cached fetch does not.
 *
 * Sources (official CitizenFX endpoints):
 *   https://runtime.fivem.net/doc/natives.json      — GTA V natives
 *   https://runtime.fivem.net/doc/natives_cfx.json  — CFX namespace
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCES = [
  { key: 'gta', url: 'https://runtime.fivem.net/doc/natives.json' },
  { key: 'cfx', url: 'https://runtime.fivem.net/doc/natives_cfx.json' },
];

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function cacheDir() {
  if (process.env.FIVEM_KIT_CACHE) return process.env.FIVEM_KIT_CACHE;
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'fivem-kit');
}

function cachePath(key) {
  return path.join(cacheDir(), `natives-${key}.json`);
}

function fresh(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'fivem-kit' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Load one source, from cache when fresh, otherwise fetch and cache. */
async function loadSource({ key, url }, { refresh = false } = {}) {
  const file = cachePath(key);
  if (!refresh && fresh(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* corrupt cache — refetch */
    }
  }
  const data = await fetchJson(url);
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    /* cache is an optimisation; carry on without it */
  }
  return data;
}

let INDEX = null;

/**
 * Build a flat, searchable index of every native.
 * @returns {Promise<{ list: object[], byName: Map, byHash: Map, stale: boolean }>}
 */
export async function loadNatives({ refresh = false } = {}) {
  if (INDEX && !refresh) return INDEX;

  const list = [];
  let anyFailed = false;

  for (const src of SOURCES) {
    let data;
    try {
      data = await loadSource(src, { refresh });
    } catch {
      anyFailed = true;
      continue;
    }
    for (const ns of Object.keys(data)) {
      for (const hash of Object.keys(data[ns])) {
        const n = data[ns][hash];
        if (!n) continue;
        // ~1,000 GTA natives are undocumented and carry no name. Keep them keyed by
        // hash so a hash lookup still resolves; they simply have no searchable name.
        list.push({
          name: n.name || hash,
          unnamed: !n.name,
          ns: n.ns || ns,
          hash: n.hash || hash,
          jhash: n.jhash,
          params: n.params || [],
          results: n.results || 'void',
          description: (n.description || '').trim(),
          examples: n.examples || [],
          apiset: n.apiset, // 'server' | 'client' | 'shared' on CFX natives
          source: src.key,
        });
      }
    }
  }

  // A name can map to more than one native: many client natives have a server-side RPC
  // equivalent in the CFX namespace with the same name. Keep every variant.
  const byName = new Map();
  const byHash = new Map();
  const add = (map, key, value) => {
    const k = String(key).toUpperCase();
    const existing = map.get(k);
    if (existing) existing.push(value);
    else map.set(k, [value]);
  };

  for (const n of list) {
    if (!n.unnamed) {
      add(byName, n.name, n);
      const lua = luaName(n.name);
      if (lua.toUpperCase() !== n.name.toUpperCase()) add(byName, lua, n);
    }
    byHash.set(n.hash.toLowerCase(), n);
  }

  INDEX = { list, byName, byHash, stale: anyFailed };
  return INDEX;
}

/** SET_ENTITY_COORDS -> SetEntityCoords (the form used in Lua). */
export function luaName(screamingSnake) {
  return screamingSnake
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/** SetEntityCoords -> SET_ENTITY_COORDS */
function snakeName(pascal) {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Look up a native by exact name (either casing) or by hash.
 * Returns every variant — a client native and its server-side RPC equivalent share a
 * name, and which one you want depends on the side you are writing.
 * @returns {object[]} empty when not found
 */
export async function getNativeVariants(query) {
  const { byName, byHash } = await loadNatives();
  const q = String(query).trim();
  if (/^0x[0-9a-f]+$/i.test(q)) {
    const hit = byHash.get(q.toLowerCase());
    return hit ? [hit] : [];
  }
  return byName.get(q.toUpperCase()) || byName.get(snakeName(q).toUpperCase()) || [];
}

/**
 * Single best match. Prefers the client/GTA native, since that is what most FiveM code
 * calls; use getNativeVariants when the side matters.
 * @returns {object|null}
 */
export async function getNative(query, { apiset } = {}) {
  const variants = await getNativeVariants(query);
  if (!variants.length) return null;
  if (apiset) return variants.find((v) => v.apiset === apiset) || variants[0];
  return variants.find((v) => v.source === 'gta') || variants[0];
}

/**
 * Keyword search across native names and descriptions.
 * Exact and prefix name matches rank above description matches.
 */
export async function searchNatives(query, { limit = 15, apiset } = {}) {
  const { list } = await loadNatives();
  const terms = String(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (!terms.length) return [];

  const scored = [];
  for (const n of list) {
    // GTA natives carry no apiset; they are client-side unless a CFX server RPC
    // equivalent exists. Treat a missing apiset as 'client' so the filter is real.
    if (apiset && (n.apiset || 'client') !== apiset) continue;
    const name = n.name.toLowerCase();
    const lua = luaName(n.name).toLowerCase();
    const desc = n.description.toLowerCase();

    let score = 0;
    let matched = 0;
    for (const t of terms) {
      let hit = false;
      if (name.includes(t) || lua.includes(t)) {
        score += name.startsWith(t) || lua.startsWith(t) ? 40 : 20;
        hit = true;
      }
      if (desc.includes(t)) {
        score += 3;
        hit = true;
      }
      if (hit) matched++;
    }
    if (!matched) continue;
    score *= matched / terms.length; // reward covering more of the query
    if (n.description) score += 2; // prefer documented natives
    scored.push({ n, score });
  }

  scored.sort((a, b) => b.score - a.score || a.n.name.length - b.n.name.length);

  // Collapse client/server variants of the same native into one result, recording which
  // sides exist so the caller still knows a server RPC equivalent is available.
  const seen = new Map();
  const out = [];
  for (const { n } of scored) {
    const existing = seen.get(n.name);
    if (existing) {
      existing.sides.push(n.apiset || 'client');
      continue;
    }
    const entry = { ...n, sides: [n.apiset || 'client'] };
    seen.set(n.name, entry);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

/** Render a native as a readable signature block. */
export function formatNative(n) {
  const args = n.params.map((p) => `${p.type} ${p.name}`).join(', ');
  const lines = [
    `${n.results} ${luaName(n.name)}(${args})`,
    ``,
    `native   ${n.name}`,
    `hash     ${n.hash}${n.jhash ? `  (jhash ${n.jhash})` : ''}`,
    `namespace ${n.ns}${n.apiset ? `   apiset: ${n.apiset}` : ''}`,
  ];
  if (n.description) lines.push('', n.description);
  if (n.params.some((p) => p.description)) {
    lines.push('', 'Parameters:');
    for (const p of n.params) {
      lines.push(`  ${p.name} (${p.type})${p.description ? ` — ${p.description}` : ''}`);
    }
  }
  if (n.examples?.length) {
    for (const ex of n.examples.slice(0, 2)) {
      lines.push('', `Example (${ex.lang || 'lua'}):`, ex.code || String(ex));
    }
  }
  return lines.join('\n');
}

/**
 * First meaningful line of a description, for one-line result summaries.
 * Descriptions are markdown and often open with a code fence or a blockquote.
 */
export function summarise(description, max = 160) {
  if (!description) return '';
  let inFence = false;
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence; // skip the whole fenced block, not just its delimiters
      continue;
    }
    if (inFence || !line || line.startsWith('>') || line.startsWith('#')) continue;
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return '';
}

export function cacheInfo() {
  return SOURCES.map(({ key }) => {
    const file = cachePath(key);
    let mtime = null;
    try {
      mtime = fs.statSync(file).mtime.toISOString();
    } catch {
      /* not cached */
    }
    return { key, file, cachedAt: mtime, fresh: fresh(file) };
  });
}
