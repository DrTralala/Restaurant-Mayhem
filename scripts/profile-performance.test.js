// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  gameplayProjection,
  parsePerformanceArguments,
  profilePerformance,
} from './profile-performance.mjs';

describe('profile-performance arguments', () => {
  it('defaults to the approved baseline and all seeded workloads and speeds', () => {
    expect(parsePerformanceArguments([])).toMatchObject({
      baseline: 'ad2c9aa',
      modes: ['fresh', 'congested', 'edited', 'restored'],
      speeds: [1, 4],
      ticks: 900,
      runs: 4,
      warmups: 1,
    });
  });

  it('accepts bounded workload selectors and run counts', () => {
    expect(parsePerformanceArguments([
      '--baseline=ad2c9aa', '--mode=edited', '--speed=4', '--ticks=12',
      '--runs=3', '--warmups=0',
    ])).toMatchObject({
      baseline: 'ad2c9aa', modes: ['edited'], speeds: [4],
      ticks: 12, runs: 3, warmups: 0,
    });
  });

  it.each([
    ['--ticks=0'],
    ['--runs=-1'],
    ['--warmups=-1'],
    ['--speed=3'],
    ['--speeds=1,1'],
    ['--mode=unknown'],
    ['--modes=fresh,fresh'],
    ['--ticks=2', '--ticks=3'],
    ['--baseline=--upload-pack=bad'],
  ])('rejects invalid or repeated options: %s', (...args) => {
    expect(() => parsePerformanceArguments(args)).toThrow();
  });
});

