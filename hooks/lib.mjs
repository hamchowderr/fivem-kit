/**
 * Shared plumbing for every fivem hook.
 *
 * All hooks run through one dispatcher (`fivem-hook.mjs`), so this module owns the three
 * things every handler needs to get right:
 *
 *   1. **The quick exit.** A hook fires on every session, every write, every prompt. In a
 *      project that has nothing to do with FiveM it must cost approximately nothing and
 *      print nothing. `guard()` is the first line of every handler.
 *   2. **The output contract.** JSON is read from stdout only on exit 0. Exit 2 discards
 *      stdout and shows stderr to Claude as a blocking error. Emitting the wrong one is the
 *      difference between "here is some context" and "your tool call was refused", so
 *      handlers never build that JSON by hand.
 *   3. **Never failing loudly.** A crashing hook is worse than a missing one — it interrupts
 *      work that has nothing to do with us. Anything unexpected exits 0 and silent.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveConfig } from '../scripts/fivem-config.mjs';

/** Hard cap from the hooks reference. Exceeding it sends the output to a file instead. */
export const MAX_STDOUT = 10_000;

/** Read the event JSON from stdin. Returns `{}` rather than throwing on anything unexpected. */
export async function readEvent() {
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * Emit a JSON result on stdout and exit 0.
 * Truncates rather than letting Claude Code spill our output to a file.
 */
export function emit(payload) {
  if (payload) {
    let text = JSON.stringify(payload);
    if (text.length > MAX_STDOUT) {
      // Trim the context field rather than the envelope, so the JSON stays parseable.
      const ctx = payload?.hookSpecificOutput?.additionalContext;
      if (typeof ctx === 'string') {
        const room = MAX_STDOUT - (text.length - ctx.length) - 32;
        payload.hookSpecificOutput.additionalContext = `${ctx.slice(0, Math.max(0, room))}\n…truncated`;
        text = JSON.stringify(payload);
      } else {
        text = text.slice(0, MAX_STDOUT);
      }
    }
    process.stdout.write(text);
  }
  process.exit(0);
}

/** Say nothing, allow everything. The overwhelmingly common path. */
export function silent() {
  process.exit(0);
}

/**
 * Refuse the tool call.
 *
 * Uses `permissionDecision: "deny"` on stdout with exit 0 — NOT exit 2. Exit 2 discards
 * stdout entirely and hard-blocks with whatever is on stderr, which loses the structured
 * reason. Several published examples get this backwards.
 */
export function deny(hookEventName, reason) {
  emit({
    hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason: reason },
  });
}

/** Inject context for Claude to read. */
export function context(hookEventName, additionalContext) {
  if (!additionalContext) silent();
  emit({ hookSpecificOutput: { hookEventName, additionalContext } });
}

/**
 * The gate every handler opens with.
 *
 * Activation is project-scoped by design: the plugin does work only when this project has a
 * `.claude/fivem.local.md` that parses and is enabled. A machine-wide user preference can
 * supply a value but can never switch the plugin on, so an unrelated repository never pays
 * for a hook it did not ask for.
 *
 * @returns {object|null} the resolved config, or null when the handler should exit silently
 */
export function guard(event) {
  const projectDir = event?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let resolved;
  try {
    resolved = resolveConfig({ projectDir });
  } catch {
    return null; // a malformed config is "not configured", never a crash
  }
  if (!resolved.ok) return null;
  return { ...resolved.config, projectDir, configPath: resolved.path };
}

/**
 * Per-session scratch state — the compaction marker, the queue of files written this turn.
 *
 * Lives in the OS temp directory keyed by session id, never in the user's project. Hook state
 * is disposable: losing it costs one missed reminder, whereas writing it into the workspace
 * would mean a plugin littering repositories it does not own.
 */
export function stateFile(event, name) {
  const session = String(event?.session_id ?? 'nosession').replace(/[^A-Za-z0-9_-]/g, '');
  const dir = path.join(os.tmpdir(), 'fivem-hooks', session);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return path.join(dir, name);
}

export function readState(event, name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(event, name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeState(event, name, value) {
  try {
    fs.writeFileSync(stateFile(event, name), JSON.stringify(value));
  } catch {
    /* best effort — losing hook state must never break a turn */
  }
}

export function clearState(event, name) {
  try {
    fs.unlinkSync(stateFile(event, name));
  } catch {
    /* already gone */
  }
}

/** Is this path a Lua file inside a FiveM resource, rather than any old .lua? */
export function isResourceLua(file) {
  if (!file || !file.toLowerCase().endsWith('.lua')) return false;
  const parts = file.split(/[\\/]/);
  if (parts.includes('node_modules')) return false;
  return true;
}

/** A one-line description of the detected stack, for injecting into context. */
export function describeStack(config) {
  const bits = [`dialect: ${config.dialect ?? 'unknown'}`];
  if (config.framework) bits.push(`framework: ${config.framework}`);
  if (config.lib) bits.push(`lib: ${config.lib}`);
  if (config.serverPath) bits.push(`server: ${config.serverPath}`);
  return bits.join(' · ');
}
