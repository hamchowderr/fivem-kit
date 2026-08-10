#!/usr/bin/env node
/**
 * File audit findings into beads, idempotently.
 *
 * Findings are work, and work belongs in a tracker rather than in a chat message that scrolls
 * away. The part that makes or breaks this is idempotency: an audit that files 40 duplicates
 * on its second run gets switched off within a day.
 *
 * ## Identity
 *
 * Each finding maps to one issue, identified by a deterministic title prefix:
 *
 *   [SEC-5] server/shop.lua:41 — SQL built by string concatenation
 *   ^^^^^^^^^^^^^^^^^^^^^^^^^^ the key: rule + repo-relative path + line
 *
 * Title rather than `--external-ref` deliberately. `bd create` accepts `--external-ref`, but
 * it does not come back in `bd list --json`, and `bd list` has no filter for it — so it
 * cannot be used to answer "does this already exist?". The ref is still set, for humans and
 * other tools; identity runs on the title, which `bd list --json` is confirmed to return.
 *
 * ## Detect, do not require
 *
 * fivem-kit is a public product and most FiveM developers have never heard of beads. This
 * runs only when `bd` resolves AND a database answers. Otherwise it reports nothing filed
 * and the audit continues normally.
 *
 * Usage:
 *   node scripts/beads-sync.mjs <auditRoot> [--min-severity high] [--mode auto|on|off] [--dry-run] [--json]
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { audit } from './fivem-audit.mjs';

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const PRIORITY = { CRITICAL: '0', HIGH: '1', MEDIUM: '2', LOW: '3' };

/**
 * Run `bd` with an argv array — never a shell string.
 *
 * Finding text contains attacker-influenced source code. Interpolating that into a shell
 * command is exactly the injection this project spends its time auditing FiveM servers for;
 * doing it in our own tooling would be indefensible.
 */
