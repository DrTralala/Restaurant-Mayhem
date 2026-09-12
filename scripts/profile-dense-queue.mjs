import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

export function parseProfileArguments(args) {
  const options = { candidateRoot: fileURLToPath(new URL('../', import.meta.url)), warmups: 1, runs: 5 };
  const names = { 'candidate-root': 'candidateRoot', 'baseline-root': 'baselineRoot', warmups: 'warmups', runs: 'runs' };
  const seen = new Set();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    const key = match?.[1];
    const value = match?.[2];
    if (!Object.hasOwn(names, key) || seen.has(key)
      || (key.endsWith('-root') ? !isAbsolute(value)
        : !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (key === 'runs' ? 1 : 0))) {
      throw new Error(`Invalid profile argument: ${argument}`);
    }
    seen.add(key);
    options[names[key]] = key.endsWith('-root') ? value : Number(value);
  }
  return options;
}

export function describeMilliseconds(values) {
  if (!Array.isArray(values) || values.length === 0
    || values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Profile timing samples must be non-empty, finite and non-negative');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1),
  };
}

const deterministicCounters = summary => Object.fromEntries(Object.entries(summary)
  .filter(([key]) => !key.endsWith('Milliseconds')));

export function denseWorkloadAccepted(run, { cooperative = true } = {}) {
  return run.displacedActors === 24 && run.actorsPassingDoor === 24
    && run.actorsCompletingDoorRoutes === 24
    && run.allCoordinatesFinite === true && run.allActorsInsideWorld === true
    && run.minimumInitialSpacing >= 16 && run.minimumEndpointSpacing >= 16 && run.minimumSweptSpacing >= 16
    && (!cooperative || (run.allMovementScheduled === true && run.allWithinSpeedBudget === true
      && run.maximumGroupQuantum <= 256 && run.summary.invariantFailures === 0
      && run.completionOrder?.length === 24 && new Set(run.completionOrder).size === 24));
}

function revisionReport(revision) {
  const { runs, project } = revision;
  const projections = runs.map(run => project(run));
  const expected = JSON.stringify(projections[0]);
  const batchByRun = runs.map(run => run.summary.batchMilliseconds);
  // beb33b1 exposes tickMilliseconds; the cooperative harness owns structured timings.
  const tickSamples = runs.flatMap(run => run.timings?.ticks ?? run.tickMilliseconds ?? []);
  return {
    root: revision.root, projection: projections[0],
    counters: deterministicCounters(runs[0].summary),
    deterministic: projections.every(value => JSON.stringify(value) === expected),
    batchMilliseconds: { byRun: batchByRun, ...describeMilliseconds(batchByRun) },
    tickMilliseconds: describeMilliseconds(tickSamples),
  };
}

export async function profileDenseQueue(options) {
  const revisions = {};
  const servers = [];
  try {
    for (const name of options.baselineRoot ? ['baseline', 'candidate'] : ['candidate']) {
      const root = options[`${name}Root`];
      if (!await stat(root).then(value => value.isDirectory(), () => false)) {
        throw new Error(`Profile root is not a directory: ${root}`);
      }
      const server = await createServer({ root, configFile: false, logLevel: 'silent',
        server: { middlewareMode: true, hmr: false, watch: null } });
      servers.push(server);
      const scenario = await server.ssrLoadModule('/src/simulation/denseQueueStress.js');
      const metrics = await server.ssrLoadModule('/src/simulation/movementMetrics.js');
      for (const [key, value] of Object.entries({
        runDenseQueueScenario: scenario.runDenseQueueScenario,
        buildDenseQueueNonTimingProjection: scenario.buildDenseQueueNonTimingProjection,
        createMovementMetrics: metrics.createMovementMetrics,
      })) {
        if (typeof value !== 'function') throw new Error(`${name} must export ${key}`);
      }
      revisions[name] = { root, runs: [], project: scenario.buildDenseQueueNonTimingProjection,
        counterKeys: Object.keys(metrics.createMovementMetrics()).filter(key => !key.endsWith('Milliseconds')),
        run: () => scenario.runDenseQueueScenario({ ticks: 900, metrics: metrics.createMovementMetrics() }) };
    }
    for (let warmup = 0; warmup < options.warmups; warmup += 1) {
      for (const revision of Object.values(revisions)) revision.run();
    }
    const runOrder = [];
    for (let pair = 0; pair < options.runs; pair += 1) {
      const order = revisions.baseline
        ? pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'] : ['candidate'];
      runOrder.push(order);
      for (const name of order) revisions[name].runs.push(revisions[name].run());
    }
    const candidate = revisionReport(revisions.candidate);
    const baseline = revisions.baseline ? revisionReport(revisions.baseline) : undefined;
    for (const run of revisions.candidate.runs) {
      for (const key of revisions.candidate.counterKeys) {
        if (!Number.isFinite(run.summary[key])) throw new Error(`Candidate is missing finite cooperative counter ${key}`);
      }
    }
    candidate.phaseMilliseconds = Object.fromEntries(['planner', 'executor'].map(phase => {
      const byRun = revisions.candidate.runs.map(run => run.summary[`${phase}Milliseconds`]);
      const tickSamples = revisions.candidate.runs.flatMap(run => run.timings?.[phase] ?? []);
      return [phase, { byRun, ...describeMilliseconds(byRun),
        ...(tickSamples.length ? { perTick: describeMilliseconds(tickSamples) } : {}) }];
    }));
    const acceptance = {
      deterministic: candidate.deterministic,
      medianNoRegression: baseline ? candidate.batchMilliseconds.median <= baseline.batchMilliseconds.median : null,
      expansionBudget: revisions.candidate.runs.every(run => Number.isInteger(run.maxExpansionsPerTick)
        && run.maxExpansionsPerTick >= 0 && run.maxExpansionsPerTick <= 2048),
      workload: revisions.candidate.runs.every(run => denseWorkloadAccepted(run)),
      baselineDeterministic: baseline?.deterministic ?? null,
      baselineWorkload: revisions.baseline
        ? revisions.baseline.runs.every(run => denseWorkloadAccepted(run, { cooperative: false })) : null,
    };
    return { warmups: options.warmups, runs: options.runs, ticksPerRun: 900, runOrder,
      baseline, candidate, acceptance,
      accepted: Object.values(acceptance).every(value => value === true || value === null) };
  } finally {
    await Promise.all(servers.map(server => server.close()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await profileDenseQueue(parseProfileArguments(process.argv.slice(2)));
    console.log(JSON.stringify(report));
    if (!report.accepted) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    if (error.evidence) console.error(JSON.stringify(error.evidence));
    process.exitCode = 1;
  }
}
