import { createServer } from 'vite';

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;
const TICKS = 900;
const phaseKeys = [
  'pairBuildMilliseconds',
  'localConflictMilliseconds',
  'safePrefixMilliseconds',
  'dynamicRepathMilliseconds',
  'staticRepathMilliseconds',
  'residualBatchMilliseconds',
];
const timingKeys = new Set(['batchMilliseconds', 'averageBatchMilliseconds', ...phaseKeys]);

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length / 2;
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[Math.floor(middle)];
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function deterministicCounters(summary) {
  return Object.fromEntries(Object.entries(summary).filter(([key]) => !timingKeys.has(key)));
}

const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { runDenseQueueScenario } = await server.ssrLoadModule('/src/simulation/denseQueueStress.js');
  for (let run = 0; run < WARMUP_RUNS; run += 1) runDenseQueueScenario({ ticks: TICKS });
  const runs = Array.from({ length: MEASURED_RUNS }, () => runDenseQueueScenario({ ticks: TICKS }));
  const expectedCounters = deterministicCounters(runs[0].summary);
  if (!runs.every(run => JSON.stringify(deterministicCounters(run.summary))
    === JSON.stringify(expectedCounters))) {
    throw new Error('Dense queue operation counters changed between measured runs');
  }

  const phaseMilliseconds = Object.fromEntries(phaseKeys.map(key => [
    key.replace('Milliseconds', ''),
    median(runs.map(run => run.summary[key])),
  ]));
  const measuredPhaseTotal = Object.values(phaseMilliseconds)
    .reduce((total, milliseconds) => total + milliseconds, 0);
  const phaseShare = Object.fromEntries(Object.entries(phaseMilliseconds).map(([key, milliseconds]) => [
    key,
    milliseconds / measuredPhaseTotal,
  ]));
  const dominantPhase = Object.entries(phaseShare)
    .sort((left, right) => right[1] - left[1])[0];
  const batchMilliseconds = median(runs.map(run => run.summary.batchMilliseconds));
  const allTickMilliseconds = runs.flatMap(run => run.tickMilliseconds);
  const first = runs[0];

  console.log(JSON.stringify({
    ...expectedCounters,
    batchMilliseconds,
    averageBatchMilliseconds: batchMilliseconds / TICKS,
    profileRuns: { warmup: WARMUP_RUNS, measured: MEASURED_RUNS, ticksPerRun: TICKS },
    phaseMilliseconds,
    phaseShare,
    phaseMillisecondsByRun: runs.map(run => Object.fromEntries(phaseKeys.map(key => [
      key.replace('Milliseconds', ''),
      run.summary[key],
    ]))),
    dominantMeasuredPhase: dominantPhase[0],
    singleHotspotProven: dominantPhase[1] > 0.5,
    tickMilliseconds: {
      median: median(allTickMilliseconds),
      p95: percentile(allTickMilliseconds, 0.95),
      max: Math.max(...allTickMilliseconds),
    },
    displacedActors: first.displacedActors,
    totalDisplacement: first.totalDisplacement,
    totalGoalDistanceReduction: first.totalGoalDistanceReduction,
    actorsApproachingDoor: first.actorsApproachingDoor,
    actorsPassingDoor: first.actorsPassingDoor,
    actorsReachingGoals: first.actorsReachingGoals,
    allCoordinatesFinite: first.allCoordinatesFinite,
    allActorsInsideWorld: first.allActorsInsideWorld,
    minimumInitialSpacing: first.minimumInitialSpacing,
    minimumEndpointSpacing: first.minimumEndpointSpacing,
    minimumEndpointPair: first.minimumEndpointPair,
    minimumSweptSpacing: first.minimumSweptSpacing,
    minimumSweptPair: first.minimumSweptPair,
  }));
} finally {
  await server.close();
}
