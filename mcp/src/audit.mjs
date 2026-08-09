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

/** Blank a match, preserving length and newlines so line numbers stay correct. */
const blank = (m) => m.replace(/[^\n]/g, ' ');

/**
 * Remove comments (long `--[[ ]]` first, then line comments) and long-bracket strings.
 * Quoted string CONTENT is kept — some rules need it.
 */
function stripComments(src) {
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, blank)
    .replace(/--[^\n]*/g, blank)
    .replace(/\[(=*)\[[\s\S]*?\]\1\]/g, blank);
}

/**
 * Blank the inside of quoted strings, keeping the quotes themselves.
 *
 * Without this, prose that merely mentions an API — an error message, a doc comment
 * assigned to a variable, a locale entry — matches the code rules. Escaped quotes are
 * honoured so `"he said \"hi\""` does not end early.
 */
function blankStringContents(src) {
  return src.replace(/(['"])((?:\\.|[^\\\n])*?)\1/g, (m, q, body) => q + blank(body) + q);
}

/** Code-structure view: no comments, no string contents. */
function stripNoise(src) {
  return blankStringContents(stripComments(src));
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

/**
 * Does this handler actually do something worth protecting?
 *
 * An unrestricted command is only a vulnerability if it grants value or control.
 * qbx_core's `/job` prints the caller's own job and needs no gate; flagging it buries
 * the real finding, which is the point of the whole ruleset.
 */
/**
 * Calls that grant value or change privileged state.
 *
 * Matched case-insensitively, but note that alternation is literal: `AddMoney` does NOT
 * match ESX's `addAccountMoney`, and `AddItem` does NOT match `addInventoryItem`. Those
 * spellings are the ESX Legacy API and appear in the hundreds across real addon
 * collections, so each family is spelled out rather than assumed.
 */
const PRIVILEGED_ACTION =
  /SetMoney|AddMoney|RemoveMoney|(?:add|remove|set)AccountMoney|:deposit|:withdraw|AddItem|RemoveItem|(?:add|remove)InventoryItem|SetJob|setJob|(?:Add|Remove)Player(?:To|From)Job|SetGang|setGroup|set\s*\(\s*['"]job|SetMetaData|SetEntityCoords|setCoords|DropPlayer|:kick|\bban\b|SpawnVehicle|CreateVehicle|AddPermission|RemovePermission|SetPlayerBucket|giveWeapon|GiveWeapon|(?:add|remove)Weapon\b|SetSlotCount|SetMaxWeight|MySQL\.(update|insert|query)|RegisterStash|ConfiscateInventory/i;

const RULES = [
  {
    id: 'SEC-5',
    severity: 'CRITICAL',
    title: 'SQL built by string concatenation',
    // needs the query text intact: the `?` placeholders live inside the string literal
    needsStrings: true,
    // a MySQL/oxmysql call whose query argument uses .. or :format
    test: (clean) => {
      const out = [];
      const re = /(MySQL\.[\w.]+|exports\.oxmysql:\w+|exports\['oxmysql'\]:\w+)\s*\(\s*([^)]*)/g;
      let m;
      while ((m = re.exec(clean))) {
        const args = m[2];
        const interpolated = /\.\.|:format\s*\(|%s|%d/.test(args);
        if (!interpolated) continue;
        // Interpolating an identifier (a column or table name) while still binding the
        // VALUES with ? is the normal safe pattern — qbx_core's ban lookup does exactly
        // this. Only flag when no placeholder is used at all.
        if (args.includes('?')) continue;
        // A backtick-wrapped placeholder is a table/column identifier, not a value —
        // ox_inventory's schema migrations use `SHOW COLUMNS FROM \`%s\``. There is no
        // value to bind in DDL, so the ? rule above cannot apply.
        if (/`[^`\n]*(%s|\.\.)[^`\n]*`/.test(args)) continue;
        out.push({ index: m.index });
      }
      return out;
    },
    message: 'The query string is assembled from values with no ? placeholder anywhere.',
    fix: "Bind values as parameters: MySQL.single.await('SELECT ... WHERE x = ?', { x }). Interpolating a column name is acceptable only when it comes from a server-side allow-list.",
  },
  {
    id: 'SEC-10',
    severity: 'CRITICAL',
    title: 'Dynamic code execution',
    // negative lookbehind so lib.load(), self:load(), myLoad() etc. do not match
    test: (clean, withStrings) => {
      const out = [];
      // detect on the blanked view so a `load(` mentioned inside a string is ignored,
      // but read the arguments from the string-preserving view at the same offsets
      const re = /(?<![.:\w])(?:loadstring|load)\s*\(/g;
      let m;
      while ((m = re.exec(clean))) {
        const argsEnd = clean.indexOf(')', m.index);
        const args = withStrings.slice(m.index + m[0].length, argsEnd === -1 ? undefined : argsEnd);
        // A deliberate module loader passes a chunk name, and often a mode string:
        //   load(file, '@@res/file.lua', 't', env)        -- ox_lib's require
        //   load(chunk, ('@@ox_lib/imports/%s'):format(m))
        // The Lua convention is a chunkname beginning with '@'. A dangerous call is
        // load(x) / loadstring(x) on a single value with no chunkname.
        if (/,\s*(['"])[tb]{1,2}\1/.test(args)) continue;
        if (/,\s*\(?\s*['"]@/.test(args)) continue;
        out.push({ index: m.index });
      }
      return out;
    },
    message: 'load/loadstring evaluates arbitrary code. If any part comes from a client, this is remote code execution.',
    fix: 'Remove it. Allow-list behaviour instead of evaluating strings.',
  },
  {
    id: 'SEC-7',
    severity: 'HIGH',
    title: 'Command registered with no permission gate',
    serverOnly: true,
    test: (clean, withStrings) => {
      const out = [];
      // lib.addCommand — read the whole config table, nested tables included
      const re = /lib\.addCommand\s*\(\s*(['"])(.+?)\1\s*,/g;
      let m;
      while ((m = re.exec(clean))) {
        const cfg = balancedBraces(clean, m.index + m[0].length);
        if (cfg === null) continue;
        const gated = /restricted\s*=/.test(cfg) && !/restricted\s*=\s*false\b/.test(cfg);
        if (gated) continue;
        // only a finding if the handler actually grants value or control
        const at = m.index + m[0].length + cfg.length;
        if (!PRIVILEGED_ACTION.test(luaBlock(withStrings, at, 2000))) continue;
        out.push({ index: m.index, extra: m[2] });
      }
      // raw RegisterCommand — scan the real handler body for a permission check.
      // The lookbehind excludes framework wrappers with their own permission model,
      // e.g. ESX.RegisterCommand('setjob', 'admin', fn) takes the group as argument 2.
      const re2 = /(?<![.:\w])RegisterCommand\s*\(\s*(['"])(.+?)\1\s*,/g;
      while ((m = re2.exec(clean))) {
        const at = m.index + m[0].length;
        if (PERMISSION_CHECK.test(luaBlock(clean, at, 2000))) continue;
        if (!PRIVILEGED_ACTION.test(luaBlock(withStrings, at, 2000))) continue;
        out.push({ index: m.index, extra: m[2] });
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
        if (/\bWait\s*\(|Citizen\.Wait\s*\(/.test(body)) continue;
        // `while true do ... break/return` is an ordinary synchronous algorithm loop
        // (ox_lib's heap sift, for instance), not a tick loop that hangs the game.
        if (/\bbreak\b|\breturn\b|\bgoto\b/.test(body)) continue;
        out.push({ index: m.index });
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
    // secrets live INSIDE string literals, so this rule reads the string-preserving view
    needsStrings: true,
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
  const withStrings = stripComments(source); // comments gone, string contents kept
  const clean = blankStringContents(withStrings); // code structure only
  const side = detectSide(clean, filename);
  const findings = [];

  for (const rule of RULES) {
    // server-only rules don't apply to client scripts (a client RegisterCommand
    // has no ACE implication, and a client cannot broadcast)
    if (rule.serverOnly && side === 'client') continue;
    // Both views are the same length with the same character positions, so indices
    // taken from one are valid in the other. Rules that need literal text (a `?`
    // placeholder, a quoted key) read the second argument.
    for (const hit of rule.test(rule.needsStrings ? withStrings : clean, withStrings)) {
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
