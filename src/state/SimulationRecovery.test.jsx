import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameProvider, useDispatch, useGameState } from './GameContext';
import { createInitialState } from './initialState';
import SimulationRuntime, { useRenderState } from './SimulationRuntime';
import RestaurantCanvas from '../canvas/RestaurantCanvas';
import { runTick } from '../simulation/gameLoop';
import { interpolateSimulationState } from '../canvas/interpolation';
import { drawFloorLayer } from '../canvas/layers';
import { FONT_FAMILY } from '../typography';

// Fault injection only: the provider, reducer, runtime and canvas are real.
vi.mock('../simulation/gameLoop', () => ({ runTick: vi.fn() }));
vi.mock('../canvas/interpolation', async importOriginal => ({
  ...await importOriginal(), interpolateSimulationState: vi.fn(),
}));
vi.mock('../canvas/sprites', () => ({ loadSprites: () => ({}) }));
vi.mock('../canvas/layers', () => ({
  drawFloorLayer: vi.fn(), drawFurnitureLayer: vi.fn(), drawPlacementPreview: vi.fn(),
  drawStaffLayer: vi.fn(), drawCustomerLayer: vi.fn(), drawOverlayLayer: vi.fn(),
  drawQueueLayer: vi.fn(), drawSelectionLayer: vi.fn(),
}));

const frames = new Map();
let nextFrame;
let currentState;
let errorLog;

function Harness() {
  currentState = useGameState();
  const state = useRenderState();
  const dispatch = useDispatch();
  return <>
    <output data-testid="time">{state.restaurant.gameTime}</output>
    <button onClick={() => dispatch({ type: 'LOAD_STATE', state: createInitialState() })}>New Game</button>
    <button onClick={() => dispatch({ type: 'LOAD_STATE', state: {
      ...createInitialState(), restaurant: { ...createInitialState().restaurant, gameTime: 42000 },
    } })}>Load</button>
    <button onClick={() => dispatch({ type: 'LOAD_STATE', state: currentState })}>Reload same state</button>
    <button onClick={() => dispatch({ type: 'SET_SPEED', speed: 4 })}>Speed</button>
    <button onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })}>Pause</button>
  </>;
}

function mount(canvas = false) {
  return render(<StrictMode><GameProvider><SimulationRuntime>
    <Harness />{canvas && <RestaurantCanvas />}
  </SimulationRuntime></GameProvider></StrictMode>);
}

function frame(timestamp) {
  act(() => {
    const pending = [...frames];
    for (const [id, callback] of pending) {
      if (!frames.delete(id)) continue;
      callback(timestamp);
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  runTick.mockReset().mockImplementation((state, timing) => ({
    ...state, restaurant: { ...state.restaurant, gameTime: state.restaurant.gameTime + timing.gameDt },
  }));
  interpolateSimulationState.mockReset().mockImplementation((_previous, state) => state);
  drawFloorLayer.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['tick', 'interpolation'])('latches a %s fault without requeueing or committing the frame', phase => {
  const view = mount();
  frame(0);
  frame(34);
  expect(screen.getByTestId('time')).toHaveTextContent('36002');
  const fault = new Error(`injected ${phase} fault`);
  (phase === 'tick' ? runTick : interpolateSimulationState)
    .mockImplementationOnce(() => { throw fault; });

  expect(() => frame(68)).not.toThrow();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(/new game/);
  expect(alert).toHaveStyle({ fontFamily: FONT_FAMILY });
  expect(currentState.restaurant.gameTime).toBe(36002);
  expect(frames.size).toBe(0);
  expect(errorLog).toHaveBeenCalledTimes(1);
  expect(errorLog.mock.calls[0]).toContain(fault);
  const tickCount = runTick.mock.calls.length;
  fireEvent.click(screen.getByText('Speed'));
  fireEvent.click(screen.getByText('Pause'));
  fireEvent.click(screen.getByText('Pause'));
  frame(102);
  frame(136);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(runTick).toHaveBeenCalledTimes(tickCount);
  expect(errorLog).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(frames.size).toBe(0);
});

it.each([['New Game', 36000], ['Load', 42000], ['Reload same state', 36002]])(
  '%s recovers a fault with fresh timing and exactly one loop', (button, initialTime) => {
    const view = mount();
    frame(0);
    frame(34);
    runTick.mockImplementationOnce(() => { throw new Error('injected fault'); });
    expect(() => frame(68)).not.toThrow();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText(button));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(frames.size).toBe(1);
    frame(10000);
    expect(currentState.restaurant.gameTime).toBe(initialTime);
    frame(10034);
    expect(currentState.restaurant.gameTime).toBe(initialTime + 2);
    // A second fault remains recoverable rather than disabling the handler.
    runTick.mockImplementationOnce(() => { throw new Error('second fault'); });
    frame(10068);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
    fireEvent.click(screen.getByText(button));
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  },
);

it.each(['layer', 'context'])('reports a canvas %s fault once and draws again after New Game', source => {
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ scale: vi.fn(), fillText: vi.fn() });
  const view = mount(true);
  frame(0);
  expect(frames.size).toBe(2);
  const fault = new Error('injected drawing fault');
  (source === 'layer' ? drawFloorLayer : context).mockImplementationOnce(() => { throw fault; });
  expect(() => frame(34)).not.toThrow();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  const draws = drawFloorLayer.mock.calls.length;
  frame(68);
  expect(drawFloorLayer).toHaveBeenCalledTimes(draws);
  expect(frames.size).toBe(0);
  expect(errorLog).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('New Game'));
  frame(1000);
  frame(1034);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(drawFloorLayer.mock.calls.length).toBeGreaterThan(draws);
  expect(currentState.restaurant.gameTime).toBe(36002);
  expect(frames.size).toBe(2);
  view.unmount();
  expect(frames.size).toBe(0);
});
