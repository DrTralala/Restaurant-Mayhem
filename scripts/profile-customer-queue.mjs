import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describeMilliseconds } from './profile-dense-queue.mjs';

const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, watch: null },
});
try {
  const { runCustomerQueueStressScenario, buildCustomerQueueNonTimingProjection } = await server.ssrLoadModule(
    '/src/simulation/customerQueueStress.js',
  );
  const run = () => runCustomerQueueStressScenario({ cycles: 8, movementDt: 0.1 });
  run(); // One warm-up, followed by five measured runs.
  const runs = Array.from({ length: 5 }, run);
  const projection = buildCustomerQueueNonTimingProjection(runs[0]);
  const deterministic = runs.every(result => JSON.stringify(buildCustomerQueueNonTimingProjection(result))
    === JSON.stringify(projection));
  const workload = runs.every(result => result.completedPartyIds.length === 8
    && new Set(result.completedPartyIds).size === 8 && result.queuedMemberMovementEntries === 0
    && result.maximumGateOwners === 1 && result.maximumMovementActors === 5
    && JSON.stringify(result.gateOwnerPartyIds) === JSON.stringify(result.completedPartyIds)
    && result.arrivalsResumed === true && result.replacementPartyIds.length === 8
    && new Set(result.replacementPartyIds).size === 8 && result.minimumSpacing >= 16
    && result.allCoordinatesFinite === true && result.allMovementScheduled === true
    && result.allWithinSpeedBudget === true && result.maxExpansionsPerTick <= 2048
    && result.maximumGroupQuantum <= 256 && result.summary.invariantFailures === 0);
  const representative = runs[0];
  console.log(JSON.stringify({
    warmups: 1, runs: 5, cycles: representative.cycles,
    completedParties: representative.completedPartyIds.length, ticks: representative.ticks,
    arrivalsResumed: representative.arrivalsResumed, minimumSpacing: representative.minimumSpacing,
    maximumMovementActors: representative.maximumMovementActors,
    counters: projection.summary,
    maxExpansionsPerTick: representative.maxExpansionsPerTick,
    maximumGroupQuantum: representative.maximumGroupQuantum,
    batchMilliseconds: describeMilliseconds(runs.map(result => result.summary.batchMilliseconds)),
    tickMilliseconds: describeMilliseconds(runs.flatMap(result => result.timings.ticks)),
    phaseMilliseconds: Object.fromEntries(['planner', 'executor'].map(phase => [phase,
      describeMilliseconds(runs.map(result => result.summary[`${phase}Milliseconds`]))])),
    acceptance: { deterministic, workload }, accepted: deterministic && workload,
    projection,
  }, null, 2));
  if (!deterministic || !workload) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  if (error.evidence) console.error(JSON.stringify(error.evidence));
  process.exitCode = 1;
} finally {
  await server.close();
}
