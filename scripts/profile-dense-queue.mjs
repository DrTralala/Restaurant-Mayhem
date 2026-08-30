import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isExtensionlessRelativeImport = error.code === 'ERR_MODULE_NOT_FOUND'
        && /^\.\.?(?:\/|$)/.test(specifier)
        && !specifier.endsWith('.js');
      if (isExtensionlessRelativeImport) return nextResolve(`${specifier}.js`, context);
      throw error;
    }
  },
});

const { createMovementMetrics } = await import('../src/simulation/movementMetrics.js');
const { runDenseQueueScenario } = await import('../src/simulation/denseQueueStress.js');

const metrics = createMovementMetrics();
const result = runDenseQueueScenario({ ticks: 900, metrics });
const sortedTickMilliseconds = [...result.tickMilliseconds].sort((left, right) => left - right);
const middle = sortedTickMilliseconds.length / 2;
const median = sortedTickMilliseconds.length % 2 === 0
  ? (sortedTickMilliseconds[middle - 1] + sortedTickMilliseconds[middle]) / 2
  : sortedTickMilliseconds[Math.floor(middle)];
const p95 = sortedTickMilliseconds[Math.ceil(sortedTickMilliseconds.length * 0.95) - 1];

console.log(JSON.stringify({
  ...result.summary,
  tickMilliseconds: {
    median,
    p95,
    max: sortedTickMilliseconds.at(-1),
  },
  progressedActors: result.progressedActors,
  allCoordinatesFinite: result.allCoordinatesFinite,
  allActorsInsideWorld: result.allActorsInsideWorld,
  minimumEndpointSpacing: result.minimumEndpointSpacing,
  minimumSweptSpacing: result.minimumSweptSpacing,
}));
