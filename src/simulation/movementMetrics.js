export function createMovementMetrics() {
  return {
    batches: 0,
    batchMilliseconds: 0,
    pairChecks: 0,
    conflictPairs: 0,
    components: 0,
    maxComponentSize: 0,
    solverCalls: 0,
    solverPbs: 0,
    solverAgedFallback: 0,
    solverNull: 0,
    solverNodePops: 0,
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
    pairChecks: metrics.pairChecks,
    conflictPairs: metrics.conflictPairs,
    components: metrics.components,
    maxComponentSize: metrics.maxComponentSize,
    solverCalls: metrics.solverCalls,
    solverPbs: metrics.solverPbs,
    solverAgedFallback: metrics.solverAgedFallback,
    solverNull: metrics.solverNull,
    solverNodePops: metrics.solverNodePops,
    safePrefixProbes: metrics.safePrefixProbes,
    dynamicRepaths: metrics.dynamicRepaths,
    staticRepaths: metrics.staticRepaths,
  };
}
