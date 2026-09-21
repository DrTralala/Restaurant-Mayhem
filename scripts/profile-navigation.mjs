import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

function defaultRoot() {
  try {
    return fileURLToPath(new URL('../', import.meta.url));
  } catch {
    return resolve(process.cwd());
  }
}

const DEFAULT_ROOT = defaultRoot();
const MODES = new Set(['fresh', 'congested', 'edited', 'restored']);

export function parseProfileArguments(args) {
  const options = { root: DEFAULT_ROOT, speed: 1, ticks: 900, runs: 5, mode: 'fresh' };
  const seen = new Set();

  for (const argument of args) {
    const match = /^--(root|speed|ticks|runs|mode)=(.+)$/.exec(argument);
    const key = match?.[1];
    const value = match?.[2];
    if (!match || seen.has(key)) throw new Error(`Invalid profile argument: ${argument}`);
    seen.add(key);

    if (key === 'root') {
      options.root = resolve(value);
      continue;
    }
    if (key === 'mode') {
      if (!MODES.has(value)) throw new Error(`Invalid profile argument: ${argument}`);
      options.mode = value;
      continue;
    }
    if (key === 'speed') {
      if (!/^[124]$/.test(value)) throw new Error(`Invalid profile argument: ${argument}`);
      options.speed = Number(value);
      continue;
    }
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`Invalid profile argument: ${argument}`);
    const number = Number(value);
    if (!Number.isSafeInteger(number)
      || (key === 'ticks' && number < 2)
      || (key === 'runs' && number < 1)) {
      throw new Error(`Invalid profile argument: ${argument}`);
    }
    options[key] = number;
  }

  return options;
}

