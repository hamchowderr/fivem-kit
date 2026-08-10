/**
 * The canonical list of upstream sources fivem-kit verifies its documentation against.
 *
 * ONE list. It previously lived in three places — the verifier's targets, ci.yml's clone loop
 * and release.yml's — and they drifted: verifier targets were added for ox_doorlock, ox_fuel
 * and ox_banking while the clone loops were not updated, so CI failed with "no source found"
 * for three resources it had never been told to fetch.
 *
 * `scripts/update-sources.mjs` clones or pulls from this list; `scripts/verify-docs.mjs`
 * verifies against it; CI calls the updater rather than hand-writing a loop. Adding a source
 * here is the only step required.
 */

/** ox resources, all under github.com/overextended. */
export const OX_SOURCES = [
  'ox_lib',
  'ox_core',
  'ox_target',
  'ox_inventory',
  'ox_doorlock',
  'ox_fuel',
  'ox_banking',
  'oxmysql',
];

/** Frameworks, each with its own org. */
export const FRAMEWORK_SOURCES = [
  { name: 'esx_core', repo: 'esx-framework/esx_core' },
  { name: 'qb-core', repo: 'qbcore-framework/qb-core' },
  { name: 'qbx_core', repo: 'Qbox-project/qbx_core' },
];

/**
 * Prose documentation sources — read when writing skills, never symbol-verified.
 *
 * These are the upstream docs sites' own repositories. They are the source for anything that
 * is a *concept* rather than an API symbol: entity ownership, state bags, routing buckets,
 * the NUI message/callback contract. `verify-docs.mjs` cannot check prose, so the only
 * protection against writing from a stale copy is keeping the copy fresh.
 *
 * Both were three months behind when the Phase 8 skills were written, which is exactly the
 * window in which a docs site rewrites a page.
 *
 * They are large and CI never reads them, so CI passes `--no-docs`.
 */
export const DOC_SOURCES = [
  { name: 'fivem-docs', repo: 'citizenfx/fivem-docs' },
  { name: 'overextended-docs', repo: 'overextended/docs' },
];

export const oxRepo = (name) => `https://github.com/overextended/${name}`;
export const frameworkRepo = (entry) => `https://github.com/${entry.repo}`;
export const docRepo = (entry) => `https://github.com/${entry.repo}`;

/**
 * Where clones live by default, relative to the repo root:
 * ../fivem-resources/{ox,frameworks,docs}
 */
export const DEFAULT_ROOT = ['..', 'fivem-resources'];
