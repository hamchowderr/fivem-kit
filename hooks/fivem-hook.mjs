#!/usr/bin/env node
/**
 * One dispatcher for every fivem hook.
 *
 * `hooks.json` registers this file for sixteen events, differing only by the handler name in
 * `args`. One file rather than eleven means the quick-exit guard, the JSON contract and the
 * never-crash policy are written once and are testable in one place — and every entry has the
 * same shape, so an event added later cannot accidentally get a different contract.
 *
 * Invoked as: node hooks/fivem-hook.mjs <handler>
 *
 * Registered in exec form (`command: "node"`, `args: [...]`) rather than shell form. That is
 * deliberate and load-bearing: nothing from the untrusted project config, and nothing from a
 * tool input, is ever concatenated into a shell string.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readEvent, emit, silent, deny, context, guard, readState, writeState, clearState, isResourceLua, describeStack } from './lib.mjs';
import { findSecrets, redact } from './secrets.mjs';
import { audit } from '../scripts/fivem-audit.mjs';

/** Console signatures worth explaining, and the fix. Cheap regex guard before any real work. */
const CONSOLE_SIGNATURES = [
  {
    re: /Could not find dependency (\S+) for resource (\S+)/i,
    explain: (m) =>
      `${m[2]} declares a dependency on ${m[1]}, which is not started. Add \`ensure ${m[1]}\` to server.cfg BEFORE \`ensure ${m[2]}\` — load order is the order of the ensure lines.`,
  },
  {
    re: /attempt to index a nil value \(global '(lib|ESX|QBCore|exports)'\)/i,
    explain: (m) =>
      m[1] === 'lib'
        ? "ox_lib was never imported into this resource. Add `shared_scripts { '@ox_lib/init.lua' }` to fxmanifest.lua — the resource loads, but `lib` is nil until that import is declared."
        : `${m[1]} is nil here — the framework object is not available. Check that the framework resource starts before this one and that the import line is in fxmanifest.lua.`,
  },
  {
    re: /Failed to load script (\S+)/i,
    explain: (m) =>
      `${m[1]} is listed in fxmanifest.lua but did not load. Usually the path is wrong or the case does not match the file on disk — Linux hosts are case-sensitive, Windows is not, so this often only appears in production.`,
  },
  {
    re: /No such export (\S+) in resource (\S+)/i,
    explain: (m) =>
      `${m[2]} does not export ${m[1]}. Either the resource failed to start (check earlier in the console) or the export name changed — exports are registered at runtime, so a resource that errored during load exports nothing.`,
  },
  {
    re: /SCRIPT ERROR:.*\battempt to (call|index|compare)\b/i,
    explain: () =>
      'A runtime Lua error. The stack trace above names the resource and line. On the server side, check whether `source` is still in scope — it is nil after any yield unless captured first.',
  },
  {
    re: /\bcouldn'?t start resource (\S+)/i,
    explain: (m) =>
      `${m[1]} failed to start. Read the lines immediately above this one — the real cause is usually a manifest error or a missing dependency, and this line is only the consequence.`,
  },
];

