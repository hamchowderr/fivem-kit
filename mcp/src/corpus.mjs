/**
 * Corpus loading + search for the fivem-kit MCP server.
 *
 * The documentation corpus is the plugin's own markdown. It is resolved from one of
 * two places, in order:
 *
 *   1. `mcp/corpus/`        — populated by `npm run build:corpus`, what ships to npm
 *   2. the repo checkout    — `skills/<skill>/references/*.md`, `skills/<skill>/SKILL.md`, `docs/*.md`
 *
 * That means the published package is self-contained while a git checkout works with
 * no build step.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');

/**
 * Where the corpus may live, in priority order.
 *
 * A repo checkout wins over the bundled copy: `corpus/` is build output, and during
 * development a stale bundle would silently mask edits to the real skill files.
 * The bundled copy is what the published npm package falls back to.
 */
function corpusRoots() {
  const roots = [];
  const skills = path.join(REPO_ROOT, 'skills');
  if (fs.existsSync(skills)) roots.push({ root: skills, prefix: '' });
  const docs = path.join(REPO_ROOT, 'docs');
  if (fs.existsSync(docs)) roots.push({ root: docs, prefix: 'docs/' });
  if (roots.length) return roots;

  const bundled = path.join(PACKAGE_ROOT, 'corpus');
  if (fs.existsSync(bundled)) return [{ root: bundled, prefix: '' }];
  return [];
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function titleOf(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const fm = text.match(/^---\r?\n[\s\S]*?^name:\s*(.+)$/m);
  if (fm) return fm[1].trim();
  return fallback;
}

function describeOf(text) {
  const fm = text.match(/^---\r?\n[\s\S]*?^description:\s*(.+?)\r?\n/m);
  if (fm) return fm[1].trim();
  // first non-heading, non-blockquote paragraph
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('|')) continue;
    return t.slice(0, 200);
  }
  return '';
}

let CACHE = null;

/** Load and index every markdown file in the corpus. */
export function loadCorpus() {
  if (CACHE) return CACHE;

  const docs = new Map();
  for (const { root, prefix } of corpusRoots()) {
    for (const file of walk(root)) {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const rel = (prefix + path.relative(root, file)).split(path.sep).join('/');
      if (docs.has(rel)) continue;
      docs.set(rel, {
        path: rel,
        file,
        text,
        title: titleOf(text, rel),
        description: describeOf(text),
        headings: [...text.matchAll(/^#{2,4}\s+(.+)$/gm)].map((m) => m[1].trim()),
      });
    }
  }

  CACHE = { docs, list: [...docs.values()] };
  return CACHE;
}

/** A directory listing suitable for showing an agent what exists. */
export function listDocs() {
  const { list } = loadCorpus();
  return list
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((d) => ({ path: d.path, title: d.title, description: d.description }));
}

/** Read one or more docs by exact path or unique suffix match. */
export function readDocs(paths) {
  const { docs, list } = loadCorpus();
  const out = [];
  for (const raw of paths) {
    const want = String(raw).replace(/^\/+/, '').split(path.sep).join('/');
    let doc = docs.get(want);
    if (!doc) {
      const matches = list.filter(
        (d) => d.path === want || d.path.endsWith('/' + want) || d.path.includes(want)
      );
      if (matches.length === 1) doc = matches[0];
      else if (matches.length > 1) {
        out.push({
          path: want,
          error: `ambiguous — matches ${matches.length} docs`,
          candidates: matches.map((m) => m.path),
        });
        continue;
      }
    }
    if (!doc) {
      out.push({
        path: want,
        error: 'not found',
        candidates: list.map((d) => d.path).slice(0, 40),
      });
      continue;
    }
    out.push({ path: doc.path, title: doc.title, content: doc.text });
  }
  return out;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with',
  'how', 'do', 'i', 'my', 'what', 'when', 'use', 'using', 'fivem',
]);

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9_.:]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Keyword search across the corpus.
 * Scores title/heading hits above body hits, then returns the best-matching excerpts.
 */
export function searchDocs(query, limit = 8) {
  const { list } = loadCorpus();
  const terms = tokenize(query);
  if (!terms.length) return [];

  const scored = [];
  for (const doc of list) {
    const hay = doc.text.toLowerCase();
    const titleHay = doc.title.toLowerCase();
    const headHay = doc.headings.join(' \n ').toLowerCase();

    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const inBody = hay.split(t).length - 1;
      if (inBody > 0) matched++;
      score += Math.min(inBody, 12) * 1;
      score += (titleHay.split(t).length - 1) * 12;
      score += (headHay.split(t).length - 1) * 5;
    }
    if (!matched) continue;
    // reward documents matching more of the query
    score *= matched / terms.length;
    scored.push({ doc, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ doc, score }) => ({
    path: doc.path,
    title: doc.title,
    score: Math.round(score * 10) / 10,
    excerpts: excerpt(doc.text, terms),
  }));
}

/** Pull the most relevant lines with a little surrounding context. */
function excerpt(text, terms, maxBlocks = 3, context = 4) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    let n = 0;
    for (const t of terms) if (l.includes(t)) n++;
    if (n) hits.push({ i, n });
  }
  hits.sort((a, b) => b.n - a.n || a.i - b.i);

  const blocks = [];
  const used = [];
  for (const h of hits) {
    if (blocks.length >= maxBlocks) break;
    if (used.some((r) => Math.abs(r - h.i) < context * 2)) continue;
    used.push(h.i);
    const start = Math.max(0, h.i - context);
    const end = Math.min(lines.length, h.i + context + 1);
    blocks.push({ line: h.i + 1, text: lines.slice(start, end).join('\n') });
  }
  return blocks;
}
