/**
 * Optional Streamable HTTP transport, so one fivem-mcp instance can serve a whole team.
 *
 * stdio remains the default and nothing here runs unless `--http` is passed. That matters:
 * stdio has no attack surface worth the name — the process is spawned by your editor, talks
 * over a pipe, and dies with it. The moment it listens on a socket, all of that changes, so
 * this file is mostly about the change rather than about the transport.
 *
 * THE THREAT
 *
 * `fivemDetectStack` reads a directory the caller names. Over stdio that is the same
 * privilege the editor already had. Over a socket it is a stranger reading paths on someone
 * else's machine — enough to enumerate a filesystem, and `server.cfg` is exactly the file a
 * FiveM server keeps its database credentials and license key in.
 *
 * So the rules here fail CLOSED:
 *
 *   1. Binds to 127.0.0.1 unless told otherwise. Sharing is a decision, not a default.
 *   2. Binding anywhere else REQUIRES a token, and refuses to start without one. There is no
 *      "warn and continue" path, because a warning printed at startup is read once and then
 *      never again.
 *   3. The token comes from the environment, never from argv — command lines are visible to
 *      every other process on the machine via `ps`.
 *   4. DNS-rebinding protection is on, so a web page cannot make a browser talk to a server
 *      bound to a developer's own loopback.
 *   5. `FIVEM_SERVER_ROOT` confines path-reading tools when set, and its absence is reported
 *      loudly at startup when listening off-loopback.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const DEFAULT_PORT = 3111;
export const DEFAULT_HOST = '127.0.0.1';

/** Loopback means "this machine only" — the one case where no token is required. */
export function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Where path-reading tools are allowed to look.
 *
 * Returns null when unconfined. Kept here rather than in the tool so the same answer is given
 * to the tool and to the startup banner — a confinement the user is not told about is one
 * they will not notice is missing.
 */
export function serverRoot() {
  const r = process.env.FIVEM_SERVER_ROOT;
  return r ? path.resolve(r) : null;
}

/**
 * Is `target` inside the configured root?
 *
 * Compares resolved paths with a separator appended, so `/srv/fivem-evil` is not treated as
 * living inside `/srv/fivem`. Returns true when no root is configured.
 */
export function withinRoot(target, root = serverRoot()) {
  if (!root) return true;
  const resolved = path.resolve(target);
  if (resolved === root) return true;
  return resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** Timing-safe compare that does not leak length through an early return. */
function tokenMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Decide whether this configuration is allowed to start, before anything binds.
 *
 * Separated from `serve` so the decision is testable without opening a socket, and so the
 * refusal reaches the operator as a message rather than as a stack trace.
 *
 * @returns {{ok: true, warnings: string[]} | {ok: false, error: string}}
 */
export function checkConfig({ host, token, root }) {
  if (!isLoopback(host) && !token) {
    return {
      ok: false,
      error:
        `Refusing to listen on ${host} without authentication.\n\n` +
        'Anyone who can reach that address could read paths on this machine through\n' +
        'fivemDetectStack — including server.cfg, which holds your database credentials\n' +
        'and license key.\n\n' +
        'Set a token and try again:\n' +
        '  FIVEM_MCP_TOKEN="$(openssl rand -hex 32)" fivem-mcp --http --host ' +
        host +
        '\n\n' +
        'Clients then send it as:  Authorization: Bearer <token>\n' +
        'Or drop --host to serve this machine only, where no token is needed.',
    };
  }

  const warnings = [];
  if (!isLoopback(host) && !root) {
    warnings.push(
      'FIVEM_SERVER_ROOT is not set, so authenticated clients can ask fivemDetectStack to ' +
        'read ANY path on this host. Set it to the folder containing your server(s) to confine them.'
    );
  }
  if (token && token.length < 24) {
    warnings.push(
      `FIVEM_MCP_TOKEN is ${token.length} characters. It is the only thing between the network ` +
        'and this host — 32+ random characters is the intent.'
    );
  }
  return { ok: true, warnings };
}

/**
 * Serve an McpServer over Streamable HTTP.
 *
 * A session per client, because two developers sharing an instance must not share
 * conversation state — the SDK keys that off the session id it generates on initialize.
 *
 * @returns {Promise<{port: number, host: string, close: () => Promise<void>}>}
 */
export async function serve(server, { host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const token = process.env.FIVEM_MCP_TOKEN || '';
  const root = serverRoot();

  const check = checkConfig({ host, token, root });
  if (!check.ok) {
    const err = new Error(check.error);
    err.configRefused = true;
    throw err;
  }
  for (const w of check.warnings) console.error(`[fivem-kit] WARNING: ${w}`);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    // Without this a page on the open web can drive a server bound to a developer's own
    // loopback, which is the whole point of the rebinding attack.
    enableDnsRebindingProtection: true,
    allowedHosts: [`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`],
  });

  await server.connect(transport);

  const httpServer = http.createServer((req, res) => {
    // Auth first, before the transport sees anything. An unauthenticated request must not
    // reach session handling, or it can probe for valid session ids.
    if (token) {
      const header = req.headers.authorization || '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!provided || !tokenMatches(provided, token)) {
        res.writeHead(401, {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer realm="fivem-mcp"',
        });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, confined: Boolean(root) }));
      return;
    }

    transport.handleRequest(req, res).catch((err) => {
      console.error('[fivem-kit] request failed:', err?.message ?? err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });

  const actual = httpServer.address();
  const boundPort = typeof actual === 'object' && actual ? actual.port : port;

  console.error(
    `[fivem-kit] listening on http://${host}:${boundPort}  ` +
      `(auth: ${token ? 'bearer token' : 'none — loopback only'}, ` +
      `paths: ${root ? `confined to ${root}` : 'unconfined'})`
  );

  return {
    host,
    port: boundPort,
    close: () =>
      new Promise((resolve) => {
        httpServer.close(() => transport.close().then(resolve, resolve));
      }),
  };
}
