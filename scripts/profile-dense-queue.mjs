import { createServer } from 'vite';

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;
const TICKS = 900;
const TASK_1_INITIAL_PLANNING_MILLISECONDS = [
  556.0645100000002,
  522.5600380000028,
  559.5139229999995,
  521.1914290000027,
  515.3672089999982,
];
const phaseKeys = [
  'pairBuildMilliseconds',
  'localConflictMilliseconds',
  'safePrefixMilliseconds',
  'dynamicRepathMilliseconds',
  'staticRepathMilliseconds',
  'residualBatchMilliseconds',
];
const localConflictKeys = [
  'localConflictPreparationMilliseconds',
  'localConflictSolverMilliseconds',
  'localConflictCandidateMilliseconds',
  'localConflictSafetyMilliseconds',
  'localConflictFallbackMilliseconds',
  'localConflictResidualMilliseconds',
];
const solverKeys = [
  'solverInitialPlanningMilliseconds',
  'solverNodeBuildMilliseconds',
  'solverFrontierOrderingMilliseconds',
  'solverReplanningMilliseconds',
  'solverAgedFallbackMilliseconds',
  'solverResidualMilliseconds',
];
const eligibleLocalConflictLeafKeys = localConflictKeys
  .filter(key => key !== 'localConflictSolverMilliseconds');
const eligibleLeafKeys = [...eligibleLocalConflictLeafKeys, ...solverKeys];

function name(key) {
  return key.replace('Milliseconds', '');
}

function phaseValues(summary, keys) {
  return Object.fromEntries(keys.map(key => [name(key), summary[key]]));
}

function breakdown(summary, keys, outerKey) {
  const milliseconds = phaseValues(summary, keys);
  const outer = summary[outerKey];
  const total = Object.values(milliseconds).reduce((sum, value) => sum + value, 0);
  const difference = outer - total;
  return {
    milliseconds,
    shares: Object.fromEntries(Object.entries(milliseconds).map(([key, value]) => [
      key,
      outer === 0 ? 0 : value / outer,
    ])),
    accounting: { total, outer, difference, reconciles: Math.abs(difference) <= 1e-6 },
  };
}

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
  const localConflictBreakdown = breakdown(
    representative.summary, localConflictKeys, 'localConflictMilliseconds',
  );
  const solverBreakdown = breakdown(
    representative.summary, solverKeys, 'localConflictSolverMilliseconds',
  );
  const eligibleLeafOrderingByRun = runs.map(run => eligibleLeafKeys
    .map(key => ({ key: name(key), milliseconds: run.summary[key] }))
    .sort((left, right) => right.milliseconds - left.milliseconds));
  const largestEligibleLeafByRun = eligibleLeafOrderingByRun.map(ordering => ordering[0].key);
  const consistentlyLargestEligibleLeaf = largestEligibleLeafByRun
    .every(key => key === largestEligibleLeafByRun[0]);
  const representativeEligibleLeafShare = eligibleLeafOrderingByRun[representativeRunIndex][0].milliseconds
    / representative.summary.localConflictMilliseconds;
  const eligibleLeafMajority = representativeEligibleLeafShare > 0.5;
  const nestedAccountingReconciles = localConflictBreakdown.accounting.reconciles
    && solverBreakdown.accounting.reconciles;
  const innerHotspotProven = consistentlyLargestEligibleLeaf
    && eligibleLeafMajority
    && nestedAccountingReconciles;
  const initialPlanningMillisecondsByRun = runs
    .map(run => run.summary.solverInitialPlanningMilliseconds);
  const baselineInitialPlanningMedian = median(TASK_1_INITIAL_PLANNING_MILLISECONDS);
  const optimisedInitialPlanningMedian = median(initialPlanningMillisecondsByRun);
  const initialPlanningImprovement = (baselineInitialPlanningMedian
    - optimisedInitialPlanningMedian) / baselineInitialPlanningMedian;
  const parentNodeVisits = representative.summary.solverExecutablePrefixNodeVisits;
  const performanceAccepted = parentNodeVisits === 0 && initialPlanningImprovement >= 0.30;

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
    localConflictBreakdown,
    solverBreakdown,
    localConflictMillisecondsByRun: runs.map(run => phaseValues(run.summary, localConflictKeys)),
    solverMillisecondsByRun: runs.map(run => phaseValues(run.summary, solverKeys)),
    executablePrefixWork: {
      scores: representative.summary.solverExecutablePrefixScores,
      parentNodeVisits,
      scoresByRun: runs.map(run => run.summary.solverExecutablePrefixScores),
      parentNodeVisitsByRun: runs.map(run => run.summary.solverExecutablePrefixNodeVisits),
    },
    initialPlanningOptimisation: {
      baselineMillisecondsByRun: TASK_1_INITIAL_PLANNING_MILLISECONDS,
      baselineMedianMilliseconds: baselineInitialPlanningMedian,
      optimisedMillisecondsByRun: initialPlanningMillisecondsByRun,
      optimisedMedianMilliseconds: optimisedInitialPlanningMedian,
      improvement: initialPlanningImprovement,
      requiredImprovement: 0.30,
      parentNodeVisits,
      performanceAccepted,
    },
    eligibleLeafOrderingByRun,
    innerHotspotCriterion: {
      largestEligibleLeafByRun,
      consistentlyLargestEligibleLeaf,
      representativeEligibleLeaf: largestEligibleLeafByRun[representativeRunIndex],
      representativeEligibleLeafShare,
      eligibleLeafMajority,
      nestedAccountingReconciles,
    },
    innerHotspotProven,
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
