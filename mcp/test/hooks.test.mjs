/**
 * Hook tests — every handler is invoked the way Claude Code invokes it: a real child process
 * with the event JSON on stdin, asserting the exit code and the stdout contract.
 *
 * Two properties matter more than any individual handler:
 *
 *   1. **Silence when unconfigured.** These fire on every session, write and prompt. In a
 *      project that has nothing to do with FiveM they must print nothing and exit 0.
 *   2. **Never a crash.** Malformed stdin, a missing file, a hostile config — all exit 0.
 *      A hook that throws interrupts work that has nothing to do with this plugin.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findSecrets, redact, mask } from '../../hooks/secrets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, 'hooks', 'fivem-hook.mjs');

/** A project directory with a valid, enabled fivem config pointing at a real server. */
function configuredProject({ dialect = 'ox', extra = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-hooktest-'));
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'fivem.local.md'),
    `---\nenabled: true\ndialect: ${dialect}\nserver_path: '${dir.replace(/\\/g, '/')}'\n${extra}---\n`
  );
  return dir;
}

function bareProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fivem-bare-'));
}

/** Run a handler exactly as the hook runner does. */
function run(handler, event, { raw } = {}) {
  const r = spawnSync(process.execPath, [HOOK, handler], {
    input: raw ?? JSON.stringify(event ?? {}),
    encoding: 'utf8',
    timeout: 30_000,
  });
  let json = null;
  if (r.stdout && r.stdout.trim()) {
    try {
      json = JSON.parse(r.stdout);
    } catch {
      json = 'UNPARSEABLE';
    }
  }
  return { status: r.status, stdout: r.stdout ?? '', json };
}

const HANDLERS = [
  'session-context',
  'prompt-context',
  'post-compact',
  'subagent-brief',
  'pre-write',
  'post-write',
  'batch',
  'console',
  'stop',
  'invalidate',
  'redact',
  'notify',
  'session-end',
];

describe('every hook is silent and harmless in a non-FiveM project', () => {
  const cwd = bareProject();
  for (const handler of HANDLERS) {
    test(`${handler} exits 0 with no output`, () => {
      const r = run(handler, { cwd, session_id: 'test', tool_input: { file_path: 'x.lua', content: 'x' } });
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), '', 'an unrelated repo must not pay for this plugin');
    });
  }
});

describe('every hook survives malformed input', () => {
  for (const handler of HANDLERS) {
    test(`${handler} exits 0 on garbage stdin`, () => {
      const r = run(handler, null, { raw: 'not json at all {{{' });
      assert.equal(r.status, 0);
    });
  }

  test('an unknown handler name exits 0 rather than failing the turn', () => {
    const r = run('no-such-handler', { cwd: configuredProject() });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('a hostile config does not activate anything', () => {
    const dir = bareProject();
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'fivem.local.md'),
      `---\nenabled: true\nserver_path: "/tmp/x; rm -rf /"\ndialect: evil\n---\n`
    );
    const r = run('session-context', { cwd: dir, session_id: 't' });
    assert.equal(r.status, 0);
    // The file parses and is enabled, so context may be injected — but never the bad values.
    assert.ok(!r.stdout.includes('rm -rf'), 'an injected value must never reach output');
    assert.ok(!r.stdout.includes('evil'));
  });
});