function realExec(args) {
  const r = spawnSync('bd', args, { encoding: 'utf8', timeout: 60_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** Is beads usable here? Both the CLI and an initialised database are required. */
export function beadsAvailable(exec = realExec) {
  const probe = exec(['list', '--limit', '1', '--json']);
  if (probe.error || probe.status !== 0) return false;
  try {
    JSON.parse(probe.stdout);
    return true;
  } catch {
    return false; // bd answered, but not with a usable database
  }
}

/** The stable identity of a finding: `[RULE] relative/path.lua:LINE`. */
export function findingKey(finding, root) {
  let rel = path.relative(root, finding.file).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) rel = path.basename(finding.file);
  return `[${finding.rule}] ${rel}:${finding.line}`;
}

export function titleFor(finding, root) {
  return `${findingKey(finding, root)} — ${finding.title}`;
}

/** Everything a person needs to judge and fix the finding, without re-running the audit. */
export function descriptionFor(finding, root) {
  const rel = path.relative(root, finding.file).split(path.sep).join('/') || path.basename(finding.file);
  return [
    `**${finding.severity}** · ${finding.rule} · \`${rel}:${finding.line}\``,
    '',
    '## The defect',
    finding.message,
    '',
    '## Offending line',
    '```lua',
    String(finding.code ?? '').trim(),
    '```',
    '',
    '## Fix',
    finding.fix,
    '',
    '---',
    'Filed by `/fivem:audit`. Re-running the audit updates this issue rather than filing a',
    'duplicate, and closes it once the finding is gone.',
  ].join('\n');
}

/** Issues previously filed for paths under this audit, keyed by their `[RULE] path:line`. */
function existingIssues(exec) {
  const r = exec(['list', '--all', '--json', '--limit', '0']);
  if (r.status !== 0) return new Map();
  let list;
  try {
    list = JSON.parse(r.stdout);
  } catch {
    return new Map();
  }
  const map = new Map();
  for (const issue of Array.isArray(list) ? list : []) {
    const m = /^(\[[A-Z]+-\d+\] [^\s]+:\d+)/.exec(issue.title ?? '');
    if (m) map.set(m[1], issue);
  }
  return map;
}

/**
 * File, update and close issues so the tracker matches the current audit.
 *
 * @returns {{filed: object[], updated: object[], closed: object[], skipped: number, ran: boolean, reason?: string}}
 */
export function syncFindings({
  findings,
  root,
  mode = 'auto',
  minSeverity = 'high',
  dryRun = false,
  exec = realExec,
} = {}) {
  const result = { filed: [], updated: [], closed: [], skipped: 0, ran: false };

  if (mode === 'off') return { ...result, reason: 'beads is set to off for this project' };
  if (!beadsAvailable(exec)) {
    if (mode === 'on') return { ...result, reason: 'beads is set to on but no database answered' };
    return { ...result, reason: 'no beads database here — findings reported, nothing filed' };
  }
  result.ran = true;

  const threshold = SEVERITY_ORDER[String(minSeverity).toUpperCase()] ?? SEVERITY_ORDER.HIGH;
  const fileable = findings.filter((f) => SEVERITY_ORDER[f.severity] <= threshold);
  result.skipped = findings.length - fileable.length;

  const existing = existingIssues(exec);
  const seen = new Set();

  for (const finding of fileable) {
    const key = findingKey(finding, root);
    seen.add(key);
    const already = existing.get(key);

    if (already) {
      // Still present. Nothing to change — re-describing it every run would churn the
      // issue's updated_at and bury real activity.
      if (already.status === 'closed') {
        if (!dryRun) exec(['update', already.id, '--status', 'open']);
        result.updated.push({ id: already.id, key, action: 'reopened' });
      }
      continue;
    }

    if (dryRun) {
      result.filed.push({ id: '(dry-run)', key });
      continue;
    }

    const args = [
      'create',
      `--title=${titleFor(finding, root)}`,
      `--description=${descriptionFor(finding, root)}`,
      '--type=bug',
      `--priority=${PRIORITY[finding.severity] ?? '2'}`,
      `--external-ref=fivem:${key}`,
    ];
    const r = exec(args);
    const id = /([a-z0-9-]+-[a-z0-9]+)/i.exec(r.stdout ?? '')?.[1] ?? null;
    if (r.status === 0) result.filed.push({ id, key });
  }

  // Anything we filed before, for a file inside this audit, that no longer appears is fixed.
  // Bounded to the audited scope: auditing one resource must not close another's issues.
  const auditedFiles = new Set(
    findings.map((f) => path.relative(root, f.file).split(path.sep).join('/'))
  );
  for (const [key, issue] of existing) {
    if (seen.has(key) || issue.status === 'closed') continue;
    const file = /^\[[A-Z]+-\d+\] ([^\s]+):\d+$/.exec(key)?.[1];
    if (!file || !auditedFiles.has(file)) continue; // outside this audit — leave alone
    if (!dryRun) exec(['close', issue.id, '--reason=No longer reported by /fivem:audit — fixed.']);
    result.closed.push({ id: issue.id, key });
  }

  return result;
}

function flagValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const flagged = new Set(['--min-severity', '--mode']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !flagged.has(argv[i - 1]));
  const target = positional[0] ?? process.cwd();

  const scan = audit(target, { minSeverity: 'low' });
  const result = syncFindings({
    findings: scan.findings,
    root: scan.root,
    mode: flagValue(argv, '--mode', 'auto'),
    minSeverity: flagValue(argv, '--min-severity', 'high'),
    dryRun: argv.includes('--dry-run'),
  });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ran) {
    console.log(result.reason);
    return;
  }
  console.log(
    `beads: ${result.filed.length} filed, ${result.updated.length} reopened, ` +
      `${result.closed.length} closed, ${result.skipped} below the severity threshold`
  );
  for (const f of result.filed) console.log(`  + ${f.id ?? '?'}  ${f.key}`);
  for (const u of result.updated) console.log(`  ^ ${u.id}  ${u.key}`);
  for (const c of result.closed) console.log(`  - ${c.id}  ${c.key}  (fixed)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
