#!/usr/bin/env node
// Compares coverage/lcov.info (written by `npm run test:coverage`) with
// scripts/coverage-floor.json and fails when coverage drops. The floor can
// only rise: a lower percentage, or a file under src/lib that no test runs and
// that is not on the `untested` list, fails the run. The percentages cover all
// of src; the per-file rule covers only src/lib, where AGENTS.md puts business
// logic, so a new page or view component does not need a list entry. When the measured coverage is
// above the floor, or a listed file is now tested, the script says so, so the
// floor and the list can be tightened in the same change as the new tests.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

// Source files the floor covers. Keep in step with the coverage `include`
// in vitest.config.mts.
const SOURCE_ROOTS = ['src'];
const SOURCE_FILE = /\.(ts|tsx)$/;
const NOT_SOURCE = /(\.test\.(ts|tsx)|\.d\.ts)$/;
const SKIP_DIRS = new Set(['node_modules', '__tests__']);
// Files the per-file rule (and the `untested` list) applies to.
const PER_FILE_ROOT = 'src/lib/';

const root = resolve(process.cwd());
const floorPath = 'scripts/coverage-floor.json';
const lcovPath = 'coverage/lcov.info';

if (!existsSync(lcovPath)) {
  console.error(`${lcovPath} is missing; run the tests with coverage first.`);
  process.exit(1);
}

const floor = JSON.parse(readFileSync(floorPath, 'utf8'));

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return SOURCE_FILE.test(name) && !NOT_SOURCE.test(name) ? [path] : [];
  });
}

function parseLcov(text) {
  const files = new Map();
  for (const record of text.split(/^end_of_record$/m)) {
    const lines = record.trim().split('\n');
    const source = lines.find((line) => line.startsWith('SF:'))?.slice(3).trim();
    if (!source) continue;
    const file = isAbsolute(source) ? relative(root, source) : source;
    const count = (prefix) => Number(lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? 0);
    files.set(file, {
      lines: { total: count('LF:'), covered: count('LH:') },
      branches: { total: count('BRF:'), covered: count('BRH:') },
      functions: { total: count('FNF:'), covered: count('FNH:') },
    });
  }
  return files;
}

const measured = parseLcov(readFileSync(lcovPath, 'utf8'));
const total = { lines: { total: 0, covered: 0 }, branches: { total: 0, covered: 0 }, functions: { total: 0, covered: 0 } };
for (const file of measured.values()) {
  for (const key of Object.keys(total)) {
    total[key].total += file[key].total;
    total[key].covered += file[key].covered;
  }
}
const percent = ({ total: all, covered }) => (all === 0 ? 100 : (covered / all) * 100);

const sources = SOURCE_ROOTS.flatMap(walk).sort();
const untested = sources.filter((file) => (measured.get(file)?.lines.covered ?? 0) === 0);
const untestedLib = untested.filter((file) => file.startsWith(PER_FILE_ROOT));
const allowed = new Set(floor.untested);
const newlyUntested = untestedLib.filter((file) => !allowed.has(file));
const nowTested = floor.untested.filter((file) => !untestedLib.includes(file));

const summary = ['lines', 'branches', 'functions'].map((key) => `${percent(total[key]).toFixed(2)}% ${key}`).join(', ');
console.log(`\nCoverage: ${summary}; ${sources.length - untested.length} source files run by tests, ${untested.length} untested, ${untestedLib.length} of them in ${PER_FILE_ROOT} (listed in ${floorPath}).`);

if (nowTested.length) {
  console.log(`\nNow tested, remove from "untested" in ${floorPath}:\n  ${nowTested.join('\n  ')}`);
}
const raisable = ['lines', 'branches', 'functions'].filter((key) => Math.floor(percent(total[key])) > floor[key]);
if (raisable.length) {
  console.log(`\nThe floor in ${floorPath} could be raised: ${raisable.map((key) => `${key} ${floor[key]} -> ${Math.floor(percent(total[key]))}`).join(', ')}.`);
}

let failed = false;
const short = ['lines', 'branches', 'functions'].filter((key) => percent(total[key]) < floor[key]);
if (short.length) {
  failed = true;
  console.error(`\nCoverage below the floor in ${floorPath}: ${short.map((key) => `${key} ${percent(total[key]).toFixed(2)}% < ${floor[key]}%`).join(', ')}.`);
}
if (newlyUntested.length) {
  failed = true;
  console.error(`\nNo test runs these files. Add a test, or list them under "untested" in ${floorPath} with the reason in the commit:\n  ${newlyUntested.join('\n  ')}`);
}
process.exit(failed ? 1 : 0);
