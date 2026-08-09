/**
 * Reader/writer for `.claude/fivem.local.md` — the plugin's per-project state.
 *
 * ## Why this file is paranoid
 *
 * This config lives *in the workspace*, so a cloned FiveM repository can ship one. Every
 * hook in this plugin reads it at session start, and hooks run commands. That is precisely
 * the attack Claude Code hardened `pluginConfigs` against:
 *
 *   "Entries in a project's .claude/settings.json or .claude/settings.local.json are
 *    ignored. Both files live in the workspace, so a cloned repository could supply values
 *    there, and those values would flow into plugin hook commands, MCP server configs, LSP
 *    commands, and monitor commands."
 *
 * The platform also refuses `${user_config.*}` in any shell-evaluated field, because
 * "substituting a configured value into a shell command would let the shell run whatever
 * that value contains."
 *
 * We cannot use `userConfig` here — it is deliberately user-scoped and cannot hold a
 * per-project server path — so we accept the file and treat every byte of it as hostile:
 *
 *   1. **Nothing from this file is ever interpolated into a shell string.** Callers spawn
 *      with an argv array. This module never builds a command.
 *   2. Every field is validated against an allow-list or a strict shape. Values that fail
 *      are dropped with a warning, never passed through.
 *   3. Unknown keys are discarded, so a crafted file cannot smuggle extra state to a
 *      consumer that trusts `config[x]`.
 *   4. Parsing is bounded — file size, line count, key count, and value length — so a
 *      hostile file cannot wedge a hook that runs on every session.
 *
 * Consumers should treat a `false` return from `readConfig().ok` as "behave as if the
 * plugin is not configured", never as "use partial data".
 */

import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_DIR = '.claude';
export const CONFIG_FILENAME = 'fivem.local.md';

/** Bounds — a hook reading this runs on every session, so it must not be wedgeable. */
const MAX_BYTES = 64 * 1024;
const MAX_FRONTMATTER_LINES = 200;
const MAX_VALUE_LENGTH = 4096;
const MAX_PATH_LENGTH = 4096;

export const DIALECTS = ['ox', 'esx', 'qbcore', 'qbox', 'standalone'];
const BEADS_MODES = ['auto', 'on', 'off'];

/**
 * Characters that cannot legitimately appear in a Windows or POSIX directory path but are
 * meaningful to a shell. Backslash is NOT included — it is the Windows path separator.
 *
 * This is defence in depth only. The real protection is that no value here ever reaches a
 * shell; callers use argv arrays.
 */
