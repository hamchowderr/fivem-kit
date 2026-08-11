<!--
Thanks for the PR. The checklist is short and every line of it is enforced by CI,
so ticking honestly saves you a round trip.
-->

## What this changes

<!-- One or two sentences. What was wrong, what it does now. -->

Fixes #

<!--
Required, except for a one-line API correction that carries its own proof below.
PRs with no linked issue may be closed.
-->

## If this touches `skills/`

<!-- Delete this section if it doesn't. -->

- **Verified against:** <!-- overextended/ox_inventory@v2.44.0 -->
- **File and line:** <!-- modules/inventory/server.lua:812 -->

A PR that documents an API from memory gets closed, however plausible it reads.

## If this adds a security rule

<!-- Delete this section if it doesn't. -->

- **Kind:** automatic / handed to the model / documented knowledge
- Test proving it fires on the vulnerable pattern: <!-- name -->
- Test proving it stays quiet on valid code that looks similar: <!-- name -->

## Checks

```bash
node scripts/update-sources.mjs            # run first — verify-docs reads the clones
cd mcp && npm test
node scripts/verify-docs.mjs --strict
node scripts/check-release.mjs
claude plugin validate .claude-plugin/plugin.json
```

- [ ] All five pass locally
- [ ] Commit messages follow Conventional Commits (`fix(lsp):`, `feat(mcp):`, `docs(readme):`)
- [ ] One concern in this PR
