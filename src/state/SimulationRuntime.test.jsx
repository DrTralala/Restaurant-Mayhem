import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SimulationRuntime, { useRenderState } from './SimulationRuntime';
import { FIXED_STEP_SECONDS } from '../simulation/fixedStep';
import { runTick } from '../simulation/gameLoop';
import { interpolateSimulationState } from '../canvas/interpolation';

const { runtimeCallbacks } = vi.hoisted(() => ({ runtimeCallbacks: [] }));

vi.mock('../canvas/interpolation', () => ({
  interpolateSimulationState: vi.fn((_previous, current) => current),
}));
vi.mock('../hooks/useAnimationFrameLoop', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnimationFrameLoop: vi.fn((callback, options) => {
      runtimeCallbacks.push(callback);
      return actual.useAnimationFrameLoop(callback, options);
    }),
  };
});

let gameState;
let generation;
const dispatch = vi.fn();
const frames = [];

vi.mock('./GameContext', () => ({
  useGameState: () => gameState,
  useDispatch: () => dispatch,
  useGameGeneration: () => generation,
}));

vi.mock('../simulation/gameLoop', () => ({
  runTick: vi.fn((state, timing) => ({
    ...state,
    restaurant: { ...state.restaurant, gameTime: state.restaurant.gameTime + timing.gameDt },
  })),
}));

function Harness() {
  const state = useRenderState();
  return <span data-testid="render-time">{state.restaurant.gameTime}</span>;
}

beforeEach(() => {
  generation = 0;
  gameState = {
    paused: false,
    speed: 1,
    restaurant: { gameTime: 0 },
    staff: [],
    customers: [],
    queue: [],
  };
  dispatch.mockClear();
  runTick.mockClear();
  interpolateSimulationState.mockReset().mockImplementation((_previous, current) => current);
  frames.length = 0;
  runtimeCallbacks.length = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {
    frames.push(callback);
    return frames.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

it('advances canonical state with one fixed timing object', () => {
  render(<SimulationRuntime><Harness /></SimulationRuntime>);
  expect(screen.getByTestId('render-time')).toHaveTextContent('0');

  act(() => frames.shift()(0));
  act(() => frames.shift()(FIXED_STEP_SECONDS * 1000));

  expect(runTick).toHaveBeenCalledWith(gameState, {
    movementDt: FIXED_STEP_SECONDS,
    gameDt: FIXED_STEP_SECONDS * 60,
  });
  expect(dispatch).toHaveBeenCalledWith({
    type: 'TICK',
    nextState: expect.objectContaining({ restaurant: { gameTime: 2 } }),
  });
  expect(screen.getByTestId('render-time')).toHaveTextContent('2');
});

it('does not enter fixed-step service while a career decision is pending and resumes without generation reset', () => {
  gameState = { ...gameState, careerRun: { needsDecision: true } };
  const view = render(<SimulationRuntime><Harness /></SimulationRuntime>);
  act(() => frames.shift()(0));
  act(() => frames.shift()(1000));
  expect(runTick).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  gameState = { ...gameState, careerRun: { needsDecision: false } };
  view.rerender(<SimulationRuntime><Harness /></SimulationRuntime>);
  act(() => frames.shift()(2000));
  act(() => frames.shift()(2000 + FIXED_STEP_SECONDS * 1000));
  expect(runTick).toHaveBeenCalled();
});

it('stops runtime frames while paused, publishes canonical edits, and resumes without a long-gap step', () => {
  gameState = { ...gameState, paused: true, restaurant: { gameTime: 10 } };
  let renders = 0;
  function CountingHarness() {
    renders += 1;
    const state = useRenderState();
    return <span data-testid="render-time">{state.restaurant.gameTime}</span>;
  }
  const view = render(<SimulationRuntime><CountingHarness /></SimulationRuntime>);
  expect(frames).toHaveLength(0);
  expect(screen.getByTestId('render-time')).toHaveTextContent('10');

  gameState = { ...gameState, restaurant: { gameTime: 24 } };
  view.rerender(<SimulationRuntime><CountingHarness /></SimulationRuntime>);
  expect(screen.getByTestId('render-time')).toHaveTextContent('24');
  expect(frames).toHaveLength(0);
  expect(runTick).not.toHaveBeenCalled();
  expect(interpolateSimulationState).not.toHaveBeenCalled();
  const pausedRenderCount = renders;

  gameState = { ...gameState, paused: false };
  view.rerender(<SimulationRuntime><CountingHarness /></SimulationRuntime>);
  expect(frames).toHaveLength(1);
  act(() => frames.shift()(100_000));
  expect(runTick).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(interpolateSimulationState).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('render-time')).toHaveTextContent('24');
  expect(frames).toHaveLength(1);

  act(() => frames.shift()(100_000 + FIXED_STEP_SECONDS * 1000 + 1));
  expect(runTick).toHaveBeenCalledTimes(1);
  expect(dispatch).toHaveBeenCalledWith({
    type: 'TICK',
    nextState: expect.objectContaining({ restaurant: { gameTime: 26 } }),
  });
  expect(renders).toBeGreaterThan(pausedRenderCount);
});

it('guards a directly invoked pre-pause runtime callback after canonical pause commits', () => {
  let renders = 0;
  function CountingHarness() {
    renders += 1;
    return <Harness />;
  }
  const view = render(<SimulationRuntime><CountingHarness /></SimulationRuntime>);
  const pendingRuntimeCallback = runtimeCallbacks.at(-1);

  gameState = { ...gameState, paused: true };
  view.rerender(<SimulationRuntime><CountingHarness /></SimulationRuntime>);
  const renderCountAfterPause = renders;
  interpolateSimulationState.mockImplementationOnce((_previous, current) => ({ ...current }));
  let keepRunning;
  act(() => { keepRunning = pendingRuntimeCallback(10_000); });

  expect(keepRunning).toBe(false);
  expect(runTick).not.toHaveBeenCalled();
  expect(interpolateSimulationState).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(renders).toBe(renderCountAfterPause);
});

it('stops scheduling after a tick fault and restarts after generation changes', () => {
  const view = render(<SimulationRuntime><Harness /></SimulationRuntime>);
  act(() => frames.shift()(0));

  const fault = new Error('injected tick fault');
  runTick.mockImplementationOnce(() => { throw fault; });
  act(() => frames.shift()(FIXED_STEP_SECONDS * 1000));

  expect(frames).toHaveLength(0);
  expect(screen.getByRole('alert')).toBeInTheDocument();

  generation += 1;
  view.rerender(<SimulationRuntime><Harness /></SimulationRuntime>);

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(frames).toHaveLength(1);
  view.unmount();
});

it('names affected actor IDs in the navigation fault banner', () => {
  gameState = {
    ...gameState,
    paused: true,
    navigationFault: {
      kind: 'unsafe-navigation-state',
      issues: [{ kind: 'actor-overlap', ids: ['starter-cook', 'starter-host'] }],
    },
  };

  render(<SimulationRuntime><Harness /></SimulationRuntime>);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Affected actors: starter-cook, starter-host.',
  );
});

it('cancels its pending animation frame on unmount', () => {
  const view = render(<SimulationRuntime><Harness /></SimulationRuntime>);

  view.unmount();

  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});
