export const meta = {
  name: 'fivem-audit-server',
  description: 'Audit every resource on a FiveM server for exploitable server-side flaws',
  whenToUse:
    'A whole-server security audit that needs to be repeatable — before a launch, on a schedule, in CI, or when re-checking a server you audited last month. For a single resource or an exploratory look, /fivem:audit is lighter.',
  phases: [
    { title: 'Survey', detail: 'find the resources worth auditing' },
    { title: 'Audit', detail: 'deterministic pass, then read every client-reachable handler' },
    { title: 'Verify', detail: 'try to refute each CRITICAL and HIGH finding' },
    { title: 'Report', detail: 'merge, rank by severity, and say what was not covered' },
  ],
};

/*
 * The deterministic half of /fivem:audit.
 *
 * The skill version is a supervisor: the model decides how many specialists to spawn and in
 * what order. That is the right shape for a conversation and the wrong shape for a check you
 * run every week, because two runs over the same server can do different amounts of work.
 * Here the control flow is code — same server, same passes, resumable after an interruption.
 *
 * Note that a workflow script has NO filesystem access, so the resource list has to come from
 * an agent rather than from a readdir. That is the one real constraint shaping this file.
 */

const SURVEY = {
  type: 'object',
  required: ['resources'],
  properties: {
    serverPath: { type: 'string' },
    dialect: { type: 'string', description: 'ox | esx | qbcore | qbox | standalone' },
    resources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'path'],
        properties: {
          name: { type: 'string' },
          path: { type: 'string' },
          hasServerLua: { type: 'boolean' },
        },
      },
    },
    excluded: {
      type: 'array',
      description: 'Framework and library resources deliberately not audited',
      items: { type: 'string' },
    },
  },
};

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rule', 'severity', 'file', 'line', 'summary'],
        properties: {
          rule: { type: 'string', description: 'SEC-1 … SEC-15' },
          severity: { type: 'string', description: 'CRITICAL | HIGH | MEDIUM | LOW' },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          exploit: { type: 'string', description: 'How a player actually abuses it' },
          fix: { type: 'string' },
        },
      },
    },
    resourcesCovered: { type: 'array', items: { type: 'string' } },
  },
};

const VERDICT = {
  type: 'object',
  required: ['real', 'reason'],
  properties: {
    real: { type: 'boolean' },
    reason: { type: 'string' },
    severityShouldBe: { type: 'string' },
  },
};

/*
 * Resources whose "vulnerabilities" are their own API surface.
 *
 * ox_inventory exposes item mutation to other resources on purpose; auditing it produces a
 * page of findings that are the design. The frameworks are excluded for the same reason, and
 * because nobody auditing their own server is going to patch es_extended.
 */
const NOT_YOURS = [
  'ox_lib', 'ox_core', 'ox_target', 'ox_inventory', 'ox_doorlock', 'ox_fuel', 'ox_banking',
  'oxmysql', 'es_extended', 'qb-core', 'qbx_core', 'chat', 'mapmanager', 'spawnmanager',
  'sessionmanager', 'basic-gamemode', 'fivem-map-skater', 'hardcap', 'rconlog', 'yarn',
  'webpack', 'monitor',
];

/*
 * How many resources one auditor handles.
 *
 * A real server is 40–200 resources and the session caps concurrent agents anyway, so one
 * agent per resource would mostly queue. Batching keeps the agent count bounded and honest:
 * whatever the batching works out to is logged, because a cap nobody is told about reads as
 * full coverage.
 */
const MAX_AUDITORS = 6;

const serverPath = typeof args === 'string' ? args : args?.serverPath;

phase('Survey');

const survey = await agent(
  `Survey a FiveM server for a security audit${serverPath ? ` at: ${serverPath}` : ''}.

Run the stack detector to find the server and its dialect:
  node "\${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" ${serverPath || '<serverPath>'} --json

Then list every resource under resources/ (including bracketed category folders such as
[core] and [jobs], which are organisational and nest arbitrarily).

Return every resource EXCEPT framework and library code — those are somebody else's to patch
and their exports look like vulnerabilities by design. Put those names in "excluded" instead.
Flag whether each has server-side Lua: a resource with only client scripts cannot hold a
server-side exploit, and auditing it wastes a pass.`,
  { label: 'survey', phase: 'Survey', schema: SURVEY }
);

if (!survey || !survey.resources?.length) {
  log('No auditable resources found — check the server path.');
  return { findings: [], resources: 0 };
}

const auditable = survey.resources.filter(
  (r) => !NOT_YOURS.includes(r.name) && r.hasServerLua !== false
);

log(
  `${survey.resources.length} resources found · ${auditable.length} auditable · ` +
    `${survey.excluded?.length || 0} framework/library excluded` +
    (survey.dialect ? ` · dialect: ${survey.dialect}` : '')
);

if (!auditable.length) {
  log('Everything found was framework or library code, or client-only. Nothing to audit.');
  return { findings: [], resources: 0, excluded: survey.excluded || [] };
}

