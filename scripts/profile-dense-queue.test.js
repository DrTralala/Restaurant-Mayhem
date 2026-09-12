// CLI fixtures exercise schema/argument plumbing, not the real workload acceptance.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMovementMetrics, summariseMovementMetrics } from '../src/simulation/movementMetrics';

const script = resolve('scripts/profile-dense-queue.mjs');
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function rootFixture({ baseline = false, milliseconds = 1, overrides = {}, changing = false, missingHelper = false } = {}) {
  const root = mkdtempSync('/tmp/opencode/task16-profile-');
  directories.push(root);
  mkdirSync(join(root, 'src/simulation'), { recursive: true });
  const summary = baseline ? { batches: 900, batchMilliseconds: milliseconds, solverCalls: 42 }
    : { ...summariseMovementMetrics(createMovementMetrics()), batches: 900, batchMilliseconds: milliseconds,
      plannerMilliseconds: 0.5, executorMilliseconds: 0.25 };
  const common = { summary, displacedActors: 24, actorsPassingDoor: 24, actorsCompletingDoorRoutes: 24,
    allCoordinatesFinite: true, allActorsInsideWorld: true, minimumInitialSpacing: 20,
    minimumEndpointSpacing: 16, minimumSweptSpacing: 16 };
  const value = baseline ? { ...common, tickMilliseconds: [1, 2], nativeOldField: 'old', actors: [] }
    : { ...common, timings: { ticks: [1, 2], batches: [milliseconds], planner: [0.5], executor: [0.25] },
      completionOrder: Array.from({ length: 24 }, (_, index) => String(index)),
      maxExpansionsPerTick: 2048, maximumGroupQuantum: 256, allMovementScheduled: true,
      allWithinSpeedBudget: true, nativeNewField: 'new' };
  Object.assign(value, overrides);
  writeFileSync(join(root, 'src/simulation/movementMetrics.js'), `export const createMovementMetrics = () => (${JSON.stringify(summary)});`);
  writeFileSync(join(root, 'src/simulation/denseQueueStress.js'), `
    let calls = 0;
    export function runDenseQueueScenario({ ticks, metrics }) {
      if (ticks !== 900 || !metrics) throw new Error('Wrong common entry arguments');
      const result = ${JSON.stringify(value)};
      ${changing ? 'result.nativeNewField = ++calls;' : ''}
      return result;
    }
    ${missingHelper ? '' : `export function buildDenseQueueNonTimingProjection(result) {
      const { tickMilliseconds, timings, summary, ...projection } = result;
      return { ...projection, summary: Object.fromEntries(Object.entries(summary)
        .filter(([key]) => !key.endsWith('Milliseconds'))) };
    }`}
  `);
  return root;
}
function cli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer: 2_000_000 });
}

describe('revision-independent dense profiler CLI', () => {
  it.each([
    ['--unknown=1'], ['--runs=0'], ['--runs=-1'], ['--runs=1.5'], ['--runs=NaN'],
    ['--warmups=-1'], ['--warmups=Infinity'], ['--candidate-root=relative'],
    ['--baseline-root=relative'], ['--candidate-root='], ['--runs=1', '--runs=2'], ['--runs'],
  ])('rejects invalid arguments before loading a workload: %j', (...args) => {
    const result = cli(args);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('Invalid profile argument');
  });
  it('reports root and module-schema errors from the actual CLI', () => {
    const absent = cli(['--candidate-root=/tmp/opencode/task16-does-not-exist']);
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain('Profile root');
    const result = cli([`--candidate-root=${rootFixture({ missingHelper: true })}`, '--warmups=0', '--runs=1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('buildDenseQueueNonTimingProjection');
  });
  it('loads old and updated schemas in separate Vite roots, alternates pairs and retains native counters', () => {
    const candidate = rootFixture();
    const baseline = rootFixture({ baseline: true, milliseconds: 2 });
    const result = cli([`--candidate-root=${candidate}`, `--baseline-root=${baseline}`, '--warmups=1', '--runs=3']);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.runOrder).toEqual([['baseline', 'candidate'], ['candidate', 'baseline'], ['baseline', 'candidate']]);
    expect(report.acceptance).toMatchObject({ deterministic: true, medianNoRegression: true, expansionBudget: true });
    expect(report.baseline.counters).toEqual({ batches: 900, solverCalls: 42 });
    expect(report.baseline.projection.nativeOldField).toBe('old');
    expect(report.candidate.projection.nativeNewField).toBe('new');
    for (const key of Object.keys(createMovementMetrics()).filter(key => !key.endsWith('Milliseconds'))) {
      expect(report.candidate.counters).toHaveProperty(key);
    }
    expect(report.candidate.batchMilliseconds).toMatchObject({ median: 1, p95: 1, max: 1 });
    expect(report.baseline.tickMilliseconds).toMatchObject({ median: 1.5, p95: 2, max: 2 });
    expect(report.candidate.phaseMilliseconds.planner).toMatchObject({ median: 0.5 });
  });
  it('accepts candidate-only runs without inventing a baseline performance result', () => {
    const result = cli([`--candidate-root=${rootFixture()}`, '--warmups=0', '--runs=1']);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.acceptance.medianNoRegression).toBeNull();
    expect(report.baseline).toBeUndefined();
  });
  it.each([
    { actorsCompletingDoorRoutes: 23 }, { minimumSweptSpacing: 15.9999999999 },
    { minimumEndpointSpacing: 15 }, { allMovementScheduled: false }, { allWithinSpeedBudget: false },
    { maxExpansionsPerTick: 2049 }, { maximumGroupQuantum: 257 }, { allCoordinatesFinite: false },
  ])('fails acceptance without hiding the JSON evidence: %j', overrides => {
    const result = cli([`--candidate-root=${rootFixture({ overrides })}`, '--warmups=0', '--runs=1']);
    expect(result.status, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout).accepted).toBe(false);
  });
  it('rejects changed native projections and a slower candidate median', () => {
    const changing = cli([`--candidate-root=${rootFixture({ changing: true })}`, '--warmups=0', '--runs=2']);
    expect(changing.status).toBe(1);
    expect(JSON.parse(changing.stdout).acceptance.deterministic).toBe(false);
    const slower = cli([`--candidate-root=${rootFixture({ milliseconds: 3 })}`,
      `--baseline-root=${rootFixture({ baseline: true })}`, '--warmups=0', '--runs=1']);
    expect(slower.status).toBe(1);
    expect(JSON.parse(slower.stdout).acceptance.medianNoRegression).toBe(false);
  });
  it('rejects a missing cooperative counter rather than inventing zero', () => {
    const summary = summariseMovementMetrics(createMovementMetrics());
    delete summary.reverseCacheHits;
    const result = cli([`--candidate-root=${rootFixture({ overrides: { summary } })}`, '--warmups=0', '--runs=1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing finite cooperative counter reverseCacheHits');
  });
  it('rejects missing timing samples rather than treating them as zero', () => {
    const result = cli([`--candidate-root=${rootFixture({ overrides: { timings: { ticks: [] } } })}`, '--warmups=0', '--runs=1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Profile timing samples');
  });
});