describe('profile-performance comparison', () => {
  it('resolves virtual entry and relative modules exclusively from the Git tree', async () => {
    const root = process.cwd();
    const entryPath = 'src/__profile_performance_virtual__/entry.js';
    const removedPath = 'src/__profile_performance_virtual__/renamed-away.js';
    const rootSourcePath = '__profile_performance_virtual__/root-helper.js';
    const sourceByPath = new Map([
      [entryPath, "import { value } from './renamed-away'; import { rootValue } from '../../__profile_performance_virtual__/root-helper'; export const result = `${value}:${rootValue}`;"],
      [removedPath, "export const value = 'baseline-only-module';"],
      [rootSourcePath, "export const rootValue = 'root-tree-module';"],
    ]);
    expect(existsSync(resolve(root, entryPath))).toBe(false);
    expect(existsSync(resolve(root, removedPath))).toBe(false);
    expect(existsSync(resolve(root, rootSourcePath))).toBe(false);

    const { createServer } = await import('vite');
    const { createGitTreeSourcePlugin } = await import('./profile-performance.mjs');
    const server = await createServer({
      root,
      configFile: false,
      plugins: [createGitTreeSourcePlugin({
        root,
        treePaths: [...sourceByPath.keys()],
        readSource: path => sourceByPath.get(path),
      })],
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      const loaded = await server.ssrLoadModule('/src/__profile_performance_virtual__/entry.js');
      expect(loaded.result).toBe('baseline-only-module:root-tree-module');
    } finally {
      await server.close();
    }
  });

  it('reports the first differing gameplay projection path without masking identity', async () => {
    const { firstGameplayDifference } = await import('./profile-performance.mjs');
    expect(firstGameplayDifference(
      { queue: [{ members: [{ id: 'c1' }] }] },
      { queue: [{ members: [{ id: 'c2' }] }] },
    )).toEqual({ path: '$.queue[0].members[0].id', baseline: 'c1', candidate: 'c2' });
  });

  it('detects and reports an intermediate trajectory mismatch when endpoints match', async () => {
    const { compareTrajectoryHashes } = await import('./profile-performance.mjs');
    const baselineHashes = ['start-hash', 'baseline-middle-hash', 'same-final-hash'];
    const candidateHashes = ['start-hash', 'candidate-middle-hash', 'same-final-hash'];
    expect(baselineHashes.at(-1)).toBe(candidateHashes.at(-1));
    expect(compareTrajectoryHashes(baselineHashes, candidateHashes)).toEqual({
      equivalent: false,
      comparedTicks: 3,
      firstDifference: {
        tick: 1,
        baselineHash: 'baseline-middle-hash',
        candidateHash: 'candidate-middle-hash',
      },
    });
  });

  it('returns a failing CLI status for trajectory differences despite equal endpoints', async () => {
    const { performanceReportExitCode } = await import('./profile-performance.mjs');
    expect(performanceReportExitCode({
      deterministic: true,
      endpointEquivalent: true,
      trajectoryEquivalent: false,
      workloads: [],
    })).toBe(1);
  });

  it('ignores expansion counters but still compares invariant diagnostics', () => {
    const snapshot = { restaurant: { totalServed: 3 }, notifications: [] };
    const makeState = ({ expansionsThisTick, actorExpansions, invariantFailure = null }) => ({
      movementCoordinator: {
        tick: 2,
        elapsedMovementSeconds: 0.1,
        statuses: new Map([['worker-1', {
          plan: 'route-a', motion: 'moving', reason: null, blockers: [], waitingSeconds: 0,
        }]]),
        records: new Map(),
        diagnostics: {
          expansionsThisTick,
          actorExpansions: new Map([['worker-1', actorExpansions]]),
          invariantFailure,
          unsafeActors: [],
        },
      },
      navigationPreflight: { entries: new Map() },
    });

    const baseline = gameplayProjection(snapshot, makeState({
      expansionsThisTick: 28, actorExpansions: 28,
    }));
    const optimised = gameplayProjection(snapshot, makeState({
      expansionsThisTick: 4, actorExpansions: 4,
    }));
    expect(optimised).toEqual(baseline);

    const unsafe = gameplayProjection(snapshot, makeState({
      expansionsThisTick: 4, actorExpansions: 4, invariantFailure: 'unsafe-position',
    }));
    expect(unsafe).not.toEqual(baseline);
  });

  it('reports finite total and tick timing distributions and alternates paired order', async () => {
    const options = parsePerformanceArguments([
      '--mode=fresh', '--speed=1', '--ticks=2', '--runs=2', '--warmups=1',
    ]);
    const report = await profilePerformance(options);
    const workload = report.workloads[0];

    expect(workload.runs.map(run => run.order)).toEqual([
      ['baseline', 'candidate'], ['candidate', 'baseline'],
    ]);
    const samples = workload.runs.flatMap(run => run.order.map(side => run[side]));
    expect(new Set(samples.map(sample => sample.provenance?.pid)).size).toBe(4);
    expect(report.measurementIsolation).toMatchObject({ kind: 'fresh-node-child-per-sample', execPath: process.execPath, execArgv: [] });
    expect(report.orderBalance).toMatchObject({ balanced: true, baselineFirst: 1, candidateFirst: 1 });
    for (const [index, sample] of samples.entries()) {
      expect(sample.provenance.pid).not.toBe(process.pid);
      expect(sample.provenance.execPath).toBe(process.execPath);
      expect(sample.provenance.execArgv).toEqual([]);
      expect(sample.provenance.passes.map(pass => [pass.kind, pass.side, pass.graphIndex])).toEqual([
        ['warmup', sample.side, 1], ['measured', sample.side, 2],
      ]);
      expect(sample.provenance.passes.every(pass => pass.gameplayDigest === sample.gameplayDigest)).toBe(true);
      expect(sample.provenance.sourceFingerprint).toBe(report.candidate.sourceFingerprint);
      expect(sample.provenance.closedAtMilliseconds).toBeGreaterThan(sample.provenance.launchedAtMilliseconds);
      if (index > 0) expect(sample.provenance.launchedAtMilliseconds).toBeGreaterThanOrEqual(samples[index - 1].provenance.closedAtMilliseconds);
      expect(() => process.kill(sample.provenance.pid, 0)).toThrow();
    }
    expect(workload.equivalent).toBe(true);
    expect(report.endpointEquivalent).toBe(true);
    expect(report.trajectoryEquivalent).toBe(true);
    expect(workload.trajectory).toMatchObject({
      comparedTicks: 2,
      equivalent: true,
      firstDifference: null,
    });
    expect(report.comparisonScope.timingIncludesTrajectory).toBe(false);
    for (const side of ['baseline', 'candidate']) {
      const summary = workload.summary[side];
      expect(Number.isFinite(summary.totalCpuMilliseconds.p50)).toBe(true);
      expect(Number.isFinite(summary.tickLatencyMilliseconds.p95)).toBe(true);
      expect(summary.tickLatencyMilliseconds.count).toBe(4);
      expect(summary.telemetryEnabled).toBe(false);
      expect(summary.telemetryCaptureCalls).toBe(0);
      expect(summary.counters).toBeNull();
      expect(summary.phaseTotalsMilliseconds).toBeNull();
      expect(workload.runs[0][side].telemetryEnabled).toBe(false);
      expect(workload.runs[0][side].telemetryCaptureCalls).toBe(0);
      expect(workload.runs[0][side].counters).toBeNull();
    }
    expect(workload.runs.every(run => run.gameplayEquivalent)).toBe(true);
    for (const side of ['baseline', 'candidate']) {
      const diagnostics = workload.trajectory.diagnostics[side];
      expect(diagnostics.telemetryCaptured).toBe(true);
      expect(diagnostics.captureNavigationCalls).toBe(2);
      expect(diagnostics.counters.workspaceBuilds).toBeGreaterThan(0);
      expect(Number.isFinite(diagnostics.phaseTotalsMilliseconds.movement)).toBe(true);
    }
  }, 30_000);

  it('starts module-scoped customer IDs fresh for each independent SSR graph', async () => {
    const { firstGameplayDifference, withFreshSimulationContext } = await import('./profile-performance.mjs');
    const projections = [];
    for (let run = 0; run < 2; run += 1) {
      projections.push(await withFreshSimulationContext({
        root: process.cwd(), side: 'candidate',
      }, context => {
        const originalRandom = Math.random;
        Math.random = () => 0;
        try {
          const spawned = context.spawnCustomers(context.createInitialState(), 1_000_000);
          return gameplayProjection(context.movementSaveSnapshot(spawned), spawned);
        } finally {
          Math.random = originalRandom;
        }
      }));
    }

    expect(projections.map(projection => projection.queue[0].partyId)).toEqual(['p1', 'p1']);
    expect(firstGameplayDifference(projections[0], projections[1])).toBeNull();
  }, 30_000);

  it('rejects a baseline that does not resolve to a Git commit', async () => {
    const options = parsePerformanceArguments([
      '--baseline=no-such-performance-commit', '--ticks=2', '--runs=1', '--warmups=0',
    ]);
    await expect(profilePerformance(options)).rejects.toThrow(/baseline.*revision|revision.*baseline/i);
  });

  it('keeps state setup and projection outside the process CPU tick interval', async () => {
    const { runScenario } = await import('./profile-performance.mjs');
    expect(runScenario).toBeTypeOf('function');
    const events = [];
    const cpu = vi.spyOn(process, 'cpuUsage').mockImplementation(previous => {
      events.push(previous ? 'cpu-end' : 'cpu-start');
      return { user: 1000, system: 500 };
    });
    try {
      const result = await runScenario({
        side: 'candidate', expansionBudget: 100, captureNavigationCalls: 0,
        createInitialState() { events.push('setup'); return {}; },
        runTick(state) { events.push('tick'); return state; },
        movementSaveSnapshot() { events.push('projection'); return {}; },
      }, { mode: 'fresh', speed: 1, ticks: 2 });
      expect(events).toEqual(['setup', 'cpu-start', 'tick', 'tick', 'cpu-end', 'projection']);
      expect(result.totalCpuMilliseconds).toBe(1.5);
    } finally { cpu.mockRestore(); }
  });

  it('reports odd-run imbalance without adding hidden samples', async () => {
    const report = await profilePerformance(parsePerformanceArguments([
      '--mode=fresh', '--speed=1', '--ticks=2', '--runs=1', '--warmups=0',
    ]));
    expect(report.workloads[0].runs).toHaveLength(1);
    expect(report.orderBalance).toMatchObject({ balanced: false, baselineFirst: 1, candidateFirst: 0 });
    expect(report.warnings.join(' ')).toMatch(/odd|imbalan/i);
  }, 30_000);

  it('rejects changed source content and new source files', async () => {
    const { sourceFingerprint, assertSourceFingerprint } = await import('./profile-performance.mjs');
    expect(sourceFingerprint).toBeTypeOf('function');
    const root = mkdtempSync(resolve(tmpdir(), 'profile-source-test-'));
    try {
      mkdirSync(resolve(root, 'src'));
      writeFileSync(resolve(root, 'src/example.js'), 'original');
      const initial = sourceFingerprint(root);
      writeFileSync(resolve(root, 'src/example.js'), 'changed');
      expect(() => assertSourceFingerprint(root, initial)).toThrow(/source.*changed/i);
      writeFileSync(resolve(root, 'src/example.js'), 'original');
      assertSourceFingerprint(root, initial);
      writeFileSync(resolve(root, 'src/new.js'), 'new');
      expect(() => assertSourceFingerprint(root, initial)).toThrow(/source.*changed/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    ['exit', "process.send({ partial: true }); process.exitCode = 7; process.disconnect();", /exit.*7/i, 5_000],
    ['timeout', "process.on('SIGTERM', () => {}); setInterval(() => {}, 100);", /timed out/i, 200],
    ['missing result', 'process.disconnect();', /result|protocol/i, 5_000],
    ['malformed result', 'process.send({ partial: true }); process.disconnect();', /result|protocol/i, 5_000],
  ])('fails closed on child %s and waits for termination', async (_name, source, expected, timeoutMilliseconds) => {
    const { runIsolatedSample } = await import('./profile-performance.mjs');
    expect(runIsolatedSample).toBeTypeOf('function');
    const root = mkdtempSync(resolve(tmpdir(), 'profile-worker-test-'));
    try {
      const path = resolve(root, 'worker.mjs');
      writeFileSync(path, `process.once('message', () => { ${source} });`);
      let failure;
      try {
        await runIsolatedSample({}, { workerURL: pathToFileURL(path), timeoutMilliseconds });
      } catch (error) { failure = error; }
      expect(failure?.message).toMatch(expected);
      expect(Number.isInteger(failure.pid)).toBe(true);
      expect(() => process.kill(failure.pid, 0)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
