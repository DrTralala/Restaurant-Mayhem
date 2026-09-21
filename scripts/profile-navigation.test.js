import { describe, expect, it } from 'vitest';
import {
  deterministicProjection,
  parseProfileArguments,
  sampleSummary,
} from './profile-navigation.mjs';

describe('navigation profiler contracts', () => {
  it('validates profile arguments and normalises accepted values', () => {
    expect(parseProfileArguments([
      '--root=.', '--speed=2', '--ticks=3', '--runs=2', '--mode=edited',
    ])).toMatchObject({ speed: 2, ticks: 3, runs: 2, mode: 'edited' });

    for (const argument of [
      '--unknown=value', '--speed=3', '--ticks=1', '--runs=0', '--mode=invalid',
    ]) {
      expect(() => parseProfileArguments([argument])).toThrow(/Invalid profile argument|Invalid profile options/);
    }
  });

  it('projects stable notification content and runtime diagnostics without wall time', () => {
    const projected = deterministicProjection({
      notifications: [{ id: 'notification-123', time: 987654, message: 'Milestone reached' }],
      restaurant: { gameTime: 12 },
    }, {
      movementCoordinator: {
        tick: 4,
        elapsedMovementSeconds: 1.5,
        statuses: new Map([['worker', {
          plan: 'waiting', motion: 'holding', reason: 'traffic', blockers: ['peer'],
          waitingSeconds: 2.25,
        }]]),
        records: new Map([['worker', {
          goal: { x: 200, y: 100 }, routeGoal: { x: 200, y: 100 },
          waitingSeconds: 2.25, lastMovedAt: 0.5,
        }]]),
        diagnostics: {
          expansionsThisTick: 12,
          actorExpansions: new Map([['worker', 12]]),
          invariantFailure: null,
          unsafeActors: [],
        },
      },
      navigationPreflight: {
        entries: new Map([['query', { status: 'pending', lastFrame: 4 }]]),
      },
    });

    expect(projected.notifications).toEqual([{ message: 'Milestone reached' }]);
    expect(projected.navigationRuntime.statuses).toEqual([
      ['worker', {
        plan: 'waiting', motion: 'holding', reason: 'traffic', blockers: ['peer'],
        waitingSeconds: 2.25,
      }],
    ]);
    expect(projected.navigationRuntime.records[0][1].waitingSeconds).toBe(2.25);
    expect(projected.navigationRuntime.diagnostics.expansionsThisTick).toBe(12);
    expect(projected.navigationRuntime.preflight).toEqual([
      ['query', { status: 'pending', lastFrame: 4 }],
    ]);
    expect(JSON.stringify(projected)).not.toContain('tickMilliseconds');
    expect(JSON.stringify(projected)).not.toContain('987654');
  });

  it('summarises raw timings, counters, and observed cache classes separately', () => {
    const summary = sampleSummary([
      { tickMilliseconds: 4, counters: { routeExpansions: 2 }, cacheClass: 'miss-or-advance-only' },
      { tickMilliseconds: 6, counters: { routeExpansions: 3, pathCacheHits: 1 }, cacheClass: 'mixed' },
      { tickMilliseconds: 8, counters: { pathCacheHits: 2 }, cacheClass: 'hit-only' },
    ]);

    expect(summary).toEqual({
      count: 3,
      timings: { count: 3, p50: 6, p95: 8, max: 8 },
      counters: { routeExpansions: 5, pathCacheHits: 3 },
      cacheClasses: {
        'miss-or-advance-only': { count: 1, p50: 4, p95: 4, max: 4 },
        mixed: { count: 1, p50: 6, p95: 6, max: 6 },
        'hit-only': { count: 1, p50: 8, p95: 8, max: 8 },
      },
    });
  });
});
