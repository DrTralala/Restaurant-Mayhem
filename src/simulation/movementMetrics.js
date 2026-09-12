const metricKeys = [
  'batches',
  'plannerExpansions',
  'episodes',
  'schedulesInstalled',
  'schedulesReused',
  'fastPassAttempts',
  'fastPassSuccesses',
  'exactPassSuccesses',
  'groupsCreated',
  'groupsMerged',
  'preparedMemberReuses',
  'lowLevelNodesExpanded',
  'highLevelNodesExpanded',
  'safeIntervalSuccessors',
  'continuousConflicts',
  'reverseCacheBuilds',
  'reverseCacheHits',
  'pendingTicks',
  'peakPlannerFrontier',
  // User-approved telemetry amendment: maximum per-group retained SIPP/CBS
  // node-record count at batch boundaries, not reachable Map/Set entries.
  // Includes stale heap and active CBS nodes; excludes geometry/cache/payloads.
  'peakRetainedNodes',
  'peakGroupSize',
  'invalidationsGoal',
  'invalidationsSpeed',
  'invalidationsExemptions',
  'invalidationsParticipants',
  'invalidationsPosition',
  'invalidationsStationary',
  'invalidationsTopology',
  'invalidationsExecution',
  'unreachable',
  'unschedulable',
  'invariantFailures',
  'installedSubtractions',
  'staticGridBuilds',
  'staticGridReuses',
  'installedValidationBuilds',
  'installedValidationReuses',
  'batchMilliseconds',
  'plannerMilliseconds',
  'executorMilliseconds',
];

export function createMovementMetrics() {
  return Object.fromEntries(metricKeys.map(key => [key, 0]));
}

export function summariseMovementMetrics(metrics) {
  const summary = {
    batches: metrics.batches,
    batchMilliseconds: metrics.batchMilliseconds,
    averageBatchMilliseconds: metrics.batchMilliseconds / Math.max(1, metrics.batches),
  };
  for (const key of metricKeys.slice(1, -3)) summary[key] = metrics[key];
  summary.plannerMilliseconds = metrics.plannerMilliseconds;
  summary.executorMilliseconds = metrics.executorMilliseconds;
  return summary;
}
