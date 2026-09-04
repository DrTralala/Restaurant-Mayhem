/** Compatibility façade for the decomposed movement kernel. */
export {
  clearMovementRecoveryMetadata,
  ensureStaffRuntime,
  hasArrived,
  moveCharacterAlongPath,
  moveCharacterTowards,
  moveCharacterWithRecovery,
  moveStaffAlongPath,
  planCharacterPath,
} from './movement/pathMotion';
export {
  buildTimeParameterizedTrajectory,
  coincidentStartTrajectoriesSeparateSafely,
  minimumSweptDistance,
  minimumTrajectoryDistance,
} from './movement/trajectory';
export {
  resolveCharacterMovementBatch,
  resolveCharacterMovementBatchWithDiagnostics,
} from './movement/batchResolver';
export { solveLocalConflictWithMovementMetrics } from './localConflict/solver';
