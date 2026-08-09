#!/usr/bin/env node
/**
 * fivem-kit MCP server.
 *
 * Serves FiveM / ox / ESX / QBCore documentation, a security ruleset, a static Lua
 * analyser, and live server-stack detection over the Model Context Protocol — so any
 * MCP-capable editor (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Zed)
 * gets accurate FiveM knowledge instead of guessing at APIs.
 *
 * Transport: stdio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { listDocs, readDocs, searchDocs, loadCorpus } from './corpus.mjs';
import { auditLua, RULE_IDS } from './audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

/** detect-stack lives in the repo's scripts/ during development and is vendored on publish. */
async function loadDetector() {
  const candidates = [
    path.join(HERE, 'vendor', 'detect-stack.mjs'),
    path.join(HERE, '..', '..', 'scripts', 'detect-stack.mjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const mod = await import(new URL(`file://${c.split(path.sep).join('/')}`).href);
      return mod.detectStack;
    }
  }
  return null;
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const json = (o) => text(JSON.stringify(o, null, 2));

const server = new McpServer({ name: 'fivem-kit', version: PKG.version });

/* ------------------------------------------------------------------ docs ---- */

server.registerTool(
  'fivemDocs',
  {
    title: 'Read FiveM documentation',
    description:
      'Read fivem-kit documentation pages covering the FiveM Lua runtime, fxmanifest.lua, GTA natives, the ox (Overextended) stack — ox_lib, ox_core, ox_target, ox_inventory — ESX Legacy, QBCore, Qbox, security rules, worked resource examples, and framework migration. Call with no arguments to list every available page, then request the ones you need. Prefer this over recalling FiveM APIs from memory: these pages are verified against real resource sources.',
    inputSchema: {
      paths: z
        .array(z.string())
        .optional()
        .describe(
          'Doc paths to read, e.g. "ox-stack/references/ox-lib.md". A unique filename such as "ox-lib.md" also resolves. Omit to list all available docs.'
        ),
    },
  },
  async ({ paths }) => {
    if (!paths || paths.length === 0) {
      const docs = listDocs();
      const lines = docs.map((d) => `- ${d.path}\n    ${d.title}${d.description ? ` — ${d.description}` : ''}`);
      return text(
        `${docs.length} documentation pages available.\nCall fivemDocs again with { "paths": [...] } to read them.\n\n${lines.join('\n')}`
      );
    }
    const results = readDocs(paths);
    const out = results
      .map((r) =>
        r.error
          ? `# ${r.path}\n\nERROR: ${r.error}\n${r.candidates ? `\nAvailable:\n${r.candidates.map((c) => `- ${c}`).join('\n')}` : ''}`
          : `# ${r.path}\n\n${r.content}`
      )
      .join('\n\n---\n\n');
    return text(out);
  }
);

server.registerTool(
  'fivemSearch',
  {
    title: 'Search FiveM documentation',
    description:
      'Keyword search across all fivem-kit documentation. Use when you know what you want to do but not which page covers it — e.g. "progress bar animation", "callback timeout", "job grade check", "stash permissions", "convert qb-target". Returns ranked pages with matching excerpts; follow up with fivemDocs for full content.',
    inputSchema: {
      query: z.string().describe('What you are looking for, in plain words or API names.'),
      limit: z.number().int().min(1).max(20).optional().describe('Max results (default 8).'),
    },
  },
  async ({ query, limit }) => {
    const hits = searchDocs(query, limit ?? 8);
    if (!hits.length) {
      return text(
        `No matches for "${query}".\nCall fivemDocs with no arguments to see every available page.`
      );
    }
    const out = hits
      .map((h) => {
        const blocks = h.excerpts.map((e) => `    line ${e.line}:\n${indent(e.text, 6)}`).join('\n');
        return `## ${h.path}  (${h.title})\n${blocks}`;
      })
      .join('\n\n');
    return text(`${hits.length} result(s) for "${query}":\n\n${out}\n\nRead a full page with fivemDocs.`);
  }
);

server.registerTool(
  'fivemNatives',
  {
    title: 'Look up GTA V natives',
    description:
      'Find the GTA V / FiveM native functions for a task — peds, vehicles, entities, blips, controls, animations, NUI, asset loading, NPC tasks — along with the ox_lib wrapper to prefer where one exists. Use before writing any native call you are not certain of.',
    inputSchema: {
      query: z
        .string()
        .describe('Native name or what you want to do, e.g. "GetEntityCoords", "spawn a vehicle", "disable controls".'),
    },
  },
  async ({ query }) => {
    const doc = readDocs(['fivem-core/references/natives.md'])[0];
    if (doc.error) return text(`Natives reference unavailable: ${doc.error}`);
    const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2);
    const lines = doc.content.split(/\r?\n/);
    const hits = lines
      .map((l, i) => ({ l, i, n: terms.filter((t) => l.toLowerCase().includes(t)).length }))
      .filter((h) => h.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 25);
    if (!hits.length) {
      return text(
        `No native matched "${query}".\nThe full native list is at https://docs.fivem.net/natives/ — read fivem-core/references/natives.md via fivemDocs for the curated set.`
      );
    }
    const body = hits
      .sort((a, b) => a.i - b.i)
      .map((h) => h.l)
      .join('\n');
    return text(
      `Matches in fivem-core/references/natives.md:\n\n${body}\n\nFull page: fivemDocs { "paths": ["fivem-core/references/natives.md"] }\nComplete native database: https://docs.fivem.net/natives/`
    );
  }
);

