import { describe, expect, it } from 'vitest';
import {
  minimumSweptDistance,
  minimumTimedSegmentDistance,
  minimumTrajectoryDistance,
  pointAtTrajectorySegment,
  trajectoryPositionAt,
} from './trajectory';

function segment(start, end, startTime, endTime) {
  return { start, end, startTime, endTime };
}

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

it('measures segment sweeps over their absolute overlapping time', () => {
  expect(minimumTimedSegmentDistance(
    { start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, startTime: 2, endTime: 4 },
    { start: { x: 20, y: 0 }, end: { x: 0, y: 0 }, startTime: 2, endTime: 4 },
  )).toBeCloseTo(0);
  expect(minimumTimedSegmentDistance(
    { start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, startTime: 0, endTime: 1 },
    { start: { x: 10, y: 0 }, end: { x: 30, y: 0 }, startTime: 2, endTime: 3 },
  )).toBe(Infinity);
});

it('treats endpoint-only segment contact as non-overlap in either order', () => {
  const moving = {
    start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, startTime: 0, endTime: 1,
  };
  const waiting = {
    start: { x: 20, y: 0 }, end: { x: 20, y: 0 }, startTime: 1, endTime: 2,
  };
  expect(minimumTimedSegmentDistance(moving, waiting)).toBe(Infinity);
  expect(minimumTimedSegmentDistance(waiting, moving)).toBe(Infinity);
});

it('no longer exports the removed coincident-start recovery helpers', async () => {
  const namespace = await import('./trajectory');
  expect('coincidentStartTrajectoriesSeparateSafely' in namespace).toBe(false);
  expect('buildTimeParameterizedTrajectory' in namespace).toBe(false);
});

describe('trajectoryPositionAt exact endpoint selection', () => {
  it('returns the stored final endpoint when a tiny last move ends the trajectory', () => {
    const waitPosition = { x: 1020, y: 120 };
    const finalMoveEnd = { x: 1020, y: 120.00000000000009 };
    const recorded = [
      segment({ ...waitPosition }, { ...waitPosition }, 0, 0.99999999999996),
      segment({ ...waitPosition }, { ...finalMoveEnd }, 0.99999999999996, 1),
    ];
    expect(recorded.at(-1).end).toEqual(finalMoveEnd);
    expect(recorded[1].endTime - recorded[1].startTime).toBeGreaterThan(0);
    const position = trajectoryPositionAt(recorded, 1);
    expect(position).toEqual(finalMoveEnd);
    expect(position).not.toBe(recorded.at(-1).end);
  });

  it('returns the final stored end exactly without start + delta * 1 reconstruction', () => {
    const storedEnd = { x: 0.9, y: 0 };
    const single = [segment({ x: 0.3, y: 0 }, { ...storedEnd }, 0, 1)];
    const position = trajectoryPositionAt(single, 1);
    expect(position).toEqual(storedEnd);
    expect(position).not.toBe(single.at(-1).end);
  });

  it('clamps before the first stored start to a copy of that start', () => {
    const firstStart = { x: 100, y: 100 };
    const trajectory = [
      segment({ ...firstStart }, { x: 120, y: 100 }, 0, 0.4),
      segment({ x: 120, y: 100 }, { x: 120, y: 100 }, 0.4, 1),
    ];
    expect(trajectoryPositionAt(trajectory, 0)).toEqual(firstStart);
    expect(trajectoryPositionAt(trajectory, -0.25)).toEqual(firstStart);
    expect(trajectoryPositionAt(trajectory, 0)).not.toBe(trajectory[0].start);
  });

  it('clamps after the last stored end to a copy of that end', () => {
    const trajectory = [
      segment({ x: 100, y: 100 }, { x: 120, y: 100 }, 0, 0.4),
      segment({ x: 120, y: 100 }, { x: 120, y: 100 }, 0.4, 1),
    ];
    expect(trajectoryPositionAt(trajectory, 1)).toEqual({ x: 120, y: 100 });
    expect(trajectoryPositionAt(trajectory, 2)).toEqual({ x: 120, y: 100 });
    expect(trajectoryPositionAt(trajectory, 2)).not.toBe(trajectory.at(-1).end);
  });

  it('selects the following stored start at an internal wait-to-move boundary', () => {
    const waitPosition = { x: 0, y: 0 };
    const trajectory = [
      segment({ ...waitPosition }, { ...waitPosition }, 0, 0.5),
      segment({ ...waitPosition }, { x: 20, y: 0 }, 0.5, 1),
    ];
    expect(trajectoryPositionAt(trajectory, 0.5)).toEqual({ x: 0, y: 0 });
    expect(trajectoryPositionAt(trajectory, 0.75)).toEqual({ x: 10, y: 0 });
  });

  it('carries the exact move-to-hold boundary into the terminal hold', () => {
    const trajectory = [
      segment({ x: 100, y: 100 }, { x: 120, y: 100 }, 0, 0.4),
      segment({ x: 120, y: 100 }, { x: 120, y: 100 }, 0.4, 1),
    ];
    expect(trajectoryPositionAt(trajectory, 0.4)).toEqual({ x: 120, y: 100 });
    expect(trajectoryPositionAt(trajectory, 1)).toEqual({ x: 120, y: 100 });
  });

  it('keeps single-segment before and after clamping and interpolation', () => {
    const single = [segment({ x: 10, y: 20 }, { x: 30, y: 40 }, 0, 1)];
    expect(trajectoryPositionAt(single, -1)).toEqual({ x: 10, y: 20 });
    expect(trajectoryPositionAt(single, 0)).toEqual({ x: 10, y: 20 });
    expect(trajectoryPositionAt(single, 0.5)).toEqual({ x: 20, y: 30 });
    expect(trajectoryPositionAt(single, 1)).toEqual({ x: 30, y: 40 });
    expect(trajectoryPositionAt(single, 2)).toEqual({ x: 30, y: 40 });
  });

  it('characterises an empty trajectory as still throwing', () => {
    expect(() => trajectoryPositionAt([], 0.5)).toThrow(TypeError);
  });

  it('characterises a discontinuous gap without interpolation across it', () => {
    const gapped = [
      segment({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 0.4),
      segment({ x: 20, y: 0 }, { x: 30, y: 0 }, 0.7, 1),
    ];
    expect(trajectoryPositionAt(gapped, 0.55)).toEqual({ x: 20, y: 0 });
  });

  it('retains the stored end-point convention for a zero-duration segment', () => {
    const zero = {
      start: { x: 5, y: 6 }, end: { x: 5, y: 6 }, startTime: 0.5, endTime: 0.5,
    };
    expect(pointAtTrajectorySegment(zero, 0.25)).toBe(zero.end);
    expect(pointAtTrajectorySegment(zero, 0.75)).toBe(zero.end);
  });
});