function assertProfileRoot(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Profile root is not a directory: ${root}`);
  }
}

function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

export function warmth(counters) {
  const hits = (counters.pathCacheHits || 0) + (counters.preflightCacheHits || 0);
  const misses = (counters.pathCacheMisses || 0) + (counters.preflightAdvances || 0);
  return hits && !misses ? 'hit-only'
    : misses && !hits ? 'miss-or-advance-only'
      : hits || misses ? 'mixed' : 'no-query';
}

function repositoryMetadata(root) {
  const git = args => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const status = git(['status', '--porcelain', '--untracked-files=all']);
  return {
    root,
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    clean: status === '',
  };
}

function mapEntries(value) {
  if (!(value instanceof Map)) return [];
  return [...value.entries()].sort(([left], [right]) => {
    const a = String(left);
    const b = String(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function sortedStrings(value) {
  return (Array.isArray(value) ? value : []).map(String).sort();
}

function deterministicRuntime(state) {
  const coordinator = state.movementCoordinator || {};
  return {
    tick: coordinator.tick ?? 0,
    elapsedMovementSeconds: coordinator.elapsedMovementSeconds ?? 0,
    statuses: mapEntries(coordinator.statuses).map(([id, status]) => [String(id), {
      plan: status.plan,
      motion: status.motion,
      reason: status.reason,
      blockers: sortedStrings(status.blockers),
      waitingSeconds: status.waitingSeconds ?? 0,
    }]),
    records: mapEntries(coordinator.records).map(([id, record]) => [String(id), {
      goal: record.goal,
      routeGoal: record.routeGoal,
      waitingSeconds: record.waitingSeconds ?? (record.waitingTicks || 0) / 30,
      lastMovedAt: record.lastMovedAt ?? null,
    }]),
    diagnostics: {
      expansionsThisTick: coordinator.diagnostics?.expansionsThisTick ?? 0,
      actorExpansions: mapEntries(coordinator.diagnostics?.actorExpansions),
      invariantFailure: coordinator.diagnostics?.invariantFailure ?? null,
      unsafeActors: sortedStrings(coordinator.diagnostics?.unsafeActors),
    },
    preflight: mapEntries(state.navigationPreflight?.entries).map(([key, entry]) => [String(key), {
      status: entry.status,
      lastFrame: entry.lastFrame,
    }]),
  };
}

export function deterministicProjection(snapshot, state) {
  return {
    ...snapshot,
    // Milestone notification IDs and timestamps use Date.now(); they are
    // presentation fields, not simulation authority.
    notifications: (snapshot.notifications || []).map(({ id: _id, time: _time, ...notification }) => notification),
    navigationRuntime: deterministicRuntime(state),
  };
}

function counterTotals(samples) {
  const counters = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample.counters || {})) {
      counters[key] = (counters[key] || 0) + value;
    }
  }
  return counters;
}

export function sampleSummary(samples) {
  return {
    count: samples.length,
    timings: distribution(samples.map(sample => sample.tickMilliseconds)),
    counters: counterTotals(samples),
    cacheClasses: Object.fromEntries([...new Set(samples.map(sample => sample.cacheClass))]
      .map(key => [key, distribution(samples.filter(sample => sample.cacheClass === key)
        .map(sample => sample.tickMilliseconds))])),
  };
}

async function runOne(options) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: options.root, configFile: false, logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } });
  const originalRandom = Math.random;
  try {
    const { createInitialState } = await server.ssrLoadModule('/src/state/initialState.js');
    const { runTick } = await server.ssrLoadModule('/src/simulation/gameLoop.js');
    const { movementSaveSnapshot } = await server.ssrLoadModule('/src/state/movementPersistence.js');
    const { hydrateState } = await server.ssrLoadModule('/src/state/persistence.js');
    const { moveFixtures } = await server.ssrLoadModule('/src/state/fixtureMoves.js');
    const telemetry = existsSync(resolve(options.root, 'src/simulation/navigation/telemetry.js'))
      ? await server.ssrLoadModule('/src/simulation/navigation/telemetry.js') : null;
    const capture = telemetry?.captureNavigation || (run => {
      const started = performance.now();
      const value = run();
      return { value, report: { counters: {}, phases: {}, tickMilliseconds: performance.now() - started } };
    });

    Math.random = randomSource(20260920);
    let state = createInitialState();
    state = { ...state, speed: options.speed };
    if (options.mode === 'congested') {
      state = { ...state, staff: [...state.staff,
        ...state.staff.map((worker, index) => ({ ...worker, id: `profile-extra-${index}`,
          x: 560 + index * 30, y: 500, task: null, navigationGoal: undefined }))] };
    }
    if (options.mode === 'edited') {
      const moved = moveFixtures(state, [{ type: 'table', id: 't1', x: 560, y: 240 }]);
      if (moved === state) throw new Error('Edited workload was rejected; profile would be meaningless');
      state = moved;
    }
    if (options.mode === 'restored') state = hydrateState(movementSaveSnapshot(state), createInitialState());

    const samples = [];
    let unsafeBatches = 0;
    for (let tick = 0; tick < options.ticks; tick += 1) {
      const captured = capture(() => runTick(state,
        { gameDt: options.speed * 2, movementDt: options.speed / 30 }));
      state = captured.value;
      const diagnostics = state.movementCoordinator?.diagnostics;
      if (diagnostics?.invariantFailure) unsafeBatches += 1;
      if (state.navigationFault) throw new Error(`Quarantined workload at tick ${tick}`);
      samples.push({ tick, ...captured.report,
        cacheClass: telemetry ? warmth(captured.report.counters) : 'unavailable',
        retainedPreflightEntries: state.navigationPreflight?.entries?.size ?? 0,
        lastBatchExpansions: diagnostics?.expansionsThisTick ?? null });
    }

    const counters = counterTotals(samples);
    const snapshot = movementSaveSnapshot(state);
    const digest = createHash('sha256').update(JSON.stringify(
      deterministicProjection(snapshot, state),
    )).update(JSON.stringify(counters)).digest('hex');
    return {
      digest,
      repository: repositoryMetadata(options.root),
      telemetryAvailable: Boolean(telemetry),
      counters,
      unsafeLastBatches: unsafeBatches,
      totalServed: state.restaurant.totalServed,
      remainingCustomers: state.customers.length,
      queuedParties: state.queue.length,
      heldRequests: [...(state.movementCoordinator?.records || [])].map(([id, record]) => ({
        id, waitingSeconds: record.waitingSeconds ?? (record.waitingTicks || 0) / 30,
      })).filter(record => record.waitingSeconds >= 2)
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      // Keep the raw saved state and raw timing samples available for inspection;
      // only the digest projection removes wall-clock presentation metadata.
      snapshot,
      samples,
      all: sampleSummary(samples),
      cold: sampleSummary(samples.slice(0, 1)),
      warm: sampleSummary(samples.slice(1)),
      firstTickMilliseconds: samples[0].tickMilliseconds,
    };
  } finally {
    Math.random = originalRandom;
    await server.close();
  }
}

export async function profileNavigation(options) {
  assertProfileRoot(options.root);
  const runs = [];
  for (let index = 0; index < options.runs; index += 1) runs.push(await runOne(options));
  const deterministic = runs.every(run => run.digest === runs[0].digest);
  return { options, node: process.version, deterministic, runs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await profileNavigation(parseProfileArguments(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (!report.deterministic || report.runs.some(run => run.unsafeLastBatches > 0
      || (run.counters.invariantFailures || 0) > 0 || (run.counters.overBudgetBatches || 0) > 0)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