/* ---------------------------------------------------------------- audit ---- */

server.registerTool(
  'fivemAudit',
  {
    title: 'Audit FiveM Lua for exploits',
    description:
      'Statically analyse FiveM Lua source for exploitable defects: SQL injection, dynamic code execution, unrestricted admin commands, `source` used after a yield, secrets committed into scripts, all-player broadcasts, infinite loops with no Wait, and legacy MySQL APIs. Also returns targeted review prompts for the flaws that cannot be detected mechanically (unvalidated event parameters, client-supplied prices, missing distance checks). Pass either source text or a file path. Use whenever writing or reviewing a server-side handler.',
    inputSchema: {
      source: z.string().optional().describe('Lua source to analyse.'),
      filePath: z.string().optional().describe('Path to a .lua file to read and analyse instead.'),
    },
  },
  async ({ source, filePath }) => {
    let code = source;
    let name = 'input.lua';
    if (!code && filePath) {
      try {
        code = fs.readFileSync(filePath, 'utf8');
        name = path.basename(filePath);
      } catch (e) {
        return text(`Could not read ${filePath}: ${e.message}`);
      }
    }
    if (!code) return text('Provide either `source` or `filePath`.');

    const result = auditLua(code, name);
    if (!result.findings.length && !result.reviewRequired.length) {
      return text(`No deterministic findings in ${name}.\n\nRules checked: ${RULE_IDS.map((r) => r.id).join(', ')}`);
    }

    const parts = [];
    if (result.findings.length) {
      parts.push(
        result.findings
          .map(
            (f) =>
              `[${f.rule} · ${f.severity}] ${name}:${f.line}\n${f.title}\n  ${f.code}\n  → ${f.message}\nFix: ${f.fix}`
          )
          .join('\n\n')
      );
    } else {
      parts.push('No deterministic findings.');
    }
    if (result.reviewRequired.length) {
      parts.push(
        'REVIEW REQUIRED (not mechanically decidable — check these by reading the code):\n' +
          result.reviewRequired.map((r) => `- [${r.rules.join(', ')}] ${r.note}`).join('\n')
      );
    }
    parts.push('Full ruleset: fivemDocs { "paths": ["fivem-security/SKILL.md"] }');
    return text(parts.join('\n\n'));
  }
);

/* --------------------------------------------------------------- detect ---- */

server.registerTool(
  'fivemDetectStack',
  {
    title: 'Detect a FiveM server stack',
    description:
      'Inspect a FiveM server folder and report which framework and libraries it actually runs — ox_core, ESX Legacy, QBCore or Qbox; ox_lib, oxmysql, ox_target, ox_inventory and their alternatives — plus every installed resource with its declared dependencies, the server.cfg load order, resources started but missing from disk, and cfg lines containing a semicolon (which FiveM splits on rather than treating as a comment). Run this BEFORE writing code for a server so you use the right dialect.',
    inputSchema: {
      serverPath: z
        .string()
        .optional()
        .describe('Path to the server folder (the one containing resources/). Defaults to the current directory.'),
      includeResources: z
        .boolean()
        .optional()
        .describe('Include the full per-resource list. Default false — summary only.'),
    },
  },
  async ({ serverPath, includeResources }) => {
    const detectStack = await loadDetector();
    if (!detectStack) return text('Stack detector unavailable in this installation.');

    const r = detectStack(serverPath ?? process.cwd());
    if (!r.found) return text(`${r.error}\n\nSearched from: ${r.searchedFrom}`);

    const summary = {
      serverRoot: r.serverRoot,
      serverCfg: r.serverCfg,
      dialect: r.dialect,
      mixedFrameworks: r.mixedFrameworks,
      stack: r.stack,
      counts: r.counts,
      warnings: r.warnings,
    };
    if (includeResources) summary.resources = r.resources;

    const guidance =
      r.dialect === 'ox'
        ? 'Write ox: lib.* from ox_lib, Ox.* from ox_core, exports.ox_target / exports.ox_inventory. See ox-stack docs.'
        : r.dialect === 'esx'
          ? 'Write ESX: ESX = exports["es_extended"]:getSharedObject(), xPlayer.* with DOT syntax. See fivem-frameworks/references/esx.md.'
          : r.dialect === 'qbcore'
            ? 'Write QBCore: exports["qb-core"]:GetCoreObject(), Player.Functions.*. Note job.grade is a TABLE — use job.grade.level. See fivem-frameworks/references/qbcore.md.'
            : r.dialect === 'qbox'
              ? 'Write Qbox: exports.qbx_core:GetPlayer(source) for players, but ox_lib (lib.callback, lib.notify) and ox_target for everything else. See fivem-frameworks/references/qbcore.md.'
              : 'No framework detected — write standalone, or ox if ox_lib is present.';

    const warn = r.mixedFrameworks
      ? '\n\nWARNING: more than one framework is installed. Confirm which is authoritative before writing code — mixing them causes duplicate player state and money desync.'
      : '';

    return text(`${JSON.stringify(summary, null, 2)}\n\nGuidance: ${guidance}${warn}`);
  }
);

/* ------------------------------------------------------------------ boot ---- */

function indent(s, n) {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

async function main() {
  // Surface a clear error if the corpus is missing rather than serving empty docs.
  const { list } = loadCorpus();
  if (!list.length) {
    console.error(
      '[fivem-kit] No documentation corpus found. Run `npm run build:corpus` in the mcp/ directory, or run from a full repo checkout.'
    );
  }
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error('[fivem-kit] fatal:', err);
  process.exit(1);
});