describe('session context injection', () => {
  test('injects the detected dialect', () => {
    const cwd = configuredProject({ dialect: 'qbcore' });
    const r = run('session-context', { cwd, session_id: 't', source: 'startup' });
    assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(r.json.hookSpecificOutput.additionalContext, /qbcore/);
    assert.match(r.json.hookSpecificOutput.additionalContext, /job\.grade` is a TABLE/);
  });

  test('the QBCore warning is absent for an ox server', () => {
    const r = run('session-context', { cwd: configuredProject(), session_id: 't' });
    assert.ok(!r.json.hookSpecificOutput.additionalContext.includes('TABLE'));
  });

  test('enabled: false stands everything down', () => {
    const dir = bareProject();
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'fivem.local.md'), '---\nenabled: false\ndialect: ox\n---\n');
    assert.equal(run('session-context', { cwd: dir, session_id: 't' }).stdout.trim(), '');
  });
});

describe('the compaction marker fires exactly once', () => {
  test('post-compact sets it, the next prompt consumes it, the one after is silent', () => {
    const cwd = configuredProject();
    const event = { cwd, session_id: 'compaction-test' };

    assert.equal(run('prompt-context', event).stdout.trim(), '', 'no marker yet');

    run('post-compact', { ...event, compaction_trigger: 'auto' });

    const restored = run('prompt-context', event);
    assert.equal(restored.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(restored.json.hookSpecificOutput.additionalContext, /after compaction/);

    assert.equal(run('prompt-context', event).stdout.trim(), '', 'must not repeat every prompt');
  });
});

describe('pre-write blocks what should never land', () => {
  const cwd = configuredProject();

  test('denies a write containing a Discord webhook', () => {
    const r = run('pre-write', {
      cwd,
      session_id: 't',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(cwd, 'resources', 'x', 'client.lua'),
        content: `local hook = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-jkl'`,
      },
    });
    assert.equal(r.status, 0, 'deny goes through stdout on exit 0, never exit 2');
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /credential/i);
  });

  test('allows an obvious placeholder', () => {
    const r = run('pre-write', {
      cwd,
      session_id: 't',
      tool_input: {
        file_path: path.join(cwd, 'x.lua'),
        content: `local key = 'YOUR_KEY_HERE'\nlocal url = 'https://discord.com/api/webhooks/000000/YOUR_WEBHOOK_HERE'`,
      },
    });
    assert.equal(r.stdout.trim(), '', 'refusing a template is worse than useless');
  });

  test('denies an fxmanifest with no fx_version', () => {
    const r = run('pre-write', {
      cwd,
      session_id: 't',
      tool_input: {
        file_path: path.join(cwd, 'resources', 'x', 'fxmanifest.lua'),
        content: `game 'gta5'\nclient_script 'client.lua'`,
      },
    });
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /fx_version/);
  });

  test('allows a valid fxmanifest', () => {
    const r = run('pre-write', {
      cwd,
      session_id: 't',
      tool_input: {
        file_path: path.join(cwd, 'resources', 'x', 'fxmanifest.lua'),
        content: `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'`,
      },
    });
    assert.equal(r.stdout.trim(), '');
  });
});

/** Write a Lua file with a planted SEC-5 and return its path. */
function vulnerableFile(cwd, name) {
  const file = path.join(cwd, 'resources', 'myshop', 'server', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `MySQL.query('SELECT * FROM users WHERE n = "' .. name .. '"')\n`);
  return file;
}

