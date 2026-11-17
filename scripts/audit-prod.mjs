// Dependency audit for the pre-push hook and CI: fails on a known high or
// critical vulnerability in a package the app ships, like
// `npm audit --omit=dev --audit-level=high`, except for the advisories listed
// in ACCEPTED_ADVISORIES. npm has no way to accept one advisory, and one that
// has no patched release would otherwise block every push for everyone.
//
// An entry is a decision, not a convenience: write why the advisory cannot
// reach production and what removes the entry. Everything else still fails.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @type {Record<string, string>} */
export const ACCEPTED_ADVISORIES = {
  // picomatch <= 4.0.7: ReDoS through repeated extglobs. Reviewed 2026-11-17,
  // accepted by the owner. No patched release exists. It reaches the tree only
  // through next-intl -> @parcel/watcher, which matches file names against the
  // globs of our own build configuration during `next dev`/`next build`; no
  // request, visitor input or database value is ever matched with it.
  // Remove this entry once picomatch publishes a fixed version and
  // `npm audit fix` takes it.
  'GHSA-fc5q-39xc-vjpf': 'picomatch ReDoS, build-time only via next-intl -> @parcel/watcher; no patched release',
};

const BLOCKING = new Set(['high', 'critical']);

/** The GHSA id at the end of an advisory URL. */
const advisoryId = (/** @type {string | undefined} */ url) => /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(url ?? '')?.[0] ?? null;

/**
 * The high and critical advisories of an `npm audit --json` report, split into
 * those that block and those accepted in `accepted`. A package that is only
 * flagged because it depends on a vulnerable one carries no advisory of its
 * own and is not listed. An advisory without a recognisable id always blocks.
 *
 * @param {any} report
 * @param {Record<string, string>} [accepted]
 */
export function classifyAdvisories(report, accepted = ACCEPTED_ADVISORIES) {
  const seen = new Map();
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || via === null || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via.url);
      const key = id ?? `${name}:${via.title}`;
      if (!seen.has(key)) seen.set(key, { id, package: via.name ?? name, severity: via.severity, title: via.title ?? '', url: via.url ?? '' });
    }
  }
  const all = [...seen.values()];
  return {
    blocking: all.filter((advisory) => !advisory.id || !(advisory.id in accepted)),
    accepted: all.filter((advisory) => advisory.id && advisory.id in accepted),
  };
}

function main() {
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error('audit: npm audit returned no readable report.');
    console.error(audit.stderr || audit.stdout);
    return 1;
  }
  // A failed audit (registry unreachable, bad lockfile) must not pass as clean.
  if (report.error || !report.vulnerabilities) {
    console.error('audit: npm audit failed:', report.error?.summary ?? report.message ?? 'no vulnerability list in the report');
    return 1;
  }
  const { blocking, accepted } = classifyAdvisories(report);
  for (const advisory of accepted) {
    console.log(`audit: accepted ${advisory.id} (${advisory.package}, ${advisory.severity}): ${ACCEPTED_ADVISORIES[advisory.id]}`);
  }
  if (blocking.length > 0) {
    console.error(`audit: ${blocking.length} high or critical advisory(ies) in shipped dependencies:`);
    for (const advisory of blocking) console.error(`  ${advisory.severity}  ${advisory.package}  ${advisory.title}  ${advisory.url}`);
    console.error('Update the dependency. Only an advisory with no fix that cannot reach production may be accepted, in scripts/audit-prod.mjs.');
    return 1;
  }
  console.log('audit: no blocking advisory in shipped dependencies.');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
