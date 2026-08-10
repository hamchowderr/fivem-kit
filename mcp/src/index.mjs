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
import { loadRemoteCorpus, searchRemote, describeSources } from './corpus-remote.mjs';
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

/**
 * A result carrying both the human-readable text and the typed payload (MCP 2025-06-18).
 *
 * The text block is not optional even when `structuredContent` is present — the spec requires
 * it, and it is what an older client or a plain LLM actually reads. `structuredContent` is
 * validated against the tool's `outputSchema` by the SDK, so a shape that drifts from the
 * schema fails loudly here rather than silently reaching a caller.
 */
const structured = (s, data) => ({ content: [{ type: 'text', text: s }], structuredContent: data });

const server = new McpServer({ name: PKG.name, version: PKG.version });

/* ------------------------------------------------------------------ docs ---- */

server.registerTool(
  'fivemDocs',
  {
    title: 'Read FiveM documentation',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
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

      // Say plainly which frameworks have official corpora and which do not, so a caller
      // does not go looking for ESX docs that were never published.
      const official = describeSources()
        .map((s) => `- ${s.name.padEnd(7)} ${s.available ? `available — ${s.label}` : `unavailable — ${s.note}`}`)
        .join('\n');

      return text(
        `${docs.length} documentation pages available.\nCall fivemDocs again with { "paths": [...] } to read them.\n\n${lines.join('\n')}\n\n` +
          `Official framework documentation (search with fivemSearch { "source": ... }):\n${official}`
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      'Keyword search across FiveM documentation. Use when you know what you want to do but not which page covers it — e.g. "progress bar animation", "callback timeout", "job grade check", "stash permissions", "convert qb-target". Searches the bundled fivem-kit corpus by default; pass `source` to search the framework\'s OFFICIAL documentation instead — "ox" and "qbcore" publish complete machine-readable corpora. Returns ranked results with matching excerpts.',
    inputSchema: {
      query: z.string().describe('What you are looking for, in plain words or API names.'),
      limit: z.number().int().min(1).max(20).optional().describe('Max results (default 8).'),
      source: z
        .enum(['kit', 'ox', 'qbcore'])
        .optional()
        .describe(
          'Which corpus to search. "kit" (default) is the bundled, source-verified reference. ' +
            '"ox" and "qbcore" fetch the framework\'s own official documentation. ESX and Qbox ' +
            'publish no machine-readable corpus, so their coverage lives in "kit".'
        ),
    },
  },
  async ({ query, limit, source }) => {
    const max = limit ?? 8;

    if (source && source !== 'kit') {
      const corpus = await loadRemoteCorpus(source);
      if (!corpus.ok) {
        // Degrade to the bundled corpus rather than failing: an upstream outage should cost
        // the user nothing, and the hand-written reference is verified against real sources.
        const fallback = searchDocs(query, max);
        return text(
          `Official ${source} documentation is unavailable (${corpus.reason}).\n` +
            `Falling back to the bundled fivem-kit corpus — ${fallback.length} result(s):\n\n` +
            fallback
              .map((h) => `## ${h.path}  (${h.title})\n${h.excerpts.map((e) => indent(e.text, 6)).join('\n')}`)
              .join('\n\n')
        );
      }
      const hits = searchRemote(corpus.text, query, { limit: max });
      if (!hits.length) {
        return text(`No matches for "${query}" in the official ${source} documentation.`);
      }
      return text(
        `${hits.length} result(s) for "${query}" in the OFFICIAL ${source} documentation` +
          `${corpus.cached ? ' (cached)' : ''}:\n\n` +
          hits.map((h) => `## ${h.heading}  (line ${h.line})\n${indent(h.excerpt, 4)}`).join('\n\n')
      );
    }

    const hits = searchDocs(query, max);
    if (!hits.length) {
      return text(
        `No matches for "${query}".\nCall fivemDocs with no arguments to see every available page.\n` +
          'To search a framework\'s official documentation instead, pass source: "ox" or "qbcore".'
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
    title: 'Look up GTA V and FiveM natives',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      'Search the COMPLETE native database — every GTA V native plus the CFX/FiveM namespace, about 7,300 in total, with exact parameter names, types, return types and official descriptions. Look a native up by name (SetEntityCoords or SET_ENTITY_COORDS), by hash (0x06843DA7060A026B), or by describing what you want to do ("give weapon to ped", "set vehicle fuel"). ALWAYS use this before writing a native call you are not completely certain of — argument order and return types are easy to get subtly wrong, and this returns the authoritative signature.',
    inputSchema: {
      query: z
        .string()
        .describe('Native name, hash, or a description of the task.'),
      side: z
        .enum(['client', 'server'])
        .optional()
        .describe('Restrict to natives callable on this side. Many natives have both a client version and a server RPC equivalent.'),
      limit: z.number().int().min(1).max(25).optional().describe('Max search results (default 10).'),
    },
  },
  async ({ query, side, limit }) => {
    let natives;
    try {
      natives = await import('./natives.mjs');
    } catch (e) {
      return text(`Natives database unavailable: ${e.message}`);
    }

    // exact name or hash first
    try {
      const variants = await natives.getNativeVariants(query);
      if (variants.length) {
        const chosen = side ? variants.filter((v) => (v.apiset || 'client') === side) : variants;
        const use = chosen.length ? chosen : variants;
        const blocks = use.map((v) => natives.formatNative(v)).join('\n\n---\n\n');
        const note =
          variants.length > 1
            ? `\n\nThis native exists on ${variants.length} sides: ${variants
                .map((v) => v.apiset || 'client')
                .join(', ')}. Use the one matching the script you are writing.`
            : '';
        const wrapper = oxWrapperHint(use[0].name);
        return text(`${blocks}${note}${wrapper}`);
      }

      const results = await natives.searchNatives(query, { limit: limit ?? 10, apiset: side });
      if (!results.length) {
        return text(
          `No native matched "${query}".\nTry different words, or browse https://docs.fivem.net/natives/`
        );
      }
      const body = results
        .map((n) => {
          const args = n.params.map((p) => `${p.type} ${p.name}`).join(', ');
          const sides = [...new Set(n.sides)].join('+');
          const summary = natives.summarise(n.description);
          const desc = summary ? `\n    ${summary}` : '';
          return `${n.results} ${natives.luaName(n.name)}(${args})   [${sides}]${desc}`;
        })
        .join('\n\n');
      return text(
        `${results.length} match(es) for "${query}":\n\n${body}\n\n` +
          `Call fivemNatives again with an exact name for the full signature, parameter docs and examples.${oxWrapperHint(results[0].name)}`
      );
    } catch (e) {
      return text(
        `Could not query the natives database (${e.message}).\n` +
          `It is fetched from runtime.fivem.net on first use and cached locally; check network access.\n` +
          `The curated subset is still available: fivemDocs { "paths": ["fivem-core/references/natives.md"] }`
      );
    }
  }
);

/** Point at the ox_lib wrapper when one exists — it handles the waiting and cleanup. */
function oxWrapperHint(nativeName) {
  const n = nativeName.toUpperCase();
  const map = [
    [/^REQUEST_MODEL$|^HAS_MODEL_LOADED$/, 'lib.requestModel(model)'],
    [/^REQUEST_ANIM_DICT$/, 'lib.requestAnimDict(dict)'],
    [/^TASK_PLAY_ANIM$/, 'lib.playAnim(ped, dict, clip, ...)'],
    [/^DRAW_MARKER$/, 'lib.marker.new({...}) + :draw()'],
    [/^DISABLE_CONTROL_ACTION$/, 'lib.disableControls:Add(...)'],
    [/^IS_CONTROL_JUST_PRESSED$|^REGISTER_KEY_MAPPING$/, 'lib.addKeybind({...})'],
    [/^START_SHAPE_TEST/, 'lib.raycast.fromCamera(...) / fromCoords(...)'],
    [/^CREATE_VEHICLE$/, 'lib.vehicle.create(...) or Ox.CreateVehicle(...) for persistence'],
    [/^CREATE_PED$/, 'lib.ped.create(...)'],
    [/^CREATE_OBJECT$/, 'lib.prop.create(...)'],
    [/^GET_PLAYER_PED$|^PLAYER_PED_ID$/, 'cache.ped (client) / Ox.GetPlayer(src) (server)'],
  ];
  for (const [re, wrapper] of map) {
    if (re.test(n)) return `\n\nox_lib provides a wrapper for this: ${wrapper} — prefer it; it handles the wait, timeout and cleanup.`;
  }
  return '';
}

/* ---------------------------------------------------------------- audit ---- */

/**
 * Structured output shapes (MCP 2025-06-18).
 *
 * Declaring an `outputSchema` means every successful return MUST carry a matching
 * `structuredContent`, so these shapes have to cover the failure paths too — hence `ok` and
 * an optional `error` rather than a separate error return. The text block stays exactly as it
 * was: the spec requires it, and a client that ignores structured output is unaffected.
 *
 * The field names mirror what `auditLua` and `detectStack` already return, so there is one
 * shape to keep true rather than two that can drift apart.
 */
const FINDING_SHAPE = z.object({
  rule: z.string().describe('Rule id, e.g. SEC-5.'),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  title: z.string(),
  file: z.string(),
  line: z.number(),
  code: z.string().describe('The offending source line.'),
  message: z.string().describe('Why it is exploitable.'),
  fix: z.string(),
});

const AUDIT_OUTPUT = {
  ok: z.boolean().describe('False when the source could not be read.'),
  error: z.string().optional(),
  file: z.string(),
  findings: z.array(FINDING_SHAPE),
  reviewRequired: z
    .array(z.object({ rules: z.array(z.string()), note: z.string() }))
    .describe('Client-reachable handlers the analyser cannot judge. Read these by hand.'),
  counts: z.object({
    CRITICAL: z.number(),
    HIGH: z.number(),
    MEDIUM: z.number(),
    LOW: z.number(),
  }),
  rulesChecked: z.array(z.string()),
};

server.registerTool(
  'fivemAudit',
  {
    title: 'Audit FiveM Lua for exploits',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      'Statically analyse FiveM Lua source for exploitable defects: SQL injection, dynamic code execution, unrestricted admin commands, `source` used after a yield, secrets committed into scripts, all-player broadcasts, infinite loops with no Wait, and legacy MySQL APIs. Also returns targeted review prompts for the flaws that cannot be detected mechanically (unvalidated event parameters, client-supplied prices, missing distance checks). Pass either source text or a file path. Use whenever writing or reviewing a server-side handler.',
    inputSchema: {
      source: z.string().optional().describe('Lua source to analyse.'),
      filePath: z.string().optional().describe('Path to a .lua file to read and analyse instead.'),
    },
    outputSchema: AUDIT_OUTPUT,
  },
  async ({ source, filePath }) => {
    const empty = { findings: [], reviewRequired: [], counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } };
    const rulesChecked = RULE_IDS.map((r) => r.id);
    const fail = (name, message) =>
      structured(message, { ok: false, error: message, file: name, ...empty, rulesChecked });

    let code = source;
    let name = 'input.lua';
    if (!code && filePath) {
      try {
        code = fs.readFileSync(filePath, 'utf8');
        name = path.basename(filePath);
      } catch (e) {
        return fail(path.basename(filePath), `Could not read ${filePath}: ${e.message}`);
      }
    }
    if (!code) return fail(name, 'Provide either `source` or `filePath`.');

    const result = auditLua(code, name);
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of result.findings) counts[f.severity]++;
    const data = {
      ok: true,
      file: name,
      findings: result.findings,
      reviewRequired: result.reviewRequired,
      counts,
      rulesChecked,
    };

    if (!result.findings.length && !result.reviewRequired.length) {
      return structured(
        `No deterministic findings in ${name}.\n\nRules checked: ${rulesChecked.join(', ')}`,
        data
      );
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
    return structured(parts.join('\n\n'), data);
  }
);

/* --------------------------------------------------------------- detect ---- */

/** One detected category: the winner, its human label, and everything else found. */
const STACK_CATEGORY = z.object({
  primary: z.string().nullable(),
  label: z.string().nullable(),
  all: z.array(z.string()),
});

const DETECT_OUTPUT = {
  found: z.boolean(),
  error: z.string().optional(),
  searchedFrom: z.string().optional(),
  serverRoot: z.string().nullable(),
  serverCfg: z.string().nullable(),
  dialect: z.enum(['ox', 'esx', 'qbcore', 'qbox', 'standalone']).nullable(),
  mixedFrameworks: z.boolean(),
  stack: z
    .object({
      framework: STACK_CATEGORY,
      mysql: STACK_CATEGORY,
      inventory: STACK_CATEGORY,
      target: STACK_CATEGORY,
      lib: STACK_CATEGORY,
    })
    .nullable(),
  counts: z.object({ resources: z.number(), startedInCfg: z.number() }).nullable(),
  warnings: z
    .object({
      onDiskNotStarted: z.array(z.string()),
      startedNotOnDisk: z.array(z.string()),
      semicolonLinesInCfg: z.array(z.object({ line: z.number(), text: z.string() })),
    })
    .nullable(),
  resources: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        relPath: z.string(),
        dependencies: z.array(z.string()),
        started: z.boolean(),
      })
    )
    .optional(),
  guidance: z.string().describe('Which dialect to write, in one line.'),
};