const HANDLERS = {
  /** SessionStart — inject the detected stack so Claude never re-derives ox vs ESX. */
  'session-context'(event, config) {
    const lines = [
      `FiveM project detected. ${describeStack(config)}`,
      '',
      'Write code in this dialect. Do not mix framework idioms. Server-side handlers must',
      'validate every client-supplied value — a FiveM client is fully compromised.',
    ];
    if (config.dialect === 'qbcore') {
      lines.push('', 'QBCore note: `job.grade` is a TABLE. Comparing it to a number is a bug.');
    }
    context('SessionStart', lines.join('\n'));
  },

  /**
   * UserPromptSubmit — re-inject the stack exactly once after an in-session compaction.
   *
   * In-session compaction fires PostCompact only; SessionStart(compact) fires just for a
   * compaction that restarts the session. Neither compaction hook can inject context —
   * PreCompact can only block, PostCompact has no injection path — so PostCompact drops a
   * marker and this clears it. Bounded to one firing per compaction, not a per-prompt tax.
   */
  'prompt-context'(event, config) {
    if (!readState(event, 'compacted.json')) silent();
    clearState(event, 'compacted.json');
    context('UserPromptSubmit', `FiveM project (context restored after compaction). ${describeStack(config)}`);
  },

  /** PostCompact — mark that in-session compaction happened. */
  'post-compact'(event) {
    writeState(event, 'compacted.json', { at: event?.compaction_trigger ?? 'auto' });
    silent();
  },

  /** SubagentStart — brief each specialist so the dialect is not repeated in every prompt. */
  'subagent-brief'(event, config) {
    const type = String(event?.agent_type ?? '');
    if (!type.includes('fivem')) silent();
    context('SubagentStart', `Target stack — ${describeStack(config)}. Write and judge code in this dialect.`);
  },

  /**
   * PreToolUse — refuse a write that would commit a secret, or a broken fxmanifest.
   *
   * Preventing a leaked webhook beats reporting one after the fact, and a manifest missing
   * `fx_version` produces a resource that silently never starts.
   */
  'pre-write'(event, config) {
    const input = event?.tool_input ?? {};
    const file = input.file_path ?? input.filePath ?? '';
    const content = input.content ?? input.new_string ?? '';
    if (!file || !content) silent();

    if (config.redactSecrets) {
      const secrets = findSecrets(content, { blockingOnly: true });
      if (secrets.length) {
        const names = [...new Set(secrets.map((s) => s.name))].join(', ');
        deny(
          'PreToolUse',
          `This write contains what looks like a live credential (${names}). FiveM resources are ` +
            `frequently published or shared, and a committed secret is the most common way a server ` +
            `gets compromised. Put it in server.cfg with \`set\` (never \`setr\`, which replicates to ` +
            `every client) and read it with GetConvar on the server. If this is a placeholder, use an ` +
            `obviously fake value such as YOUR_KEY_HERE.`
        );
      }
    }

    if (path.basename(file).toLowerCase() === 'fxmanifest.lua') {
      const problems = [];
      if (!/\bfx_version\s/.test(content)) problems.push("`fx_version` is missing — the resource will not start");
      if (!/\bgame\s/.test(content)) problems.push("`game` is missing — the resource will not start");
      // Only the two hard failures block. A missing ox_lib import is a defect but the
      // resource still starts, so it belongs in /fivem:doctor, not in a refused write.
      if (problems.length) {
        deny('PreToolUse', `This fxmanifest is missing required directives: ${problems.join('; ')}.`);
      }
    }
    silent();
  },

  /**
   * PostToolUse (Edit|Write|MultiEdit) — lint the Lua that was just written.
   *
   * CRITICAL and HIGH only. A MEDIUM finding interrupting every write is how a linter gets
   * switched off, and the full report is one `/fivem:audit` away.
   */
  'post-write'(event, config) {
    if (!config.auditOnWrite) silent();
    const file = event?.tool_input?.file_path ?? event?.tool_input?.filePath ?? '';
    if (!isResourceLua(file) || !fs.existsSync(file)) silent();

    let result;
    try {
      // `root` matters: without it the single-file audit would key every finding off an
      // empty relative path, so unrelated files would collide. Keying off the server (or
      // project) directory also makes this key identical to the one /fivem:audit produces.
      result = audit(file, {
        minSeverity: 'high',
        includeFramework: true,
        root: config.serverPath ?? config.projectDir,
      });
    } catch {
      silent();
    }
    // Remember that Lua was written, so Stop can tell whether anything went unaudited.
    const written = readState(event, 'written.json', []);
    if (!written.includes(file)) written.push(file);
    writeState(event, 'written.json', written.slice(-200));

    if (!result.findings.length) silent();

    // Queue rather than report. When Claude writes six files at once this handler runs six
    // times, and six separate interruptions is how a linter gets switched off. PostToolBatch
    // drains the queue and reports once; `stop` is the backstop if it never does.
    const queued = readState(event, 'findings.json', []);
    const seen = new Set(queued.map((f) => f.key));
    for (const f of result.findings) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      queued.push({ key: f.key, rule: f.rule, severity: f.severity, line: f.line, file, message: f.message, fix: f.fix });
    }
    writeState(event, 'findings.json', queued.slice(-100));
    silent();
  },

  /**
   * PostToolBatch — report every finding from the batch exactly once.
   *
   * This is the noise fix. `post-write` audits and queues silently; this drains the queue
   * after the whole batch of parallel tool calls resolves, so a six-file write produces one
   * aggregated report instead of six interruptions.
   *
   * Verified against the runtime rather than the prose: the hook-output schema in the
   * Claude Code binary carries `{hookEventName: "PostToolBatch", additionalContext: string?}`.
   * The published decision-control table lists only top-level `decision` for this event,
   * which is what an earlier revision of this plugin wrongly took as the whole contract.
   */
  batch(event) {
    const queued = readState(event, 'findings.json', []);
    if (!queued.length) silent();
    clearState(event, 'findings.json');

    const byFile = new Map();
    for (const f of queued) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }

    const blocks = [];
    for (const [file, findings] of byFile) {
      const lines = findings
        .slice(0, 8)
        .map((f) => `  [${f.rule} · ${f.severity}] line ${f.line} — ${f.message}\n    fix: ${f.fix}`);
      blocks.push(`${path.basename(file)}\n${lines.join('\n')}`);
    }

    const critical = queued.filter((f) => f.severity === 'CRITICAL').length;
    const summary =
      `fivem audit — ${queued.length} finding(s) across ${byFile.size} file(s)` +
      (critical ? `, ${critical} CRITICAL` : '');
    context('PostToolBatch', `${summary}\n\n${blocks.slice(0, 12).join('\n\n')}`);
  },

  /** PostToolUse / PostToolUseFailure on Bash — explain a known FiveM console error. */
  console(event) {
    const blob = [
      event?.tool_response?.stdout,
      event?.tool_response?.stderr,
      typeof event?.tool_response === 'string' ? event.tool_response : '',
      event?.tool_error,
    ]
      .filter((s) => typeof s === 'string' && s)
      .join('\n')
      .slice(0, 20_000);
    if (!blob) silent();

    const seen = new Set();
    const explanations = [];
    for (const sig of CONSOLE_SIGNATURES) {
      const m = sig.re.exec(blob);
      if (!m || seen.has(sig.re.source)) continue;
      seen.add(sig.re.source);
      explanations.push(`• ${m[0].trim()}\n  ${sig.explain(m)}`);
    }
    if (!explanations.length) silent();

    context(
      event?.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse',
      `FiveM console errors recognised:\n\n${explanations.slice(0, 4).join('\n\n')}`
    );
  },

  /** Stop — the backstop, plus one nudge at the end of a turn that wrote a lot of Lua. */
  stop(event, config) {
    if (!config.remindOnStop) silent();
    const written = readState(event, 'written.json', []);
    clearState(event, 'written.json');

    // If PostToolBatch never drained the queue — a turn that ended on a tool result gets its
    // batch output discarded — the findings would otherwise vanish. Report them here.
    const undrained = readState(event, 'findings.json', []);
    clearState(event, 'findings.json');
    if (undrained.length) {
      const lines = undrained
        .slice(0, 10)
        .map((f) => `  [${f.rule} · ${f.severity}] ${path.basename(f.file)}:${f.line} — ${f.message}`);
      context('Stop', `fivem audit — ${undrained.length} unreported finding(s):\n${lines.join('\n')}`);
    }

    if (written.length < 3) silent(); // one or two clean files is not worth a nudge

    context(
      'Stop',
      `${written.length} Lua files were written this turn. Only CRITICAL and HIGH defects were ` +
        `checked at write time — run /fivem:audit for the rules that need a real read ` +
        `(client-supplied values, distance checks, atomicity).`
    );
  },

  /** CwdChanged / DirectoryAdded / FileChanged — the detected stack may no longer be true. */
  invalidate(event) {
    clearState(event, 'stack.json');
    silent();
  },

  /**
   * MessageDisplay — mask secrets on screen.
   *
   * `displayContent` replaces what is shown without touching the transcript or what Claude
   * sees, so this is purely shoulder-surfing and screen-share protection. A FiveM server.cfg
   * is full of credentials and gets pasted into chats constantly.
   */
  redact(event, config) {
    if (!config.redactSecrets) silent();
    const text = event?.message ?? event?.content ?? event?.text ?? '';
    if (typeof text !== 'string' || !text) silent();
    const { text: masked, count } = redact(text);
    if (!count) silent();
    emit({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: masked } });
  },

  /** Notification — a long parallel audit deserves a desktop ping when it finishes. */
  notify(event) {
    // Strip control characters: the message is interpolated into an escape sequence, so an
    // embedded BEL or ESC would terminate it early and leave junk on the terminal.
    const message = String(event?.message ?? 'fivem task finished')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .slice(0, 200);
    emit({ terminalSequence: '\u001B]777;notify;fivem;' + message + '\u0007' });
  },

  /** SessionEnd — persist what was audited so the next session knows what is already clean. */
  'session-end'(event, config) {
    const written = readState(event, 'written.json', []);
    if (!written.length) silent();
    try {
      const dir = path.join(config.projectDir, '.claude');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'fivem.state.json'),
        JSON.stringify({ lastSession: event?.session_id ?? null, writtenLua: written.slice(-200) }, null, 2)
      );
    } catch {
      /* best effort; SessionEnd output is ignored anyway */
    }
    silent();
  },

  /** Setup — pre-fetch the natives database so a headless run is not doing it mid-task. */
  async setup() {
    try {
      const natives = await import('../mcp/src/natives.mjs');
      await natives.loadNatives();
    } catch {
      /* offline is fine; everything else works without it */
    }
    silent();
  },
};

async function main() {
  const handlerName = process.argv[2];
  const handler = HANDLERS[handlerName];
  if (!handler) silent(); // an unknown handler must never break a turn

  const event = await readEvent();
  const config = guard(event);
  if (!config) silent(); // not a configured FiveM project — the common case

  try {
    await handler(event, config);
  } catch {
    silent(); // a crashing hook is worse than a missing one
  }
  silent();
}

main();
