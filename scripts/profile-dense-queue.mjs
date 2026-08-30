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

const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const {
    assertDenseQueueDeterministicRuns,
    buildDenseQueueNonTimingProjection,
    runDenseQueueScenario,
    selectRepresentativeDenseQueueRun,
  } = await server.ssrLoadModule('/src/simulation/denseQueueStress.js');
  for (let run = 0; run < WARMUP_RUNS; run += 1) runDenseQueueScenario({ ticks: TICKS });
  const runs = Array.from({ length: MEASURED_RUNS }, () => runDenseQueueScenario({ ticks: TICKS }));
  assertDenseQueueDeterministicRuns(runs);
  const { run: representative, index: representativeRunIndex } = selectRepresentativeDenseQueueRun(runs);
  const deterministicProjection = buildDenseQueueNonTimingProjection(representative);
  const phaseMilliseconds = Object.fromEntries(phaseKeys.map(key => [
    key.replace('Milliseconds', ''),
    representative.summary[key],
  ]));
  const measuredPhaseTotal = Object.values(phaseMilliseconds)
    .reduce((total, milliseconds) => total + milliseconds, 0);
  const phaseShare = Object.fromEntries(Object.entries(phaseMilliseconds).map(([key, milliseconds]) => [
    key,
    milliseconds / representative.summary.batchMilliseconds,
  ]));
  const dominantPhase = Object.entries(phaseShare)
    .sort((left, right) => right[1] - left[1])[0];
  const phaseShareTotal = Object.values(phaseShare).reduce((total, share) => total + share, 0);
  const accountingDifference = representative.summary.batchMilliseconds - measuredPhaseTotal;
  const allTickMilliseconds = runs.flatMap(run => run.tickMilliseconds);

  console.log(JSON.stringify({
    ...deterministicProjection.summary,
    batchMilliseconds: representative.summary.batchMilliseconds,
    averageBatchMilliseconds: representative.summary.averageBatchMilliseconds,
    profileRuns: { warmup: WARMUP_RUNS, measured: MEASURED_RUNS, ticksPerRun: TICKS },
    representativeRunIndex,
    batchMillisecondsByRun: runs.map(run => run.summary.batchMilliseconds),
    phaseMilliseconds,
    phaseShare,
    phaseShareTotal,
    phaseAccounting: {
      measuredPhaseTotal,
      batchMilliseconds: representative.summary.batchMilliseconds,
      difference: accountingDifference,
      reconciles: Math.abs(accountingDifference) <= 1e-6,
    },
    phaseMillisecondsByRun: runs.map(run => Object.fromEntries(phaseKeys.map(key => [
      key.replace('Milliseconds', ''),
      run.summary[key],
    ]))),
    dominantMeasuredPhase: dominantPhase[0],
    dominantPhaseMajority: dominantPhase[1] > 0.5,
    singleHotspotProven: false,
    deterministicProjectionCompared: true,
    tickMilliseconds: {
      median: median(allTickMilliseconds),
      p95: percentile(allTickMilliseconds, 0.95),
      max: Math.max(...allTickMilliseconds),
    },
    displacedActors: representative.displacedActors,
    totalDisplacement: representative.totalDisplacement,
    totalGoalDistanceReduction: representative.totalGoalDistanceReduction,
    actorsApproachingDoor: representative.actorsApproachingDoor,
    actorsPassingDoor: representative.actorsPassingDoor,
    actorsReachingGoals: representative.actorsReachingGoals,
    actorsCompletingDoorRoutes: representative.actorsCompletingDoorRoutes,
    doorDensityRadius: representative.doorDensityRadius,
    doorCorridorBounds: representative.doorCorridorBounds,
    maximumNearDoorActors: representative.maximumNearDoorActors,
    meanNearDoorActors: representative.meanNearDoorActors,
    ticksWithAtLeastEightNearDoorActors: representative.ticksWithAtLeastEightNearDoorActors,
    maximumDoorCorridorActors: representative.maximumDoorCorridorActors,
    meanDoorCorridorActors: representative.meanDoorCorridorActors,
    ticksWithAtLeastFourDoorCorridorActors: representative.ticksWithAtLeastFourDoorCorridorActors,
    ticksWithConflicts: representative.ticksWithConflicts,
    ticksWithConflictComponents: representative.ticksWithConflictComponents,
    allCoordinatesFinite: representative.allCoordinatesFinite,
    allActorsInsideWorld: representative.allActorsInsideWorld,
    minimumInitialSpacing: representative.minimumInitialSpacing,
    minimumEndpointSpacing: representative.minimumEndpointSpacing,
    minimumEndpointPair: representative.minimumEndpointPair,
    minimumSweptSpacing: representative.minimumSweptSpacing,
    minimumSweptPair: representative.minimumSweptPair,
  }));
} finally {
  await server.close();
}
