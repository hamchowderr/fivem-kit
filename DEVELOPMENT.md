# Development

How to set the repo up and run it. For *what* to contribute and how to report things, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

- Node.js 20 or newer
- git
- Claude Code, if you're working on the plugin half
- `lua-language-server`, only if you're working on `/fivem:lsp`

You don't need a FiveM server to work on most of this. You do need one to test `/fivem:doctor`, `/fivem:init` and stack detection against something real.

## Setup

```bash
git clone https://github.com/hamchowderr/fivem-kit
cd fivem-kit/mcp
npm install
```

## Two products, one repo

The Claude Code plugin is the repo root. The `fivem-mcp` npm package is `mcp/`. They ship together and carry the same version — `check-release.mjs` fails if the two manifests and the changelog disagree.

| | |
|---|---|
| `skills/` | Knowledge and commands. Every `.md` here is symbol-verified in CI |
| `agents/` | Seven subagents, one unit of work each |
| `hooks/` | One dispatcher, 16 events — see [`docs/hooks.md`](docs/hooks.md) |
| `scripts/` | Node CLIs the skills call. argv arrays, never shell strings |
| `lua/` | Lua definitions shipped to lua-language-server — see [`docs/lsp.md`](docs/lsp.md) |
| `workflows/` | Deterministic multi-agent runs. `.js`, not `.mjs`. No filesystem access |
| `mcp/` | The npm package. No `CLAUDE_*` anywhere in `mcp/src/` — it has to work outside Claude Code |

## Commands

```bash
cd mcp && npm test                         # the full suite
node scripts/update-sources.mjs            # refresh the upstream clones the docs are written from
node scripts/verify-docs.mjs --strict      # every documented API must exist in real source
node scripts/check-release.mjs             # manifests agree with each other and the changelog
claude plugin validate .claude-plugin/plugin.json
```

CI runs all of these on every push. `verify-docs` reads the clones, so run `update-sources` first or it has nothing to check against.

## Running the MCP server

```bash
cd mcp
npm start          # over stdio, the way an editor runs it
npm run inspect    # MCP Inspector, for poking at tools by hand
```

## Running the plugin from your checkout

```bash
claude plugin marketplace add /path/to/fivem-kit
```

Then `/plugin install fivem`. Use `--scope local` on the marketplace command if you don't want it in your user settings.

## How the corpus works

From a checkout, the MCP server reads the plugin's markdown straight from `../skills` and `../docs`. On publish, `build-corpus.mjs` copies it into `mcp/corpus/` so the npm package is self-contained.

That means editing a skill changes what the MCP server serves immediately in development, with no build step. It also means `mcp/corpus/` is generated — don't edit it by hand.

## Auditing your own changes

The audit runs on itself:

```bash
node scripts/fivem-audit.mjs <path>            # a .lua file, a resource, or a whole server
node scripts/fivem-audit.mjs <path> --json --min-severity high
```

`mcp/src/audit.mjs` holds the rules and audits one buffer. Everything that audits a *resource* or a *server* goes through `scripts/fivem-audit.mjs` — the security-auditor subagent, the write-time hook, and the beads sync — so a finding reported by the hook is the same finding, with the same key, that `/fivem:audit` reports.

## Before you push

Run the five commands above. If `verify-docs` fails, the docs are wrong, not the check.