server.registerTool(
  'fivemDetectStack',
  {
    title: 'Detect a FiveM server stack',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
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
    outputSchema: DETECT_OUTPUT,
  },
  async ({ serverPath, includeResources }) => {
    const notFound = (message, searchedFrom) =>
      structured(message, {
        found: false,
        error: message,
        ...(searchedFrom ? { searchedFrom } : {}),
        serverRoot: null,
        serverCfg: null,
        dialect: null,
        mixedFrameworks: false,
        stack: null,
        counts: null,
        warnings: null,
        guidance: 'No server detected — ask for the path to the folder containing resources/.',
      });

    const detectStack = await loadDetector();
    if (!detectStack) return notFound('Stack detector unavailable in this installation.');

    const r = detectStack(serverPath ?? process.cwd());
    if (!r.found) return notFound(`${r.error}\n\nSearched from: ${r.searchedFrom}`, r.searchedFrom);

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

    return structured(`${JSON.stringify(summary, null, 2)}\n\nGuidance: ${guidance}${warn}`, {
      found: true,
      serverRoot: r.serverRoot,
      serverCfg: r.serverCfg,
      dialect: r.dialect,
      mixedFrameworks: r.mixedFrameworks,
      stack: r.stack,
      counts: r.counts,
      warnings: r.warnings,
      ...(includeResources ? { resources: r.resources } : {}),
      guidance,
    });
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
