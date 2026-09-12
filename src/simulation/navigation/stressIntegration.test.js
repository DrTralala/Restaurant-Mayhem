import { expect, it } from 'vitest';
import { runDenseQueueScenario } from '../denseQueueStress';
import { runCustomerQueueStressScenario } from '../customerQueueStress';

it('profiles dense traffic through the replacement coordinator', () => {
  const result = runDenseQueueScenario({ ticks: 2 });
  expect(result.navigationVersion).toBe(1);
  expect(result.allMovementScheduled).toBe(true);
});

it('profiles a complete customer admission cycle through the replacement coordinator', () => {
  const result = runCustomerQueueStressScenario({ cycles: 1, movementDt: 1 / 30 });
  expect(result.navigationVersion).toBe(1);
  expect(result.completedPartyIds).toHaveLength(1);
  expect(result.allMovementScheduled).toBe(true);
}, 30000);
