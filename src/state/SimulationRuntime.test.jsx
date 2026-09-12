import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SimulationRuntime, { useRenderState } from './SimulationRuntime';
import { FIXED_STEP_SECONDS } from '../simulation/fixedStep';
import { runTick } from '../simulation/gameLoop';

let gameState;
const dispatch = vi.fn();
const frames = [];

vi.mock('./GameContext', () => ({
  useGameState: () => gameState,
  useDispatch: () => dispatch,
  useGameGeneration: () => 0,
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
  frames.length = 0;
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

it('cancels its pending animation frame on unmount', () => {
  const view = render(<SimulationRuntime><Harness /></SimulationRuntime>);

  view.unmount();

  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});
