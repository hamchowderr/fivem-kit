/**
 * Deterministic static checks for FiveM Lua.
 *
 * Only rules that can be decided from the text alone live here. Rules that need
 * semantic judgement (is this parameter validated? is there a distance check?) are
 * deliberately NOT regex-matched — they produce too many false positives, and a report
 * full of noise buries the real finding. Those are returned as review prompts instead.
 *
 * Full rule descriptions: skills/fivem-security/SKILL.md
 */

/** Strip Lua comments and string literals so patterns don't match inside them. */
function stripNoise(src) {
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\[(=*)\[[\s\S]*?\]\1\]/g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineOf(src, index) {
  return src.slice(0, index).split(/\r?\n/).length;
}

function lineText(src, line) {
  return (src.split(/\r?\n/)[line - 1] ?? '').trim();
}

/**
 * Extract a balanced {...} starting at or after `from`.
 * A non-greedy regex stops at the first `}`, which truncates any config table
 * containing a nested table — the cause of false "no permission gate" hits.
 */
function balancedBraces(text, from) {
  const start = text.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return text.slice(start + 1);
}

/**
 * Extract a Lua block body starting after `from`, tracking block depth so the scan
 * ends at the block's real `end` rather than an inner one.
 * Openers counted: if / do / function (each pairs with exactly one `end`).
 * `elseif` and `then` are deliberately not counted — they add no extra `end`.
 */
function luaBlock(text, from, maxChars = 6000) {
  const slice = text.slice(from, from + maxChars);
  const re = /\b(if|do|function|end)\b/g;
  let depth = 1;
  let m;
  while ((m = re.exec(slice))) {
    if (m[1] === 'end') {
      depth--;
      if (depth === 0) return slice.slice(0, m.index);
    } else depth++;
  }
  return slice;
}

/**
 * Which side does this file run on? Several rules only make sense server-side —
 * a client-side RegisterCommand has no ACE implication, for instance.
 */
export function detectSide(clean, filename = '') {
  const f = filename.toLowerCase().replace(/\\/g, '/');
  if (/(^|\/)s(erver)?[./]|_server|server\.lua$/.test(f)) return 'server';
  if (/(^|\/)c(lient)?[./]|_client|client\.lua$/.test(f)) return 'client';

  const serverMarkers =
    /\bTriggerClientEvent\b|\bGetPlayerIdentifiers?\b|\bGetPlayerName\b|\bDropPlayer\b|\bMySQL\.|\bPerformHttpRequest\b|\bIsPlayerAceAllowed\b/;
  const clientMarkers =
    /\bTriggerServerEvent\b|\bPlayerPedId\b|\bRegisterNUICallback\b|\bSendNUIMessage\b|\bDrawMarker\b|\bRegisterKeyMapping\b|\bcache\.ped\b/;

  const s = serverMarkers.test(clean);
  const c = clientMarkers.test(clean);
  if (s && !c) return 'server';
  if (c && !s) return 'client';
  return 'unknown';
}

/** Patterns that count as a genuine permission gate on a command. */
const PERMISSION_CHECK =
  /IsPlayerAceAllowed|restricted|HasPermission|hasPermission|isAdmin|IsPlayerAdmin|source\s*[~=]=\s*0|src\s*[~=]=\s*0/i;

const RULES = [
  {
    id: 'SEC-5',
    severity: 'CRITICAL',
    title: 'SQL built by string concatenation',
    // a MySQL/oxmysql call whose query argument uses .. or :format
    test: (clean) => {
      const out = [];
      const re = /(MySQL\.[\w.]+|exports\.oxmysql:\w+|exports\['oxmysql'\]:\w+)\s*\(\s*([^)]*)/g;
      let m;
      while ((m = re.exec(clean))) {
        const args = m[2];
        if (/\.\.|:format\s*\(|%s|%d/.test(args)) out.push({ index: m.index });
      }
      return out;
    },
    message: 'The query string is assembled from values instead of using ? placeholders.',
    fix: "Use parameters: MySQL.single.await('SELECT ... WHERE x = ?', { x }).",
  },
  {
    id: 'SEC-10',
    severity: 'CRITICAL',
    title: 'Dynamic code execution',
    // negative lookbehind so lib.load(), self:load(), myLoad() etc. do not match
    test: (clean) => matchAll(clean, /(?<![.:\w])(?:loadstring|load)\s*\(/g),
    message: 'load/loadstring evaluates arbitrary code. If any part comes from a client, this is remote code execution.',
    fix: 'Remove it. Allow-list behaviour instead of evaluating strings.',
  },
  {
    id: 'SEC-7',
    severity: 'HIGH',
    title: 'Command registered with no permission gate',
    serverOnly: true,
    test: (clean) => {
      const out = [];
      // lib.addCommand — read the whole config table, nested tables included
      const re = /lib\.addCommand\s*\(\s*(['"])(.+?)\1\s*,/g;
      let m;
      while ((m = re.exec(clean))) {
        const cfg = balancedBraces(clean, m.index + m[0].length);
        if (cfg === null) continue;
        if (!/restricted\s*=/.test(cfg) || /restricted\s*=\s*false\b/.test(cfg)) {
          out.push({ index: m.index, extra: m[2] });
        }
      }
      // raw RegisterCommand — scan the real handler body for a permission check
      const re2 = /RegisterCommand\s*\(\s*(['"])(.+?)\1\s*,/g;
      while ((m = re2.exec(clean))) {
        const body = luaBlock(clean, m.index + m[0].length, 2000);
        if (!PERMISSION_CHECK.test(body)) {
          out.push({ index: m.index, extra: m[2] });
        }
      }
      return out;
    },
    message: 'Anyone can run this command.',
    fix: "Add restricted = 'group.admin' to lib.addCommand, or an IsPlayerAceAllowed check.",
  },
  {
    id: 'SEC-12',
    severity: 'MEDIUM',
    title: 'Sensitive data broadcast to every player',
    serverOnly: true,
    // A broadcast is only worth flagging when the payload looks sensitive. Broadcasting
    // a UI event to everyone is normal and flagging it buries the real findings.
    test: (clean) => {
      const out = [];
      const re = /TriggerClientEvent\s*\(\s*[^,]+,\s*-1\s*,([^\n]*)/g;
      const sensitive =
        /identifier|licen[cs]e|steam|discord|token|balance|money|cash|bank|account|coord|position|password|admin|permission|coords/i;
      let m;
      while ((m = re.exec(clean))) {
        if (sensitive.test(m[1])) out.push({ index: m.index });
      }
      return out;
    },
    message: 'TriggerClientEvent(..., -1, ...) sends to every player, and the payload looks sensitive.',
    fix: 'Send only to the players who need it. Never broadcast identifiers, balances or positions.',
  },
  {
    id: 'SEC-3',
    severity: 'HIGH',
    title: '`source` used after a yield',
    test: (clean) => {
      const out = [];
      const re = /(RegisterNetEvent|AddEventHandler)\s*\(([\s\S]{0,1500}?)\n\s*end\s*\)/g;
      let m;
      while ((m = re.exec(clean))) {
        const body = m[2];
        const yieldIdx = body.search(/\.await\s*\(|Citizen\.Wait\s*\(|\bWait\s*\(/);
        if (yieldIdx === -1) continue;
        const after = body.slice(yieldIdx);
        // `source` used after the yield, and not captured into a local beforehand
        if (/\bsource\b/.test(after) && !/local\s+\w+\s*=\s*source/.test(body.slice(0, yieldIdx))) {
          out.push({ index: m.index + yieldIdx });
        }
      }
      return out;
    },
    message: '`source` is only reliable at handler entry; after a yield it may be another player or nil.',
    fix: 'Capture `local src = source` as the first line and use `src` throughout.',
  },
  {
    id: 'PERF-1',
    severity: 'HIGH',
    title: 'Infinite loop with no Wait',
    test: (clean) => {
      const out = [];
      const re = /while\s+true\s+do\b/g;
      let m;
      while ((m = re.exec(clean))) {
        // scan the real loop body, not up to the first inner `end`
        const body = luaBlock(clean, m.index + m[0].length);
        if (!/\bWait\s*\(|Citizen\.Wait\s*\(/.test(body)) out.push({ index: m.index });
      }
      return out;
    },
    message: "`while true do` without a Wait freezes the player's game.",
    fix: 'Add Wait(0) for per-frame work, or a real interval for anything else.',
  },
  {
    id: 'COMPAT-2',
    severity: 'MEDIUM',
    title: 'Legacy MySQL API',
    test: (clean) => matchAll(clean, /MySQL\.(Async|Sync)\.\w+|exports\.ghmattimysql|exports\['ghmattimysql'\]/g),
    message: 'mysql-async / ghmattimysql are deprecated.',
    fix: 'Migrate to oxmysql: MySQL.query.await / single.await / scalar.await / insert.await / update.await.',
  },
  {
    id: 'SEC-8',
    severity: 'CRITICAL',
    title: 'Possible secret in source',
    test: (clean) => {
      const out = [];
      const pats = [
        /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[\w/-]+/g,
        /\bsk-[A-Za-z0-9]{16,}/g,
        /\b(?:api[_-]?key|apikey|secret|password|token)\s*=\s*['"][^'"]{12,}['"]/gi,
        /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/g,
      ];
      for (const p of pats) out.push(...matchAll(clean, p));
      return out;
    },
    message: 'A credential appears in the source. If this file is in client_scripts or shared_scripts it is shipped to every player.',
    fix: 'Move to a server script and read it from a convar: GetConvar("my_key", "").',
  },
];

function matchAll(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    out.push({ index: m.index });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/**
 * Run the deterministic rules over one Lua source file.
 * @param {string} source raw file contents
 * @param {string} [filename] for reporting
 */
export function auditLua(source, filename = 'input.lua') {
  const clean = stripNoise(source);
  const side = detectSide(clean, filename);
  const findings = [];

  for (const rule of RULES) {
    // server-only rules don't apply to client scripts (a client RegisterCommand
    // has no ACE implication, and a client cannot broadcast)
    if (rule.serverOnly && side === 'client') continue;
    for (const hit of rule.test(clean)) {
      const line = lineOf(clean, hit.index);
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        title: rule.title,
        file: filename,
        line,
        code: lineText(source, line),
        message: rule.message,
        fix: rule.fix,
      });
    }
  }

  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);

  // Deduplicate identical rule+line pairs.
  const seen = new Set();
  const deduped = findings.filter((f) => {
    const k = `${f.rule}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    file: filename,
    side,
    findings: deduped,
    reviewRequired: reviewPrompts(clean),
  };
}

/**
 * Rules that cannot be decided mechanically. Surfaced as targeted questions about the
 * specific entry points found, rather than guessed at.
 */
function reviewPrompts(clean) {
  const prompts = [];
  const handlers = [
    ...matchAll(clean, /RegisterNetEvent\s*\(\s*['"]([^'"]+)['"]/g),
    ...matchAll(clean, /lib\.callback\.register\s*\(\s*['"]([^'"]+)['"]/g),
    ...matchAll(clean, /RegisterNUICallback\s*\(\s*['"]([^'"]+)['"]/g),
  ];
  if (handlers.length) {
    prompts.push({
      rules: ['SEC-1', 'SEC-2', 'SEC-4', 'SEC-9'],
      note: `${handlers.length} client-triggerable entry point(s) found. For each, confirm server-side: every parameter validated against server config (SEC-1), price/amount never taken from the client (SEC-2), a distance check where the action is location-bound (SEC-4), and job/item permission re-checked rather than trusted from the UI (SEC-9).`,
    });
  }
  if (/getAccount|withdraw|deposit|AddMoney|RemoveMoney|addMoney|removeMoney/.test(clean)) {
    prompts.push({
      rules: ['SEC-6'],
      note: 'Money operations found. Confirm the balance check and the deduction are atomic (a single conditional UPDATE), and that items are added before payment is taken.',
    });
  }
  return prompts;
}

export const RULE_IDS = RULES.map((r) => ({ id: r.id, severity: r.severity, title: r.title }));
