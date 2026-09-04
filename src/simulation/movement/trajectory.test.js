import { expect, it } from 'vitest';
import {
  buildTimeParameterizedTrajectory,
  coincidentStartTrajectoriesSeparateSafely,
  minimumSweptDistance,
  minimumTrajectoryDistance,
} from './trajectory';

it('constructs exact moving and stationary trajectories', () => {
  expect(buildTimeParameterizedTrajectory(
    { x: 100, y: 100 }, { x: 120, y: 100 }, 40, 1,
  )).toEqual([
    { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 0.5 },
    { start: { x: 120, y: 100 }, end: { x: 120, y: 100 }, startTime: 0.5, endTime: 1 },
  ]);
  expect(buildTimeParameterizedTrajectory(
    { x: 100, y: 100 }, { x: 100, y: 100 }, 40, 1,
  )).toEqual([
    { start: { x: 100, y: 100 }, end: { x: 100, y: 100 }, startTime: 0, endTime: 1 },
  ]);
});

it('measures perpendicular sweeps and ignores disjoint time intervals', () => {
  expect(minimumSweptDistance(
    { x: 80, y: 100 }, { x: 120, y: 100 },
    { x: 100, y: 80 }, { x: 100, y: 120 },
  )).toBeCloseTo(0);
  expect(minimumTrajectoryDistance(
    [{
      start: { x: 80, y: 100 }, end: { x: 120, y: 100 },
      startTime: 0, endTime: 0.4,
    }],
    [{
      start: { x: 100, y: 80 }, end: { x: 100, y: 120 },
      startTime: 0.6, endTime: 1,
    }],
  )).toBe(Infinity);
});

it('requires coincident trajectories to separate immediately and remain separate', () => {
  const sharedThenLeft = [
    { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 0.5 },
    { start: { x: 120, y: 100 }, end: { x: 120, y: 120 }, startTime: 0.5, endTime: 1 },
  ];
  const sharedThenRight = [
    { start: { x: 100, y: 100 }, end: { x: 120, y: 100 }, startTime: 0, endTime: 0.5 },
    { start: { x: 120, y: 100 }, end: { x: 120, y: 80 }, startTime: 0.5, endTime: 1 },
  ];
  const immediateLeft = buildTimeParameterizedTrajectory(
    { x: 100, y: 100 }, { x: 80, y: 100 }, 20, 1,
  );
  const immediateRight = buildTimeParameterizedTrajectory(
    { x: 100, y: 100 }, { x: 120, y: 100 }, 20, 1,
  );

  expect(coincidentStartTrajectoriesSeparateSafely(sharedThenLeft, sharedThenRight))
    .toBe(false);
  expect(coincidentStartTrajectoriesSeparateSafely(immediateLeft, immediateRight))
    .toBe(true);
});
