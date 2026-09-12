import { describe, expect, it } from 'vitest';
import {
  buildDenseQueueNonTimingProjection,
  buildDenseQueueScenario,
  runDenseQueueScenario,
} from './denseQueueStress';
import { minimumTrajectoryDistance } from './movement/trajectory';
import { isInsideWorld, worldToCell } from './pathfinding';

describe('cooperative dense queue stress', () => {
  it('preserves all original starts, destinations and speeds without route fixtures', () => {
    const { entries } = buildDenseQueueScenario();
    expect(entries).toHaveLength(24);
    expect(entries.slice(0, 20).map(({ character }) => [character.x, character.y])).toEqual([
      [1020, 60], [1020, 160], [1020, 260], [1020, 360], [1020, 460],
      [1020, 560], [980, 620], [980, 520], [980, 420], [980, 320],
      [1000, 60], [1000, 160], [1000, 260], [1000, 360], [1000, 460],
      [1000, 560], [960, 620], [960, 520], [960, 420], [960, 320],
    ]);
    expect(entries.slice(20).map(({ character }) => [character.x, character.y]))
      .toEqual([[540, 360], [640, 360], [740, 360], [840, 360]]);
    for (const entry of entries) {
      expect(entry.character.navigationGoal).toEqual(entry.goal);
      expect(entry.speed).toBe(60);
      for (const key of ['path', 'pathGoal', 'stalledFor', 'usingStaticFallback']) {
        expect(entry.character).not.toHaveProperty(key);
      }
    }
  });

  it('records persistent cooperative schedules, counters and structured local timing', () => {
    const first = runDenseQueueScenario({ ticks: 2 });
    expect(first.tickRecords).toHaveLength(2);
    expect(first.tickRecords[1].timeStart).toBe(first.tickRecords[0].timeEnd);
    expect(first.summary.batches).toBe(2);
    expect(first.tickRecords[0].counters.plannerExpansions).toBeGreaterThan(0);
    expect(first.tickRecords[1].counters).toEqual(buildDenseQueueNonTimingProjection(first).summary);
    expect(first.timings.ticks).toHaveLength(2);
    const changedTiming = structuredClone(first);
    changedTiming.timings.ticks[0] += 100;
    changedTiming.summary.plannerMilliseconds += 100;
    expect(buildDenseQueueNonTimingProjection(changedTiming))
      .toEqual(buildDenseQueueNonTimingProjection(first));
    changedTiming.tickRecords[0].expansionsThisTick += 1;
    expect(buildDenseQueueNonTimingProjection(changedTiming))
      .not.toEqual(buildDenseQueueNonTimingProjection(first));
  });

  it('completes all 24 unchanged door movements by 900 ticks with strict independent safety scans', () => {
    const first = runDenseQueueScenario({ ticks: 900 });
    const { state } = buildDenseQueueScenario();
    // Scan safety before liveness so a failed completion cannot hide unsafe motion.
    expect(first.tickRecords).toHaveLength(900);
    for (const tick of first.tickRecords) {
      expect(tick.expansionsThisTick).toBeLessThanOrEqual(2048);
      expect(tick.actorQuanta.every(value => value <= 256)).toBe(true);
      for (const actor of tick.actors) {
        expect(Number.isFinite(actor.end.x) && Number.isFinite(actor.end.y)).toBe(true);
        expect(isInsideWorld(state, worldToCell(actor.end))).toBe(true);
        for (const segment of actor.trajectory) {
          expect([segment.start.x, segment.start.y, segment.end.x, segment.end.y,
            segment.startTime, segment.endTime].every(Number.isFinite)).toBe(true);
        }
        expect(actor.trajectory[0].startTime).toBe(0);
        expect(actor.trajectory.at(-1).endTime).toBe(1);
        const distance = actor.trajectory.reduce((sum, segment) => sum + Math.hypot(
          segment.end.x - segment.start.x, segment.end.y - segment.start.y,
        ), 0);
        expect(distance).toBeLessThanOrEqual(actor.speed * tick.dt + 1e-6);
        expect(Math.hypot(actor.end.x - actor.start.x, actor.end.y - actor.start.y))
          .toBeLessThanOrEqual(actor.speed * tick.dt + 1e-6);
        if (distance > 0) expect(actor.executedInstalledSchedule).toBe(true);
        if (actor.end.x === actor.goal.x && actor.end.y === actor.goal.y) {
          expect(actor.status.plan).toBe('arrived');
        }
      }
      for (let left = 0; left < tick.actors.length; left += 1) {
        for (const right of tick.actors.slice(left + 1)) {
          const actor = tick.actors[left];
          expect(minimumTrajectoryDistance(actor.occupiedTrajectory, right.occupiedTrajectory))
            .toBeGreaterThanOrEqual(16);
          if (actor.occupiesEnd && right.occupiesEnd) {
            expect(Math.hypot(actor.end.x - right.end.x, actor.end.y - right.end.y))
              .toBeGreaterThanOrEqual(16);
          }
        }
      }
    }
    expect(first.allCoordinatesFinite).toBe(true);
    expect(first.allActorsInsideWorld).toBe(true);
    expect(first.navigationVersion).toBe(1);
    expect(first.summary.plannerExpansions).toBeGreaterThan(0);
    expect(first.maximumActorQuantum).toBeLessThanOrEqual(256);
    expect(first.minimumInitialSpacing).toBeGreaterThanOrEqual(16);
    expect(first.displacedActors).toBe(24);
    expect(first.actorsPassingDoor).toBe(24);
    expect(first.actorsCompletingDoorRoutes).toBe(24);
    expect(first.completionOrder).toHaveLength(24);
    expect(new Set(first.completionOrder).size).toBe(24);
    const second = runDenseQueueScenario({ ticks: 900 });
    expect(second.completionOrder).toEqual(first.completionOrder);
    expect(buildDenseQueueNonTimingProjection(second)).toEqual(buildDenseQueueNonTimingProjection(first));
  }, 120_000);
});