const SHELL_METACHARACTERS = /[;|&\`$<>"']/;
// C0 controls plus DEL. Must NOT reject a plain space — Windows paths are full of them.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/** Conservative identifier shape for resource/framework names. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;

const TRUE_VALUES = new Set(['true', 'yes', 'on', '1']);
const FALSE_VALUES = new Set(['false', 'no', 'off', '0']);

export function configPath(projectDir = process.cwd()) {
  return path.join(projectDir, CONFIG_DIR, CONFIG_FILENAME);
}

/**
 * Extract the YAML frontmatter block.
 *
 * Only the FIRST two `---` delimiters count, so a `---` inside the markdown body cannot
 * extend or reopen the block. Returns null when there is no well-formed frontmatter.
 */
function extractFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return null;
  const block = lines.slice(1, end);
  if (block.length > MAX_FRONTMATTER_LINES) return null;
  return block;
}

/** Strip one layer of matching quotes, if present. */
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse flat `key: value` pairs. Deliberately NOT a YAML parser:
 * nested structures, anchors, aliases and multi-line scalars are all rejected rather than
 * interpreted, because every one of them is a way to smuggle unexpected shapes past a
 * consumer that expects a string.
 */
function parseFlatPairs(lines, warnings) {
  const out = new Map();
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    if (/^\s/.test(line)) {
      warnings.push('nested or indented YAML is not supported; line ignored');
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) {
      warnings.push('frontmatter line without a key; ignored');
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    if (!SAFE_IDENTIFIER.test(key)) {
      warnings.push(`ignored key with unexpected characters`);
      continue;
    }
    if (value.length > MAX_VALUE_LENGTH) {
      warnings.push(`value for "${key}" exceeds ${MAX_VALUE_LENGTH} characters; ignored`);
      continue;
    }
    const v = unquote(value);
    if (v.startsWith('[') || v.startsWith('{') || v === '|' || v === '>') {
      warnings.push(`value for "${key}" is a structure or block scalar; only scalars are accepted`);
      continue;
    }
    out.set(key, v);
  }
  return out;
}

function asBoolean(value, key, warnings, fallback) {
  const v = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  warnings.push(`"${key}" is not a boolean; using ${fallback}`);
  return fallback;
}

function asEnum(value, allowed, key, warnings) {
  const v = String(value).trim().toLowerCase();
  if (allowed.includes(v)) return v;
  warnings.push(`"${key}" is not one of ${allowed.join('/')}; dropped`);
  return null;
}

function asIdentifier(value, key, warnings) {
  const v = String(value).trim();
  if (SAFE_IDENTIFIER.test(v)) return v;
  warnings.push(`"${key}" is not a plain identifier; dropped`);
  return null;
}

/**
 * Validate a server path from an untrusted file.
 *
 * Must be absolute, free of control and shell-meaningful characters, and resolve to a real
 * directory that actually contains `resources/`. That last check is the strongest one: a
 * crafted value that is not a real FiveM server folder never reaches a consumer.
 *
 * @param {boolean} checkExists set false in tests that only exercise the string rules
 */
export function validateServerPath(value, warnings = [], { checkExists = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.length > MAX_PATH_LENGTH) {
    warnings.push('server_path is too long; dropped');
    return null;
  }
  if (CONTROL_CHARACTERS.test(v)) {
    warnings.push('server_path contains control characters; dropped');
    return null;
  }
  if (SHELL_METACHARACTERS.test(v)) {
    warnings.push('server_path contains shell-meaningful characters; dropped');
    return null;
  }
  if (!path.isAbsolute(v)) {
    warnings.push('server_path must be absolute; dropped');
    return null;
  }
  const resolved = path.resolve(v);
  if (!checkExists) return resolved;
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      warnings.push('server_path is not a directory; dropped');
      return null;
    }
    if (!fs.existsSync(path.join(resolved, 'resources'))) {
      warnings.push('server_path has no resources/ directory; dropped');
      return null;
    }
  } catch {
    warnings.push('server_path does not exist or is unreadable; dropped');
    return null;
  }
  return resolved;
}

/**
 * Validate raw key/value pairs into a typed, trusted config.
 * Unknown keys are dropped rather than passed through.
 */
export function validate(pairs, { checkExists = true } = {}) {
  const warnings = [];
  const map = pairs instanceof Map ? pairs : new Map(Object.entries(pairs ?? {}));

  const known = new Set([
    'enabled',
    'server_path',
    'dialect',
    'framework',
    'lib',
    'audit_on_write',
    'remind_on_stop',
    'redact_secrets',
    'lsp',
    'beads',
    'beads_min_severity',
  ]);
  for (const key of map.keys()) {
    if (!known.has(key)) warnings.push(`unknown key "${key}" ignored`);
  }

  const has = (k) => map.has(k) && map.get(k) !== '';

  const config = {
    enabled: has('enabled') ? asBoolean(map.get('enabled'), 'enabled', warnings, true) : true,
    serverPath: has('server_path')
      ? validateServerPath(map.get('server_path'), warnings, { checkExists })
      : null,
    dialect: has('dialect') ? asEnum(map.get('dialect'), DIALECTS, 'dialect', warnings) : null,
    framework: has('framework') ? asIdentifier(map.get('framework'), 'framework', warnings) : null,
    lib: has('lib') ? asIdentifier(map.get('lib'), 'lib', warnings) : null,
    auditOnWrite: has('audit_on_write')
      ? asBoolean(map.get('audit_on_write'), 'audit_on_write', warnings, true)
      : true,
    remindOnStop: has('remind_on_stop')
      ? asBoolean(map.get('remind_on_stop'), 'remind_on_stop', warnings, true)
      : true,
    redactSecrets: has('redact_secrets')
      ? asBoolean(map.get('redact_secrets'), 'redact_secrets', warnings, true)
      : true,
    lsp: has('lsp') ? asBoolean(map.get('lsp'), 'lsp', warnings, false) : false,
    beads: has('beads') ? (asEnum(map.get('beads'), BEADS_MODES, 'beads', warnings) ?? 'auto') : 'auto',
    beadsMinSeverity: has('beads_min_severity')
      ? (asEnum(
          map.get('beads_min_severity'),
          ['critical', 'high', 'medium', 'low'],
          'beads_min_severity',
          warnings
        ) ?? 'high')
      : 'high',
  };

  return { config, warnings };
}

/**
 * Read and validate the project config.
 *
 * @returns {{ok: boolean, found: boolean, config: object|null, warnings: string[], path: string}}
 *   `ok` is false when the plugin should behave as if unconfigured — file missing,
 *   malformed, or `enabled: false`. Never returns partial data with `ok: true`.
 */
export function readConfig(projectDir = process.cwd(), opts = {}) {
  const file = configPath(projectDir);
  const result = { ok: false, found: false, config: null, warnings: [], path: file };

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return result; // not configured — the common case, and silent by design
  }
  result.found = true;

  if (!stat.isFile()) {
    result.warnings.push('config path is not a file');
    return result;
  }
  if (stat.size > MAX_BYTES) {
    result.warnings.push(`config exceeds ${MAX_BYTES} bytes; ignored`);
    return result;
  }

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    result.warnings.push('config is unreadable');
    return result;
  }

  const block = extractFrontmatter(text);
  if (!block) {
    result.warnings.push('config has no well-formed YAML frontmatter');
    return result;
  }

  const pairs = parseFlatPairs(block, result.warnings);
  const { config, warnings } = validate(pairs, opts);
  result.warnings.push(...warnings);
  result.config = config;
  result.ok = config.enabled;
  return result;
}

/** Serialise a config to the file's markdown form. Only known keys are written. */
export function renderConfig(values = {}) {
  const v = {
    enabled: true,
    audit_on_write: true,
    remind_on_stop: true,
    redact_secrets: true,
    lsp: false,
    beads: 'auto',
    ...values,
  };
  const order = [
    'enabled',
    'server_path',
    'dialect',
    'framework',
    'lib',
    'audit_on_write',
    'remind_on_stop',
    'redact_secrets',
    'lsp',
    'beads',
  ];
  const lines = ['---'];
  for (const key of order) {
    if (v[key] === undefined || v[key] === null || v[key] === '') continue;
    const val = typeof v[key] === 'boolean' ? String(v[key]) : `"${String(v[key]).replace(/"/g, '')}"`;
    lines.push(`${key}: ${val}`);
  }
  lines.push('---', '');
  lines.push('# fivem-kit — detected server configuration');
  lines.push('');
  lines.push('Written by `/fivem:init`. Re-run it after changing the server stack.');
  lines.push('');
  lines.push('This file is read by the plugin only. Add `.claude/*.local.md` to `.gitignore` —');
  lines.push('it describes your machine, and the plugin treats a committed one as untrusted input.');
  lines.push('');
  return lines.join('\n');
}
