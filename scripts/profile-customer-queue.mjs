import { createServer } from 'vite';

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;
const CYCLES = 8;
const MOVEMENT_DT = 0.1;

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

function nonTimingProjection(result) {
  const { tickMilliseconds: _tickMilliseconds, ...projection } = result;
  return projection;
}

const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { runCustomerQueueStressScenario } = await server.ssrLoadModule(
    '/src/simulation/customerQueueStress.js',
  );
  const run = () => runCustomerQueueStressScenario({
    cycles: CYCLES,
    movementDt: MOVEMENT_DT,
  });

  for (let warmup = 0; warmup < WARMUP_RUNS; warmup += 1) run();
  const measuredRuns = Array.from({ length: MEASURED_RUNS }, run);
  const expectedProjection = JSON.stringify(nonTimingProjection(measuredRuns[0]));
  if (!measuredRuns.every(result =>
    JSON.stringify(nonTimingProjection(result)) === expectedProjection)) {
    throw new Error('Customer queue non-timing results changed between measured runs');
  }

  const representative = measuredRuns[0];
  const completedParties = representative.completedPartyIds.length;
  const accepted = completedParties === CYCLES
    && new Set(representative.completedPartyIds).size === CYCLES
    && representative.queuedMemberMovementEntries === 0
    && representative.maximumGateOwners === 1
    && JSON.stringify(representative.gateOwnerPartyIds)
      === JSON.stringify(representative.completedPartyIds)
    && representative.arrivalsResumed === true
    && representative.minimumSpacing >= 16 - 1e-6
    && representative.allCoordinatesFinite === true;
  if (!accepted) {
    throw new Error('Customer queue deterministic acceptance fields failed');
  }

  const allTickMilliseconds = measuredRuns.flatMap(result => result.tickMilliseconds);
  console.log(JSON.stringify({
    cycles: representative.cycles,
    ticks: representative.ticks,
    completedParties,
    queuedMemberMovementEntries: representative.queuedMemberMovementEntries,
    maximumGateOwners: representative.maximumGateOwners,
    maximumMovementActors: representative.maximumMovementActors,
    minimumSpacing: representative.minimumSpacing,
    arrivalsResumed: representative.arrivalsResumed,
    medianTickMilliseconds: median(allTickMilliseconds),
    p95TickMilliseconds: percentile(allTickMilliseconds, 0.95),
    maximumTickMilliseconds: Math.max(...allTickMilliseconds),
  }));
} finally {
  await server.close();
}
