import { describe, expect, it } from 'vitest';
import { advanceCharacterMovementBatch } from './coordinator';
import { recordStressTick } from './stressDiagnostics';
import { createMovementMetrics } from '../movementMetrics';

function fixture() {
  const character = { id: 'a', x: 400, y: 300, navigationGoal: { x: 420, y: 320 } };
  const state = { restaurant: { expansionLevel: 1 }, staff: [character], customers: [], tables: [], chairs: [] };
  const entries = [{ character, speed: 60 }];
  const metrics = createMovementMetrics();
  return { state, entries, metrics, result: advanceCharacterMovementBatch(state, entries, 1, metrics) };
}
const record = f => recordStressTick(f.state, f.entries, f.result, 1, f.metrics);

describe('replacement reservation execution diagnostics', () => {
  it('verifies real executed prefixes including the occupied terminal hold', () => {
    const tick = record(fixture());
    expect(tick.allMovementScheduled).toBe(true);
    expect(tick.allWithinSpeedBudget).toBe(true);
    expect(tick.actors[0].occupiesEnd).toBe(true);
    expect(tick.actors[0].trajectory.length).toBeGreaterThanOrEqual(3);
  });
  it.each(['endpoint', 'actor-start', 'trajectory-start', 'corner', 'timing', 'shortcut', 'hold-tail'])('rejects %s corruption independently of the speed bound', corruption => {
    const f = fixture();
    const trajectory = f.result.trajectories.get('a');
    if (corruption === 'endpoint') f.result.moved.get('a').x += 1;
    if (corruption === 'actor-start') f.entries[0].character.x += 1;
    if (corruption === 'trajectory-start') trajectory[0].start.x += 1;
    if (corruption === 'corner') { trajectory[0].end.x += 1; trajectory[1].start.x += 1; }
    if (corruption === 'timing') { trajectory[0].endTime += 0.01; trajectory[1].startTime += 0.01; }
    if (corruption === 'shortcut') trajectory.splice(0, 2, { ...trajectory[0], end: trajectory[1].end, endTime: trajectory[1].endTime });
    if (corruption === 'hold-tail') {
      const tail = trajectory.pop();
      const middle = { x: tail.start.x + 1, y: tail.start.y };
      trajectory.push({ ...tail, end: middle, endTime: (tail.startTime + 1) / 2 },
        { ...tail, start: middle, startTime: (tail.startTime + 1) / 2 });
    }
    expect(record(f).allWithinSpeedBudget).toBe(true);
    expect(record(f).allMovementScheduled).toBe(false);
  });
  it('does not use collision exemptions or an arrived label to hide occupied endpoints', () => {
    const f = fixture();
    const peer = { id: 'b', x: 450, y: 320 };
    f.entries.push({ character: peer, speed: 0, ignoredIds: ['a'] });
    f.result.moved.set('b', { ...peer, x: 421 });
    f.result.statuses.set('b', { plan: 'arrived', motion: 'holding' });
    f.result.trajectories.set('b', [{ start: peer, end: peer, startTime: 0, endTime: 1 }]);
    expect(record(f).minimumEndpointSpacing).toBe(1);
    expect(record(f).allWithinSpeedBudget).toBe(false);
  });
});
