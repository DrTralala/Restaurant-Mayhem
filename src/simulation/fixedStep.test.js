import { describe, expect, it, vi } from 'vitest';
import {
  FIXED_STEP_SECONDS,
  MAX_CATCH_UP_STEPS,
  advanceFixedStep,
  normaliseSpeed,
} from './fixedStep';

const state = { paused: false, speed: 1, count: 0 };

describe('advanceFixedStep', () => {
  it('produces identical ticks for different render frame schedules', () => {
    const runStep = (current, timing) => ({
      ...current,
      count: current.count + 1,
      gameTime: (current.gameTime || 0) + timing.gameDt,
      distance: (current.distance || 0) + timing.movementDt * 75,
    });
    const runFrames = frames => frames.reduce((frame, elapsedSeconds) =>
      advanceFixedStep({ ...frame, elapsedSeconds }, runStep), {
        state, previousState: state, accumulator: 0,
      });

    expect(runFrames([0.1]).state).toEqual(runFrames([0.02, 0.03, 0.05]).state);
  });

  it('uses explicit 60:1 domains and selected speed', () => {
    const fastState = { ...state, speed: 4 };
    const runStep = vi.fn(current => ({ ...current, count: current.count + 1 }));

    advanceFixedStep({ state: fastState, accumulator: 0, elapsedSeconds: FIXED_STEP_SECONDS }, runStep);

    expect(runStep).toHaveBeenCalledWith(fastState, {
      movementDt: FIXED_STEP_SECONDS * 4,
      gameDt: FIXED_STEP_SECONDS * 4 * 60,
    });
  });

  it('clears accumulated time while paused', () => {
    const paused = { ...state, paused: true };

    expect(advanceFixedStep({ state: paused, accumulator: 0.02, elapsedSeconds: 1 }, vi.fn()))
      .toMatchObject({ state: paused, previousState: paused, accumulator: 0, alpha: 0, steps: 0 });
  });

  it('caps browser-stall catch-up work and discards excess backlog', () => {
    const runStep = vi.fn(current => ({ ...current, count: current.count + 1 }));
    const result = advanceFixedStep({
      state,
      accumulator: FIXED_STEP_SECONDS - 0.001,
      elapsedSeconds: 30,
    }, runStep);

    expect(result.steps).toBe(MAX_CATCH_UP_STEPS);
    expect(result.accumulator).toBeLessThan(FIXED_STEP_SECONDS);
  });

  it.each([1, 2, 4])('yields after an expensive tick at %sx without changing tick timing', speed => {
    let clock = 0;
    const runStep = vi.fn(current => {
      clock += 20;
      return { ...current, count: current.count + 1 };
    });
    let frame = { state: { ...state, speed }, accumulator: 0, elapsedSeconds: 0.25 };
    for (let index = 0; index < 10; index += 1) {
      frame = advanceFixedStep({ ...frame, elapsedSeconds: 0.25 }, runStep,
        { now: () => clock, maxWorkMs: 8 });
      expect(frame.steps).toBe(1);
      expect(frame.accumulator).toBeGreaterThanOrEqual(0);
      expect(frame.accumulator).toBeLessThan(FIXED_STEP_SECONDS);
      expect(frame.alpha).toBeGreaterThanOrEqual(0);
      expect(frame.alpha).toBeLessThan(1);
    }
    expect(frame.state.count).toBe(10);
    expect(runStep.mock.calls[0][1]).toEqual({ movementDt: speed / 30, gameDt: speed * 2 });
  });

  it('allows cheap catch-up ticks until the work budget is reached', () => {
    let clock = 0;
    const result = advanceFixedStep({ state, elapsedSeconds: 0.25 }, current => {
      clock += 2;
      return { ...current, count: current.count + 1 };
    }, { now: () => clock, maxWorkMs: 8 });
    expect(result.steps).toBe(4);
    expect(result.accumulator).toBeLessThan(FIXED_STEP_SECONDS);
  });

  it('does not sample work time or run ticks while paused', () => {
    const now = vi.fn();
    const runStep = vi.fn();
    const result = advanceFixedStep({ state: { ...state, paused: true }, elapsedSeconds: 0.25 },
      runStep, { now, maxWorkMs: 8 });
    expect(result.steps).toBe(0);
    expect(result.accumulator).toBe(0);
    expect(now).not.toHaveBeenCalled();
    expect(runStep).not.toHaveBeenCalled();
  });
});

it.each([[1, 1], [2, 2], [4, 4], [3, 1], [NaN, 1]])(
  'normalises speed %s to %s',
  (input, expected) => {
    expect(normaliseSpeed(input)).toBe(expected);
  },
);
