import { createServer } from 'vite';

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;
const TICKS = 900;
const EXPECTED_EXECUTABLE_PREFIX_SCORES = 205458;
const EXPECTED_LEGACY_PARENT_NODE_VISITS = 1479314;
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
    calculateInitialPlanningOptimisation,
    runDenseQueueScenario,
    selectRepresentativeDenseQueueRun,
  } = await server.ssrLoadModule('/src/simulation/denseQueueStress.js');
  const {
    createMovementMetrics,
    setExecutablePrefixProfile,
  } = await server.ssrLoadModule('/src/simulation/movementMetrics.js');
  const runMode = (mode, countWork = false) => runDenseQueueScenario({
    ticks: TICKS,
    metrics: setExecutablePrefixProfile(createMovementMetrics(), { mode, countWork }),
  });
  for (let run = 0; run < WARMUP_RUNS; run += 1) {
    runMode('legacy');
    runMode('cached');
  }
  const legacyRuns = [];
  const cachedRuns = [];
  const measuredPairOrder = [];
  for (let pair = 0; pair < MEASURED_RUNS; pair += 1) {
    const modes = pair % 2 === 0 ? ['legacy', 'cached'] : ['cached', 'legacy'];
    measuredPairOrder.push(modes);
    for (const mode of modes) {
      const result = runMode(mode);
      (mode === 'legacy' ? legacyRuns : cachedRuns).push(result);
    }
  }
  const runs = cachedRuns;
  assertDenseQueueDeterministicRuns([...legacyRuns, ...cachedRuns]);

  const legacyWorkRun = runMode('legacy', true);
  const cachedWorkRun = runMode('cached', true);
  const withoutPrefixWork = result => {
    const projection = buildDenseQueueNonTimingProjection(result);
    delete projection.summary.solverExecutablePrefixScores;
    delete projection.summary.solverExecutablePrefixNodeVisits;
    return projection;
  };
  const expectedProjection = JSON.stringify(withoutPrefixWork(cachedRuns[0]));
  if (![legacyWorkRun, cachedWorkRun]
    .every(run => JSON.stringify(withoutPrefixWork(run)) === expectedProjection)) {
    throw new Error('Counter-enabled executable-prefix evidence changed movement or invariants');
  }
  const legacyWork = legacyWorkRun.summary;
  const cachedWork = cachedWorkRun.summary;
  if (legacyWork.solverExecutablePrefixScores !== EXPECTED_EXECUTABLE_PREFIX_SCORES
    || cachedWork.solverExecutablePrefixScores !== EXPECTED_EXECUTABLE_PREFIX_SCORES
    || legacyWork.solverExecutablePrefixNodeVisits !== EXPECTED_LEGACY_PARENT_NODE_VISITS
    || cachedWork.solverExecutablePrefixNodeVisits !== 0) {
    throw new Error('Executable-prefix deterministic work evidence changed');
  }
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
  const baselineInitialPlanningMillisecondsByRun = legacyRuns
    .map(run => run.summary.solverInitialPlanningMilliseconds);
  const optimisedInitialPlanningMillisecondsByRun = runs
    .map(run => run.summary.solverInitialPlanningMilliseconds);
  const initialPlanningOptimisation = calculateInitialPlanningOptimisation({
    baselineMillisecondsByRun: baselineInitialPlanningMillisecondsByRun,
    optimisedMillisecondsByRun: optimisedInitialPlanningMillisecondsByRun,
    requiredImprovement: 0.30,
    parentNodeVisits: cachedWork.solverExecutablePrefixNodeVisits,
  });

  console.log(JSON.stringify({
    ...deterministicProjection.summary,
    batchMilliseconds: representative.summary.batchMilliseconds,
    averageBatchMilliseconds: representative.summary.averageBatchMilliseconds,
    profileRuns: {
      warmupPerMode: WARMUP_RUNS,
      measuredPairs: MEASURED_RUNS,
      ticksPerRun: TICKS,
      measuredPairOrder,
      sameProcess: true,
      prefixWorkCountersEnabledDuringTiming: false,
    },
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
      counterEvidenceRuns: 1,
      countersEnabled: true,
      legacy: {
        scores: legacyWork.solverExecutablePrefixScores,
        parentNodeVisits: legacyWork.solverExecutablePrefixNodeVisits,
      },
      cached: {
        scores: cachedWork.solverExecutablePrefixScores,
        parentNodeVisits: cachedWork.solverExecutablePrefixNodeVisits,
      },
    },
    initialPlanningOptimisation: {
      ...initialPlanningOptimisation,
      baselineMode: 'legacy-reconstructive',
      optimisedMode: 'cached',
      sameProcess: true,
      interleavedPairs: true,
      prefixWorkCountersEnabledDuringTiming: false,
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