describe('post-write queues rather than interrupting', () => {
  test('a single write produces no output of its own', () => {
    const cwd = configuredProject();
    const file = vulnerableFile(cwd, 'main.lua');
    const r = run('post-write', {
      cwd,
      session_id: 'queue-1',
      tool_name: 'Write',
      tool_input: { file_path: file },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', 'the batch hook reports; per-file output is the noise we removed');
  });

  test('says nothing about a clean file', () => {
    const cwd = configuredProject();
    const file = path.join(cwd, 'resources', 'myshop', 'server', 'ok.lua');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `local function add(a, b) return a + b end\n`);
    assert.equal(run('post-write', { cwd, session_id: 't', tool_input: { file_path: file } }).stdout.trim(), '');
  });

  test('audit_on_write: false switches it off', () => {
    const cwd = configuredProject({ extra: 'audit_on_write: false\n' });
    const file = path.join(cwd, 'resources', 'myshop', 'server', 'bad.lua');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `MySQL.query('SELECT * FROM u WHERE n = "' .. n .. '"')\n`);
    assert.equal(run('post-write', { cwd, session_id: 't', tool_input: { file_path: file } }).stdout.trim(), '');
  });

  test('a file that no longer exists is not an error', () => {
    const cwd = configuredProject();
    const r = run('post-write', {
      cwd,
      session_id: 't',
      tool_input: { file_path: path.join(cwd, 'gone.lua') },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });
});

describe('PostToolBatch reports the whole batch exactly once', () => {
  test('six writes produce one aggregated report, not six interruptions', () => {
    const cwd = configuredProject();
    const session_id = 'batch-agg';
    const files = ['a.lua', 'b.lua', 'c.lua', 'd.lua', 'e.lua', 'f.lua'].map((n) => vulnerableFile(cwd, n));

    for (const file of files) {
      const r = run('post-write', { cwd, session_id, tool_name: 'Write', tool_input: { file_path: file } });
      assert.equal(r.stdout.trim(), '', 'each write must stay silent');
    }

    const batch = run('batch', { cwd, session_id, tool_calls: files.map((f) => ({ tool_name: 'Write' })) });
    assert.equal(batch.json.hookSpecificOutput.hookEventName, 'PostToolBatch');
    const ctx = batch.json.hookSpecificOutput.additionalContext;
    assert.match(ctx, /6 finding\(s\) across 6 file\(s\)/);
    assert.match(ctx, /6 CRITICAL/);
    for (const f of files) assert.ok(ctx.includes(path.basename(f)), `${path.basename(f)} must appear`);
  });

  test('the queue is drained, so a second batch is silent', () => {
    const cwd = configuredProject();
    const session_id = 'batch-drain';
    run('post-write', { cwd, session_id, tool_input: { file_path: vulnerableFile(cwd, 'x.lua') } });

    assert.ok(run('batch', { cwd, session_id }).json, 'first batch reports');
    assert.equal(run('batch', { cwd, session_id }).stdout.trim(), '', 'second batch has nothing left');
  });

  test('a batch with no queued findings says nothing', () => {
    assert.equal(run('batch', { cwd: configuredProject(), session_id: 'empty' }).stdout.trim(), '');
  });

  test('the same finding written twice is reported once', () => {
    const cwd = configuredProject();
    const session_id = 'batch-dedupe';
    const file = vulnerableFile(cwd, 'dupe.lua');
    run('post-write', { cwd, session_id, tool_input: { file_path: file } });
    run('post-write', { cwd, session_id, tool_input: { file_path: file } });

    const ctx = run('batch', { cwd, session_id }).json.hookSpecificOutput.additionalContext;
    assert.match(ctx, /1 finding\(s\) across 1 file\(s\)/);
  });

  test('Stop is the backstop when the batch hook never drains', () => {
    const cwd = configuredProject();
    const session_id = 'batch-backstop';
    run('post-write', { cwd, session_id, tool_input: { file_path: vulnerableFile(cwd, 'orphan.lua') } });

    // No `batch` call — the turn ended on a tool result and the batch output was discarded.
    const stop = run('stop', { cwd, session_id });
    assert.match(stop.json.hookSpecificOutput.additionalContext, /unreported finding/);
    assert.match(stop.json.hookSpecificOutput.additionalContext, /SEC-5/);
  });
});

describe('console error explanation', () => {
  const cwd = configuredProject();

  test('explains a missing dependency', () => {
    const r = run('console', {
      cwd,
      session_id: 't',
      tool_name: 'Bash',
      tool_response: { stdout: "Could not find dependency ox_lib for resource myshop\n" },
    });
    assert.match(r.json.hookSpecificOutput.additionalContext, /ensure ox_lib/);
  });

  test("explains the nil 'lib' global", () => {
    const r = run('console', {
      cwd,
      session_id: 't',
      tool_response: { stderr: "SCRIPT ERROR: @myshop/client.lua:3: attempt to index a nil value (global 'lib')" },
    });
    assert.match(r.json.hookSpecificOutput.additionalContext, /@ox_lib\/init\.lua/);
  });

  test('says nothing about unrelated output', () => {
    const r = run('console', { cwd, session_id: 't', tool_response: { stdout: 'npm install finished\n' } });
    assert.equal(r.stdout.trim(), '');
  });
});

describe('secret detection and redaction', () => {
  test('finds real credentials', () => {
    const hits = findSecrets(
      `set mysql_connection_string "mysql://root:hunter2@localhost/es_extended"\n` +
        `https://discord.com/api/webhooks/123456789012345678/abcDEFghi_jkl-mno`
    );
    assert.ok(hits.length >= 2);
  });

  test('ignores placeholders', () => {
    assert.deepEqual(findSecrets(`api_key = "YOUR_API_KEY_HERE_XXXXXXXXXXXXX"`), []);
    assert.deepEqual(findSecrets(`mysql://user:CHANGEME@example.com/db`), []);
  });

  test('a suggestive variable name alone is not a secret', () => {
    assert.deepEqual(findSecrets(`local token = playerToken\nlocal password = args[1]`), []);
  });

  test('a documentation connection string is not a secret', () => {
    // Found by running this scanner over our own repo: these lines are in
    // skills/fivem-server-ops. The MySQL pattern is on the BLOCKING path, so treating them
    // as real would make the plugin refuse to write its own documentation.
    for (const doc of [
      `set mysql_connection_string "mysql://user:pass@localhost/db?charset=utf8mb4"`,
      `mysql://username:password@127.0.0.1:3306/es_extended`,
      `mysql://root:CHANGEME@localhost/qbcore`,
    ]) {
      assert.deepEqual(findSecrets(doc), [], `must not flag: ${doc}`);
    }
  });

  test('a real-looking password in a connection string still IS a secret', () => {
    assert.equal(findSecrets(`mysql://root:hunter2@localhost/es_extended`).length, 1);
    assert.equal(findSecrets(`mysql://svc:Xk9zQm2Lp0@db.internal/prod`).length, 1);
  });

  test('redaction masks the value but keeps the text readable', () => {
    const src = `set rcon_password SuperSecret123\nother line`;
    const { text, count } = redact(src);
    assert.ok(count >= 1);
    assert.ok(!text.includes('SuperSecret123'));
    assert.ok(text.includes('other line'));
  });

  test('mask never reveals more than six characters', () => {
    assert.ok(!mask('abcdefghijklmnop').includes('g'));
    assert.equal(mask('short'), '••••••••');
  });

  test('the MessageDisplay hook returns displayContent, not a transcript edit', () => {
    const cwd = configuredProject();
    const r = run('redact', {
      cwd,
      session_id: 't',
      message: 'your cfg has set mysql_connection_string "mysql://root:hunter2@localhost/db" in it',
    });
    assert.equal(r.json.hookSpecificOutput.hookEventName, 'MessageDisplay');
    assert.ok(!r.json.hookSpecificOutput.displayContent.includes('hunter2'));
  });

  test('MessageDisplay is silent when there is nothing to mask', () => {
    const r = run('redact', { cwd: configuredProject(), session_id: 't', message: 'all clear' });
    assert.equal(r.stdout.trim(), '');
  });
});

describe('subagent briefing', () => {
  const cwd = configuredProject({ dialect: 'esx' });

  test('briefs a fivem specialist', () => {
    const r = run('subagent-brief', { cwd, session_id: 't', agent_type: 'fivem:fivem-security-auditor' });
    assert.match(r.json.hookSpecificOutput.additionalContext, /esx/);
  });

  test('says nothing to an unrelated subagent', () => {
    const r = run('subagent-brief', { cwd, session_id: 't', agent_type: 'Explore' });
    assert.equal(r.stdout.trim(), '');
  });
});

describe('the notification escape sequence is well formed', () => {
  test('wraps the message in OSC 777 and strips control characters', () => {
    const r = run('notify', {
      cwd: configuredProject(),
      session_id: 't',
      message: 'audit finished\u0007; rm -rf /',
      notification_type: 'agent_completed',
    });
    const seq = r.json.terminalSequence;
    assert.ok(seq.startsWith('\u001B]777;notify;fivem;'), 'must open with OSC 777');
    assert.ok(seq.endsWith('\u0007'), 'must terminate with BEL');
    assert.equal(seq.slice(0, -1).includes('\u0007'), false, 'an embedded BEL would end it early');
  });
});
