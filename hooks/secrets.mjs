/**
 * Secret patterns, shared by the two hooks that care about them.
 *
 * `PreToolUse` blocks a write that would commit one; `MessageDisplay` masks one that is
 * about to be echoed to the screen. Both need the same definition of "secret", and a FiveM
 * `server.cfg` is unusually rich in them — `mysql_connection_string`, `rcon_password`,
 * `sv_licenseKey` and Discord webhooks all sit in one file that gets pasted around constantly.
 *
 * Precision matters more than recall here. A false positive on the block path refuses a
 * legitimate write, which is the fastest way to get a plugin uninstalled — so every pattern
 * requires a real credential shape, not just a suggestive variable name.
 */

/** @type {{name: string, re: RegExp, blocking: boolean}[]} */
export const SECRET_PATTERNS = [
  {
    name: 'Discord webhook',
    re: /https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/g,
    blocking: true,
  },
  {
    name: 'MySQL connection string',
    re: /mysql:\/\/[^\s'"]*:[^\s'"@]+@[^\s'"]+/g,
    blocking: true,
  },
  {
    name: 'FiveM licence key',
    re: /\bcfxk_[A-Za-z0-9]{10,}\b/g,
    blocking: true,
  },
  {
    name: 'Steam API key',
    re: /\bsteam_webApiKey\s+["']?[A-F0-9]{32}["']?/gi,
    blocking: true,
  },
  {
    name: 'RCON password',
    re: /\brcon_password\s+["']?(?!""|''|\s*$)\S{4,}["']?/gi,
    blocking: false,
  },
  {
    name: 'generic API key assignment',
    // Requires a long, high-entropy-looking literal — not merely a variable called `key`.
    re: /\b(?:api[_-]?key|secret|token|password)\s*=\s*["'][A-Za-z0-9_\-+/=]{24,}["']/gi,
    blocking: true,
  },
  {
    name: 'AWS access key id',
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    blocking: true,
  },
  {
    name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    blocking: true,
  },
];

/** Obvious placeholders. Blocking a template would be worse than useless. */
const PLACEHOLDER =
  /YOUR[_-]?\w*|xxx+|<[^>]+>|CHANGE[_-]?ME|placeholder|example\.com|\bfoo\b|\bbar\b|\b123456789\b|\b0{6,}\b|\bdummy\b|\btest[_-]?key\b|:(?:pass|passwd|password|secret|mypass\w*|yourpass\w*)@/i;

/**
 * Find secrets in a blob of text.
 * @param {string} text
 * @param {{blockingOnly?: boolean}} opts
 * @returns {{name: string, match: string, index: number}[]}
 */
export function findSecrets(text, { blockingOnly = false } = {}) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const pattern of SECRET_PATTERNS) {
    if (blockingOnly && !pattern.blocking) continue;
    // Fresh regex per call: the shared literals carry /g and therefore lastIndex state.
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let m;
    while ((m = re.exec(text))) {
      if (PLACEHOLDER.test(m[0])) continue;
      out.push({ name: pattern.name, match: m[0], index: m.index });
      if (out.length > 50) return out; // bounded: a hook must not chew through a huge file
    }
  }
  return out;
}

/**
 * Mask a secret for display: enough to recognise which one it is, not enough to use.
 * Never returns more than the first 6 characters.
 */
export function mask(value) {
  const s = String(value);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 6)}${'•'.repeat(Math.min(24, s.length - 6))}`;
}

/** Replace every secret in `text` with a masked form. Used for on-screen redaction only. */
export function redact(text) {
  if (!text || typeof text !== 'string') return { text, count: 0 };
  let out = text;
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    out = out.replace(re, (m) => {
      if (PLACEHOLDER.test(m)) return m;
      count++;
      return mask(m);
    });
  }
  return { text: out, count };
}
