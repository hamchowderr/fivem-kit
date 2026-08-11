# Contributing to fivem-kit

Contributions of any size are welcome — a one-line signature fix is as useful here as a feature.

> [!TIP]
>
> **New to open source?** [firstcontributions/first-contributions](https://github.com/firstcontributions/first-contributions) walks through the whole flow.

## Contributor guidelines

Read the guidance below for what you want to do:

- [Found a bug](#did-you-find-a-bug)
- [Found a wrong API in the reference](#did-you-find-a-wrong-api)
- [Want to open a Pull Request](#do-you-want-to-open-a-pull-request)
- [Want to add a feature or a security rule](#do-you-intend-to-add-a-feature-or-a-security-rule)
- [Want to improve documentation](#want-to-improve-documentation)
- [Found a security problem in fivem-kit itself](#security-problems-in-fivem-kit-itself)

Read the [Development Guide](DEVELOPMENT.md) to set the repo up and run its tests. Working with an AI agent? Point it at [AGENTS.md](AGENTS.md) first.

### Did you find a bug?

- Check it isn't already reported in [the issues](https://github.com/hamchowderr/fivem-kit/issues).
- If it isn't, [open a bug report](https://github.com/hamchowderr/fivem-kit/issues/new?template=bug_report.yml) with a [minimal reproduction](#minimal-reproduction).

Say what you expected and what happened instead, and paste the exact console output rather than describing it. FiveM errors are precise and the wording matters.

### Did you find a wrong API?

This is the most valuable report you can send. A wrong signature in the reference is worse than a missing one, because every model that reads it repeats it confidently.

[Open an API correction](https://github.com/hamchowderr/fivem-kit/issues/new?template=api_correction.yml) — or go straight to a PR, they're quick to review when the proof is there. Either way, include the proof described in [Proving a correction](#proving-a-correction).

### Do you want to open a Pull Request?

Follow the [Development Guide](DEVELOPMENT.md) to set up and run the checks, then open the PR.

**Required:** link the issue it addresses (`Fixes #123`). PRs with no linked issue may be closed — except one-line API corrections that carry their own proof, which don't need an issue first.

**Required:** if you changed anything in `skills/`, say which upstream commit you verified it against. A PR that documents an API from memory gets closed, however plausible it reads.

Run all five checks from the Development Guide before pushing. CI runs them anyway, and `verify-docs` needs the upstream clones refreshed first.

### Do you intend to add a feature or a security rule?

Open a [feature request](https://github.com/hamchowderr/fivem-kit/issues/new?template=feature_request.yml) and wait for a reply before building it. This repo has strong opinions about what belongs in it, and it's better to find that out before you've written the thing.

For a **new security rule**, say which of the three kinds it is, because it decides where the code goes:

| Kind | Lives in | A rule belongs here when |
|---|---|---|
| Checked automatically | `mcp/src/audit.mjs` | It can be decided from the text of one file — SEC-3, 5, 7, 8, 10, 12 |
| Handed to the model | `mcp/src/audit.mjs` prompts | The answer is elsewhere in the codebase: "is this validated?" — SEC-1, 2, 4, 6, 9 |
| Documented knowledge | `skills/fivem-security/SKILL.md` | It's a judgement the model applies while reading — SEC-11, 13, 14, 15 |

An automatic rule needs two tests in `mcp/test/audit.test.mjs`: one proving it fires on the vulnerable pattern, one proving it stays quiet on valid code that looks similar. A rule that cries wolf gets the whole audit ignored, so the second test is the one that matters.

### Want to improve documentation?

Corrections and gaps are both welcome. The house style is short:

- Say the thing and stop. If a sentence doesn't tell the reader something they need, cut it.
- No asides to the reader, no closing flourishes, no sentences about the document itself.
- Plain words. "Downloads on first use", not "fetches on first use and then works from cache".
- Every API claim comes from source you read.

### Security problems in fivem-kit itself

Don't open a public issue. [Report it privately](https://github.com/hamchowderr/fivem-kit/security/advisories/new), or message a maintainer in [the Discord](https://discord.gg/FVwPAsZZJ).

This is for flaws in fivem-kit — a hook that can be made to run something, a config value that reaches a shell. Exploits in *FiveM resources* aren't security reports here; that's what the audit is for.

## Proving a correction

Every symbol in `skills/` is checked against real upstream source in CI. The check exists because it kept catching real mistakes: a QBCore reference written against a seven-month-old clone documented a compatibility shim as the primary API, and it read perfectly.

So a correction is only reviewable if it says where you looked.

### 1. Refresh the clones

```bash
node scripts/update-sources.mjs
```

This pulls every upstream repository the references are written from and reports what moved. Reading a stale clone is how the original mistake happened.

### 2. Read the actual source

Not the framework's docs — the source. Documentation sites lag, and several of these projects document a wrapper while the real export is somewhere else.

### 3. Say where you looked

**Include:**

- The repository and the commit or tag you read (`overextended/ox_inventory@v2.44.0`)
- The file and, if it helps, the line
- What the reference currently says, and what the source actually says

**Don't include:**

- "The docs say…" without which docs
- A version number with no repository
- A signature you're confident about but didn't open

### 4. Check it passes

```bash
node scripts/verify-docs.mjs --strict
```

If this fails, the docs are wrong, not the check.

## Minimal reproduction

A minimal reproduction is the smallest resource that shows the problem. It proves the bug isn't something else in your server, and building one often finds the real cause.

### 1. Start from a clean resource

```bash
/fivem:resource repro
```

Or copy the smallest existing resource that shows it and strip it down.

### 2. Include only what breaks

**Do add:**

- The single event, export or command that misbehaves
- The `fxmanifest.lua`, in full — manifest problems are a large share of reports
- The minimum config to make it run

**Don't add:**

- Your whole server
- Unrelated resources, even ones you think are innocent
- Your database, beyond the one table involved

### 3. Say what your server runs

- Framework and version — ESX Legacy, QBCore, Qbox, ox, or standalone
- FXServer artifact build number
- OneSync setting
- Node version, and which editor or MCP client you're using
- fivem-kit version (`npx fivem-mcp --version`, or the plugin version)

A mixed install — two frameworks running at once — changes almost everything, so say if you have one.

### 4. Paste the real output

The exact console lines, including the ones above the error. FiveM's `couldn't start resource X` is usually the consequence, not the cause, and the cause is two lines up.

For an audit problem, include the finding key (`[SEC-2] resources/shop/server.lua:41`) and the code it fired on, or should have.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org) — `fix(lsp):`, `feat(mcp):`, `docs(readme):`.
- One concern per PR.
- Hooks use exec form (`command` + `args`), never a shell string. The project settings file is untrusted input and must never reach a shell.
- A check that cannot check must fail, not pass. A green tick nobody investigates is worse than a red one.

Maintainers ship directly to `main`. Outside contributions come as PRs from a fork.

## License

By contributing you agree that your work is licensed under the MIT license that covers this project.
