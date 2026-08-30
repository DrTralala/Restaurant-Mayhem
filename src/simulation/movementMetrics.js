const executablePrefixProfiles = new WeakMap();

export function setExecutablePrefixProfile(metrics, {
  mode = 'cached',
  countWork = true,
} = {}) {
  if (mode !== 'cached' && mode !== 'legacy') {
    throw new Error(`Unknown executable-prefix profile mode: ${mode}`);
  }
  executablePrefixProfiles.set(metrics, { mode, countWork });
  return metrics;
}

export function getExecutablePrefixProfile(metrics) {
  return executablePrefixProfiles.get(metrics) || null;
}

export function createMovementMetrics() {
  return {
    batches: 0,
    batchMilliseconds: 0,
    pairBuildMilliseconds: 0,
    localConflictMilliseconds: 0,
    localConflictPreparationMilliseconds: 0,
    localConflictSolverMilliseconds: 0,
    localConflictCandidateMilliseconds: 0,
    localConflictSafetyMilliseconds: 0,
    localConflictFallbackMilliseconds: 0,
    localConflictResidualMilliseconds: 0,
    solverInitialPlanningMilliseconds: 0,
    solverNodeBuildMilliseconds: 0,
    solverFrontierOrderingMilliseconds: 0,
    solverReplanningMilliseconds: 0,
    solverAgedFallbackMilliseconds: 0,
    solverResidualMilliseconds: 0,
    safePrefixMilliseconds: 0,
    dynamicRepathMilliseconds: 0,
    staticRepathMilliseconds: 0,
    residualBatchMilliseconds: 0,
    pairChecks: 0,
    conflictPairs: 0,
    conflictBatches: 0,
    components: 0,
    maxComponentSize: 0,
    solverCalls: 0,
    solverPbs: 0,
    solverAgedFallback: 0,
    solverNull: 0,
    solverNodePops: 0,
    localConflictAttempts: 0,
    localConflictProgressAccepts: 0,
    localConflictSafetyFallbacks: 0,
    spaceTimePlanCalls: 0,
    spaceTimeExpandedStates: 0,
    solverExecutablePrefixScores: 0,
    solverExecutablePrefixNodeVisits: 0,
    solverNodesBuilt: 0,
    solverBranchesGenerated: 0,
    safePrefixProbes: 0,
    dynamicRepaths: 0,
    staticRepaths: 0,
  };
}

export function summariseMovementMetrics(metrics) {
  return {
    batches: metrics.batches,
    batchMilliseconds: metrics.batchMilliseconds,
    averageBatchMilliseconds: metrics.batchMilliseconds / Math.max(1, metrics.batches),
    pairBuildMilliseconds: metrics.pairBuildMilliseconds,
    localConflictMilliseconds: metrics.localConflictMilliseconds,
    localConflictPreparationMilliseconds: metrics.localConflictPreparationMilliseconds,
    localConflictSolverMilliseconds: metrics.localConflictSolverMilliseconds,
    localConflictCandidateMilliseconds: metrics.localConflictCandidateMilliseconds,
    localConflictSafetyMilliseconds: metrics.localConflictSafetyMilliseconds,
    localConflictFallbackMilliseconds: metrics.localConflictFallbackMilliseconds,
    localConflictResidualMilliseconds: metrics.localConflictResidualMilliseconds,
    solverInitialPlanningMilliseconds: metrics.solverInitialPlanningMilliseconds,
    solverNodeBuildMilliseconds: metrics.solverNodeBuildMilliseconds,
    solverFrontierOrderingMilliseconds: metrics.solverFrontierOrderingMilliseconds,
    solverReplanningMilliseconds: metrics.solverReplanningMilliseconds,
    solverAgedFallbackMilliseconds: metrics.solverAgedFallbackMilliseconds,
    solverResidualMilliseconds: metrics.solverResidualMilliseconds,
    safePrefixMilliseconds: metrics.safePrefixMilliseconds,
    dynamicRepathMilliseconds: metrics.dynamicRepathMilliseconds,
    staticRepathMilliseconds: metrics.staticRepathMilliseconds,
    residualBatchMilliseconds: metrics.residualBatchMilliseconds,
    pairChecks: metrics.pairChecks,
    conflictPairs: metrics.conflictPairs,
    conflictBatches: metrics.conflictBatches,
    components: metrics.components,
    maxComponentSize: metrics.maxComponentSize,
    solverCalls: metrics.solverCalls,
    solverPbs: metrics.solverPbs,
    solverAgedFallback: metrics.solverAgedFallback,
    solverNull: metrics.solverNull,
    solverNodePops: metrics.solverNodePops,
    localConflictAttempts: metrics.localConflictAttempts,
    localConflictProgressAccepts: metrics.localConflictProgressAccepts,
    localConflictSafetyFallbacks: metrics.localConflictSafetyFallbacks,
    spaceTimePlanCalls: metrics.spaceTimePlanCalls,
    spaceTimeExpandedStates: metrics.spaceTimeExpandedStates,
    solverExecutablePrefixScores: metrics.solverExecutablePrefixScores,
    solverExecutablePrefixNodeVisits: metrics.solverExecutablePrefixNodeVisits,
    solverNodesBuilt: metrics.solverNodesBuilt,
    solverBranchesGenerated: metrics.solverBranchesGenerated,
    safePrefixProbes: metrics.safePrefixProbes,
    dynamicRepaths: metrics.dynamicRepaths,
    staticRepaths: metrics.staticRepaths,
  };
}