// Bounded fan-out. Say what the batching is rather than letting it look like one-per-resource.
const perAuditor = Math.ceil(auditable.length / MAX_AUDITORS);
const batches = [];
for (let i = 0; i < auditable.length; i += perAuditor) {
  batches.push(auditable.slice(i, i + perAuditor));
}
if (perAuditor > 1) {
  log(`Batching ${auditable.length} resources across ${batches.length} auditors (${perAuditor} each).`);
}

/*
 * Audit then verify, as a pipeline rather than two barriers.
 *
 * Each batch's findings go straight into verification while other batches are still being
 * audited. A barrier here would idle every fast auditor until the slowest finished, and
 * nothing in verification needs to see the other batches' results.
 */
const results = await pipeline(
  batches,
  (batch, _item, index) =>
    agent(
      `Audit these FiveM resources for exploitable SERVER-SIDE flaws. Load the fivem-security
skill for the SEC-1…15 ruleset.

Resources:
${batch.map((r) => `  ${r.name}  ${r.path}`).join('\n')}

Work in two passes, in this order:

1. The deterministic pass, which is cheap and has no false negatives on what it covers:
     node "\${CLAUDE_PLUGIN_ROOT}/scripts/fivem-audit.mjs" <resourcePath> --json

2. Then READ every client-reachable handler — RegisterNetEvent, lib.callback.register,
   ox_inventory hooks, RegisterNUICallback — for the rules a regex cannot decide: whether a
   value came from the client, whether the player is close enough to do the thing, whether the
   handler checks permission on the SERVER, and whether a check-then-act pair can interleave.

Report a finding only where a player could actually abuse it. An admin command that prints
information is not a vulnerability, and reporting it buries the ones that are.${
        survey.dialect ? `\n\nThis server runs ${survey.dialect} — use its spelling of money and job APIs.` : ''
      }`,
      { label: `audit:${index + 1}/${batches.length}`, phase: 'Audit', schema: FINDINGS }
    ),

  (audit, batch, index) => {
    if (!audit?.findings?.length) return { audit, verdicts: [] };

    // Only the severe ones are worth an agent each. MEDIUM and LOW still get reported.
    const severe = audit.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
    if (!severe.length) return { audit, verdicts: [] };

    return agent(
      `Try to REFUTE each of these findings by reading the code around them. Default to
refuted when uncertain — a false alarm in a security report costs more than a missed MEDIUM,
because it teaches people to skim the next one.

A finding is NOT real if the value is server-derived rather than client-supplied, if a
permission or distance check exists elsewhere in the handler's path, if the framework wrapper
already enforces it, or if the "injection" interpolates a column or table identifier while
still binding its values.

${severe.map((f, n) => `${n + 1}. [${f.rule} ${f.severity}] ${f.file}:${f.line} — ${f.summary}`).join('\n')}

Return one verdict per finding, in the same order.`,
      {
        label: `verify:${index + 1}/${batches.length}`,
        phase: 'Verify',
        schema: { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: VERDICT } } },
      }
    ).then((v) => ({ audit, severe, verdicts: v?.verdicts || [] }));
  }
);

phase('Report');

const covered = [];
const confirmed = [];
const lesser = [];
const refuted = [];

for (const r of results.filter(Boolean)) {
  const audit = r.audit || r;
  if (!audit?.findings) continue;
  covered.push(...(audit.resourcesCovered || []));

  const severe = r.severe || [];
  const verdicts = r.verdicts || [];

  for (const f of audit.findings) {
    if (f.severity !== 'CRITICAL' && f.severity !== 'HIGH') {
      lesser.push(f);
      continue;
    }
    // No verdict means verification did not run for this one — keep it rather than drop it,
    // and let the report say it is unverified. Silently discarding an unverified CRITICAL
    // would be the worst possible failure mode for a security tool.
    const verdict = verdicts[severe.indexOf(f)];
    if (verdict && verdict.real === false) refuted.push({ ...f, why: verdict.reason });
    else confirmed.push({ ...f, verified: Boolean(verdict) });
  }
}

const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
confirmed.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));

// The batches that returned nothing at all — an agent that died leaves a null, and a report
// that counts it as "clean" is a lie in the direction that gets someone hurt.
const failed = results.filter((r) => !r).length;
if (failed) log(`${failed} of ${batches.length} audit batches returned nothing and were NOT audited.`);

log(
  `${confirmed.length} confirmed (${confirmed.filter((f) => f.severity === 'CRITICAL').length} critical) · ` +
    `${refuted.length} refuted on review · ${lesser.length} medium/low`
);

return {
  serverPath: survey.serverPath || serverPath,
  dialect: survey.dialect,
  resourcesAudited: auditable.length,
  resourcesExcluded: survey.excluded || [],
  batchesFailed: failed,
  confirmed,
  lesser,
  refuted,
};
