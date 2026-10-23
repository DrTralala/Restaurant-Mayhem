import { useReducer } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import RestaurantCanvas, { drawCopyPreview } from './RestaurantCanvas';
import { createInitialState } from '../state/initialState';
import {
  drawCustomerLayer,
  drawFloorLayer,
  drawFurnitureLayer,
  drawPlacementPreview,
  drawQueueLayer,
  drawSelectionLayer,
  drawStaffLayer,
} from './layers';
import { adjustCameraZoom, calculateFitCamera, screenToWorld } from './camera';
import { useDispatch, useGameGeneration, useGameState, gameReducer } from '../state/GameContext';
import { useRenderState, useRuntimeFault } from '../state/SimulationRuntime';
import { findClickedEntity } from './interaction';
import { GRID_SIZE, getRestaurantWorld } from '../simulation/world';
import { getPlaceable } from '../data/placeables';
import { getFixtureSaleExpectation, getSaleSelection, sellFixtures } from '../state/fixtureSales';
import { getDishwasherStats } from '../simulation/dishwasherProgression';
import { FONT_FAMILY } from '../typography';
import { loadSprites } from './sprites';
import { createRenderIndexes } from './renderIndexes';
import { validateFixtureCopies, validateFixtureMoves } from '../simulation/placement';
import { validateStaffMove } from '../state/staffMoves';

vi.mock('../state/GameContext', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGameState: vi.fn(),
    useDispatch: vi.fn(),
    useGameGeneration: vi.fn(),
  };
});

vi.mock('../state/SimulationRuntime', () => ({
  useRenderState: vi.fn(),
  useRuntimeFault: vi.fn(),
}));

vi.mock('./camera', () => ({
  adjustCameraZoom: vi.fn(),
  calculateFitCamera: vi.fn(),
  createCamera: () => ({ x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 3, manual: true }),
  screenToWorld: vi.fn((_camera, x, y) => ({ x, y })),
}));

vi.mock('./sprites', () => ({ loadSprites: vi.fn(() => ({})) }));
vi.mock('./layers', () => ({
  drawFloorLayer: vi.fn(),
  drawFurnitureLayer: vi.fn(),
  drawStaffLayer: vi.fn(),
  drawCustomerLayer: vi.fn(),
  drawQueueLayer: vi.fn(),
  drawSelectionLayer: vi.fn(),
  drawPlacementPreview: vi.fn(),
}));
vi.mock('./interaction', () => ({ findClickedEntity: vi.fn() }));
vi.mock('../simulation/placement', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    validateFixtureCopies: vi.fn(actual.validateFixtureCopies),
    validateFixtureMoves: vi.fn(actual.validateFixtureMoves),
  };
});
vi.mock('../state/staffMoves', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, validateStaffMove: vi.fn(actual.validateStaffMove) };
});
vi.mock('./renderIndexes', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, createRenderIndexes: vi.fn(actual.createRenderIndexes) };
});

const chair = { id: 'ch1', tableId: 't1', x: 150, y: 80, rotation: 0 };
const state = {
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
  chairs: [chair],
  staff: [],
  customers: [],
  queue: [],
  kitchenStations: [],
  serviceTables: [],
  serviceItems: [],
  equipment: [],
  dishes: [],
};

const placementState = {
  ...state,
  restaurant: { expansionLevel: 1, funds: 100_000 },
  tables: [],
  chairs: [],
  doors: [{ id: 'door1', y: 340, role: 'entrance' }],
  kitchenStations: [],
  serviceTables: [],
  cashierStations: [],
};

const validPlacementCases = [
  { itemType: 'table', x: 600, y: 300 },
  {
    itemType: 'chair',
    x: 210,
    y: 180,
    state: {
      ...placementState,
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 200 }],
    },
  },
  {
    itemType: 'door',
    x: getRestaurantWorld(placementState.restaurant).doorX,
    y: 440,
  },
  { itemType: 'serviceTable', x: 600, y: 120 },
  { itemType: 'cashierTable', x: 600, y: 300 },
];

const placementLabels = {
  table: 'Dining table',
  chair: 'Dining chair',
  door: 'Additional door',
  serviceTable: 'Service counter',
  cashierTable: 'Cashier',
};

function makeFixtureMovementState(type) {
  const movementState = {
    restaurant: { expansionLevel: 1 },
    tables: [],
    chairs: [],
    doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    serviceTables: [],
    cashierStations: [],
    kitchenStations: [],
    washStations: [],
    staff: [],
    customers: [],
    queue: [],
    serviceItems: [],
    equipment: [],
    dishes: [],
  };

  if (type === 'table') movementState.tables = [{ id: 't1', seats: 2, status: 'empty', x: 100, y: 120 }];
  if (type === 'chair') {
    movementState.tables = [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 320 }];
    movementState.chairs = [{ id: 'ch1', tableId: 't1', x: 100, y: 120, rotation: 0 }];
  }
  if (type === 'serviceTable') movementState.serviceTables = [{ id: 'st1', x: 100, y: 120 }];
  if (type === 'cashierTable') movementState.cashierStations = [{ id: 'cashier1', x: 100, y: 120, w: 80, h: 40 }];
  if (type === 'kitchenStation') movementState.kitchenStations = [{ id: 'k1', equipmentId: null, x: 100, y: 120 }];
  if (type === 'washStation') movementState.washStations = [{ id: 'wash1', type: 'manual', x: 100, y: 120 }];

  return movementState;
}

function drawingContext() {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
  };
}

function prepareCanvasForFrames(container) {
  const canvas = container.querySelector('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
  canvas.getContext = vi.fn(() => drawingContext());
  calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  return canvas;
}

function runAnimationFrame(timestamp) {
  act(() => requestAnimationFrame.mock.calls.at(-1)[0](timestamp));
}

function startDragSelection(canvas, startX, startY, endX, endY) {
  fireEvent.mouseDown(canvas, { clientX: startX, clientY: startY, button: 0 });
  fireEvent.mouseMove(canvas, { clientX: endX, clientY: endY, buttons: 1 });
}

function finishDragSelection(canvas, endX, endY) {
  fireEvent.mouseUp(canvas, { clientX: endX, clientY: endY, button: 0 });
}

function findSelectionRectangle(container) {
  return container.querySelector('div[style*="z-index: 250"]');
}

function trackCanvasDimensions(canvas) {
  const writes = { width: [], height: [] };
  for (const dimension of ['width', 'height']) {
    let value = canvas[dimension];
    Object.defineProperty(canvas, dimension, {
      configurable: true,
      get: () => value,
      set(next) {
        writes[dimension].push(next);
        value = next;
      },
    });
  }
  return writes;
}

function trackStyleDimension(style, dimension) {
  let value = style[dimension];
  const writes = [];
  Object.defineProperty(style, dimension, {
    configurable: true,
    get: () => value,
    set(next) {
      writes.push(next);
      value = next;
    },
  });
  return writes;
}

const fixtureMovementCases = [
  ['table', 't1', 'Dining table'],
  ['chair', 'ch1', 'Chair'],
  ['door', 'door1', 'Door · entrance'],
  ['serviceTable', 'st1', 'Service counter'],
  ['cashierTable', 'cashier1', 'Cashier'],
  ['kitchenStation', 'k1', 'Drinks Dispenser'],
  ['washStation', 'wash1', 'Sink'],
];

describe('RestaurantCanvas object movement', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReturnValue(state);
    useGameGeneration.mockReturnValue(0);
    useRenderState.mockImplementation(() => useGameState());
    useDispatch.mockReturnValue(vi.fn());
    findClickedEntity.mockReturnValue({ type: 'chair', data: chair, text: 'Chair' });
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  it('initialises sprites once per mounted canvas across rerenders', () => {
    loadSprites.mockClear();
    const { rerender } = render(<RestaurantCanvas managementOpen={false} />);

    expect(loadSprites).toHaveBeenCalledTimes(1);
    rerender(<RestaurantCanvas managementOpen />);
    expect(loadSprites).toHaveBeenCalledTimes(1);
  });

  it('sets backing dimensions only when needed, uses absolute DPR transforms, and preserves a manual camera on DPR changes', () => {
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    let cssWidth = 801;
    let cssHeight = 601;
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => cssWidth });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => cssHeight });
    const dimensions = trackCanvasDimensions(canvas);
    const styleWidths = trackStyleDimension(canvas.style, 'width');
    const styleHeights = trackStyleDimension(canvas.style, 'height');
    const context = drawingContext();
    canvas.getContext = vi.fn(() => context);
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    const dpr = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1.25);

    const runFrame = timestamp => act(() => requestAnimationFrame.mock.calls.at(-1)[0](timestamp));
    runFrame(0);
    expect(dimensions).toEqual({ width: [1001], height: [751] });
    expect(styleWidths).toEqual([]);
    expect(styleHeights).toEqual([]);
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
    expect(context.setTransform).toHaveBeenLastCalledWith(1.25, 0, 0, 1.25, 0, 0);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 801, 601);

    runFrame(16);
    expect(dimensions).toEqual({ width: [1001], height: [751] });
    expect(styleWidths).toEqual([]);
    expect(styleHeights).toEqual([]);
    expect(context.setTransform).toHaveBeenLastCalledWith(1.25, 0, 0, 1.25, 0, 0);
    expect(context.setTransform).toHaveBeenCalledTimes(2);
    expect(context.clearRect).toHaveBeenCalledTimes(2);

    adjustCameraZoom.mockImplementation(camera => { camera.manual = true; });
    fireEvent.wheel(canvas, { deltaY: -1 });
    calculateFitCamera.mockClear();
    dpr.mockReturnValue(2);
    runFrame(32);
    expect(dimensions.width).toEqual([1001, 1602]);
    expect(dimensions.height).toEqual([751, 1202]);
    expect(styleWidths).toEqual([]);
    expect(styleHeights).toEqual([]);
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 801, 601);
    expect(calculateFitCamera).not.toHaveBeenCalled();

    cssWidth = 802;
    cssHeight = 602;
    runFrame(48);
    expect(dimensions.width).toEqual([1001, 1602, 1604]);
    expect(dimensions.height).toEqual([751, 1202, 1204]);
    expect(styleWidths).toEqual([]);
    expect(styleHeights).toEqual([]);
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 802, 602);
    expect(calculateFitCamera).toHaveBeenCalledTimes(1);
    dpr.mockRestore();
  });

  it('keeps canvas CSS dimensions responsive to its flex parent across viewport resizes', () => {
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    const parent = canvas.parentElement;
    let parentWidth = 1280;
    let parentHeight = 495;
    Object.defineProperty(parent, 'clientWidth', {
      configurable: true,
      get: () => Math.round(parentWidth),
    });
    Object.defineProperty(parent, 'clientHeight', {
      configurable: true,
      get: () => Math.round(parentHeight),
    });
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      get: () => canvas.style.width.endsWith('%')
        ? Math.round(parent.clientWidth * Number.parseFloat(canvas.style.width) / 100)
        : Number.parseInt(canvas.style.width, 10),
    });
    Object.defineProperty(canvas, 'clientHeight', {
      configurable: true,
      get: () => canvas.style.height.endsWith('%')
        ? Math.round(parent.clientHeight * Number.parseFloat(canvas.style.height) / 100)
        : Number.parseInt(canvas.style.height, 10),
    });
    const dimensions = trackCanvasDimensions(canvas);
    const context = drawingContext();
    canvas.getContext = vi.fn(() => context);
    const dpr = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    const runFrame = timestamp => act(() => requestAnimationFrame.mock.calls.at(-1)[0](timestamp));

    try {
      runFrame(0);
      expect(dimensions).toEqual({ width: [2560], height: [990] });
      adjustCameraZoom.mockImplementation(camera => { camera.manual = true; });
      fireEvent.wheel(canvas, { deltaY: -1 });
      calculateFitCamera.mockClear();
      parentWidth = 1024;
      parentHeight = 685.75;

      runFrame(16);

      expect([canvas.clientWidth, canvas.clientHeight]).toEqual([1024, 686]);
      expect(canvas.style.width).toBe('100%');
      expect(canvas.style.height).toBe('100%');
      expect(dimensions).toEqual({ width: [2560, 2048], height: [990, 1372] });
      expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 1024, 686);
      expect(calculateFitCamera).toHaveBeenCalledWith(expect.objectContaining({
        viewportWidth: 1024,
        viewportHeight: 686,
      }));
    } finally {
      dpr.mockRestore();
    }
  });

  it('anchors wheel zoom to canvas-relative pointer coordinates in both directions', () => {
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 120, top: 60, right: 920, bottom: 660, width: 800, height: 600, x: 120, y: 60,
      toJSON: () => {},
    }));

    fireEvent.wheel(canvas, { deltaY: -1, clientX: 340, clientY: 210 });
    fireEvent.wheel(canvas, { deltaY: 1, clientX: 340, clientY: 210 });

    expect(adjustCameraZoom).toHaveBeenCalledTimes(2);
    expect(adjustCameraZoom.mock.calls[0][1]).toBe(1.1);
    expect(adjustCameraZoom.mock.calls[0][2]).toEqual({ x: 220, y: 150 });
    expect(adjustCameraZoom.mock.calls[1][1]).toBe(0.9);
    expect(adjustCameraZoom.mock.calls[1][2]).toEqual({ x: 220, y: 150 });
  });

  it('keeps the world point under the pointer stable after an anchored wheel for hit-testing', async () => {
    const actual = await vi.importActual('./camera');
    let worldBefore = null;
    adjustCameraZoom.mockImplementation((camera, factor, anchor) => {
      worldBefore = anchor ? actual.screenToWorld(camera, anchor.x, anchor.y) : null;
      return actual.adjustCameraZoom(camera, factor, anchor);
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 120, top: 60, right: 920, bottom: 660, width: 800, height: 600, x: 120, y: 60,
      toJSON: () => {},
    }));

    fireEvent.wheel(canvas, { deltaY: -1, clientX: 340, clientY: 210 });

    const [camera] = adjustCameraZoom.mock.calls[0];
    expect(camera.zoom).toBeCloseTo(1.1, 5);
    expect(camera.manual).toBe(true);

    fireEvent.click(canvas, { clientX: 340, clientY: 210 });

    const hit = findClickedEntity.mock.calls.at(-1);
    expect(hit[0]).toBe(state);
    expect(hit[1]).toBe(camera);
    expect([hit[2], hit[3]]).toEqual([220, 150]);
    const worldAfter = actual.screenToWorld(hit[1], hit[2], hit[3]);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
    expect(worldAfter.x).toBeCloseTo(220, 5);
    expect(worldAfter.y).toBeCloseTo(150, 5);
  });

  it('keeps the toolbar zoom buttons on the two-argument camera API', () => {
    render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(adjustCameraZoom).toHaveBeenLastCalledWith(expect.any(Object), 1.2);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(adjustCameraZoom).toHaveBeenLastCalledWith(expect.any(Object), 1 / 1.2);
  });

  it.each([0, -1, NaN, Infinity])('falls back to DPR 1 for invalid DPR %s', invalidDpr => {
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
    const dimensions = trackCanvasDimensions(canvas);
    const context = drawingContext();
    canvas.getContext = vi.fn(() => context);
    const dpr = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(invalidDpr);
    try {
      act(() => requestAnimationFrame.mock.calls.at(-1)[0](0));

      expect(dimensions.width).toEqual([800]);
      expect(dimensions.height).toEqual([600]);
      expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    } finally {
      dpr.mockRestore();
    }
  });

  it('shares one index for the final move-preview state but keeps placement and copy previews canonical', () => {
    const table = { id: 't1', seats: 2, status: 'empty', x: 100, y: 100 };
    const canonicalState = { ...state, tables: [table], chairs: [] };
    const renderState = { ...canonicalState, tables: [{ ...table, x: 105, y: 105 }] };
    useGameState.mockReturnValue(canonicalState);
    useRenderState.mockReturnValue(renderState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 300, buttons: 0 });
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](1000));

    let [,, , , indexes] = drawFurnitureLayer.mock.calls.at(-1);
    let furnitureState = drawFurnitureLayer.mock.calls.at(-1)[1];
    expect(furnitureState.tables[0]).toMatchObject({ x: 300, y: 300 });
    expect(indexes.tablesById.get('t1')).toBe(furnitureState.tables[0]);
    expect(createRenderIndexes).toHaveBeenCalledTimes(1);
    expect(drawStaffLayer.mock.calls.at(-1)[3].indexes).toBe(indexes);
    expect(drawCustomerLayer.mock.calls.at(-1)[3].indexes).toBe(indexes);
    expect(drawQueueLayer.mock.calls.at(-1)[3]).not.toHaveProperty('indexes');

    createRenderIndexes.mockClear();
    drawPlacementPreview.mockClear();
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](1016));

    [,, , , indexes] = drawFurnitureLayer.mock.calls.at(-1);
    furnitureState = drawFurnitureLayer.mock.calls.at(-1)[1];
    expect(indexes.tablesById.get('t1')).toBe(furnitureState.tables[0]);
    expect(createRenderIndexes).toHaveBeenCalledTimes(1);
    expect(drawPlacementPreview.mock.calls.at(-1)[1]).toBe(canonicalState);
    expect(drawPlacementPreview.mock.calls.at(-1)).toHaveLength(4);

    drawPlacementPreview.mockClear();
    drawCopyPreview(drawingContext(), canonicalState, { x: 0, y: 0, zoom: 1 }, {
      items: [{ type: 'table', id: 't1', x: 500, y: 500 }],
      validation: { valid: true },
    });
    expect(drawPlacementPreview).toHaveBeenCalledWith(
      expect.anything(), canonicalState, expect.anything(), expect.objectContaining({ x: 500, y: 500 }),
    );
    expect(drawPlacementPreview.mock.calls[0]).toHaveLength(4);
  });

  it('forces a backing-store reset before drawing again after a canvas fault', () => {
    const reportFault = vi.fn();
    useRuntimeFault.mockReturnValue({ fault: null, reportFault });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
    const dimensions = trackCanvasDimensions(canvas);
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](0));
    expect(dimensions).toEqual({ width: [800], height: [600] });

    const fault = new Error('injected draw failure');
    drawFloorLayer.mockImplementationOnce(() => { throw fault; });
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](16));
    expect(reportFault).toHaveBeenCalledWith(fault, 'drawing');

    useRuntimeFault.mockReturnValue({ fault, reportFault });
    rerender(<RestaurantCanvas managementOpen={false} />);
    useRuntimeFault.mockReturnValue({ fault: null, reportFault });
    rerender(<RestaurantCanvas managementOpen={false} />);
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](32));

    expect(dimensions.width).toEqual([800, 800]);
    expect(dimensions.height).toEqual([600]);
  });

  it.each(fixtureMovementCases)('moves a %s with one generic fixture transaction', (type, id, label) => {
    const dispatch = vi.fn();
    const caseState = makeFixtureMovementState(type);
    const data = caseState[{
      table: 'tables',
      chair: 'chairs',
      door: 'doors',
      serviceTable: 'serviceTables',
      cashierTable: 'cashierStations',
      kitchenStation: 'kitchenStations',
      washStation: 'washStations',
    }[type]].find(item => item.id === id);
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(caseState);
    findClickedEntity.mockReturnValue({ type, data, text: label });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 100, clientY: 120 });
    expect(screen.getByText(label)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{
        type,
        id,
        x: type === 'door' ? getRestaurantWorld(caseState.restaurant).doorX : 500,
        y: 300,
        ...(['chair', 'serviceTable'].includes(type) ? { rotation: 0 } : {}),
        ...(type === 'chair' ? { tableId: caseState.tables[0].id } : {}),
      }],
    });
  });

  it('previews a moved table with linked chairs and seated customers translated', () => {
    const dispatch = vi.fn();
    const table = { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 };
    const previewState = {
      ...state,
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
      customers: [{ id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 220, y: 190 }],
    };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(previewState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);

    const furniturePreview = drawFurnitureLayer.mock.calls.at(-1)[1];
    const customerPreview = drawCustomerLayer.mock.calls.at(-1)[1];
    expect(furniturePreview.tables[0]).toMatchObject({ x: 500, y: 300 });
    expect(furniturePreview.chairs[0]).toMatchObject({ x: 510, y: 280 });
    expect(customerPreview.customers[0]).toMatchObject({ x: 520, y: 290 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('previews an occupied chair moved independently with its seated customer', () => {
    const table = { id: 't1', seats: 2, status: 'occupied', x: 200, y: 200 };
    const movedChair = { id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 };
    const previewState = {
      ...state,
      tables: [table],
      chairs: [movedChair],
      customers: [{ id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 220, y: 190 }],
    };
    useGameState.mockReturnValue(previewState);
    findClickedEntity.mockReturnValue({ type: 'chair', data: movedChair, text: 'Chair' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(canvas, { clientX: 210, clientY: 180 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 221, clientY: 181, buttons: 0 });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);

    const furniturePreview = drawFurnitureLayer.mock.calls.at(-1)[1];
    const customerPreview = drawCustomerLayer.mock.calls.at(-1)[1];
    expect(furniturePreview.chairs[0]).toMatchObject({ x: 220, y: 180 });
    expect(customerPreview.customers[0]).toMatchObject({ x: 230, y: 190 });
  });

  it('keeps a transferred chair and its customer on the destination table in rotated previews', () => {
    const movedChair = { id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 };
    useGameState.mockReturnValue({ ...state,
      tables: [{ id: 't1', seats: 4, x: 200, y: 200 }, { id: 't2', seats: 4, x: 400, y: 200 }],
      chairs: [movedChair],
      customers: [{ id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 220, y: 190 }],
    });
    findClickedEntity.mockReturnValue({ type: 'chair', data: movedChair, text: 'Chair' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    fireEvent.click(canvas, { clientX: 210, clientY: 180 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 410, clientY: 180, buttons: 0 });
    fireEvent.keyDown(window, { key: 'r' });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);
    expect(drawFurnitureLayer.mock.calls.at(-1)[1].chairs[0]).toMatchObject({ tableId: 't2', rotation: 3 });
    expect(drawCustomerLayer.mock.calls.at(-1)[1].customers[0]).toMatchObject({ tableId: 't2', x: 420, y: 190 });
  });

  it('previews only on-service items at a moved service counter', () => {
    const serviceTable = { id: 'st1', x: 100, y: 120 };
    const otherServiceTable = { id: 'st2', x: 300, y: 120 };
    const serviceItems = [
      { id: 'on-service', state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 2, x: 170, y: 130 },
      { id: 'carried', state: 'carried', serviceTableId: 'st1', serviceSlotIndex: 1, x: 140, y: 130 },
      { id: 'reserved', state: 'ordered', serviceTableId: 'st1', serviceSlotIndex: 0, x: 110, y: 130 },
      { id: 'other-counter', state: 'on_service', serviceTableId: 'st2', serviceSlotIndex: 0, x: 310, y: 130 },
    ];
    const previewState = {
      ...state,
      tables: [],
      chairs: [],
      serviceTables: [serviceTable, otherServiceTable],
      serviceItems,
    };
    useGameState.mockReturnValue(previewState);
    findClickedEntity.mockReturnValue({ type: 'serviceTable', data: serviceTable, text: 'Service counter' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(canvas, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);

    const furniturePreview = drawFurnitureLayer.mock.calls.at(-1)[1];
    const previewItems = furniturePreview.serviceItems;
    expect(previewItems.find(item => item.id === 'on-service')).toMatchObject({ x: 575, y: 310 });
    expect(previewItems.find(item => item.id === 'carried')).toMatchObject({ x: 140, y: 130 });
    expect(previewItems.find(item => item.id === 'reserved')).toMatchObject({ x: 110, y: 130 });
    expect(previewItems.find(item => item.id === 'other-counter')).toMatchObject({ x: 310, y: 130 });
  });

  it('keeps invalid fixture movement active and reports the validation reason', () => {
    const dispatch = vi.fn();
    const caseState = makeFixtureMovementState('kitchenStation');
    const station = caseState.kitchenStations[0];
    caseState.tables = [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }];
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(caseState);
    findClickedEntity.mockReturnValue({ type: 'kitchenStation', data: station, text: 'Drinks Dispenser' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });

    expect(screen.getByText('Invalid: overlap')).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/Click to place/)).toBeInTheDocument();
  });

  it('tracks the cursor without holding a mouse button and places on click', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 20, clientY: 40 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });

    expect(screen.getByText(/Click to place ·/)).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'chair', id: 'ch1', x: 140, y: 80, rotation: 0, tableId: 't1' }],
    });
  });

  it('previews an item, rotates a chair, and confirms only on left click', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 100_000 },
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
      chairs: [],
    });
    const { container } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'chair' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLACE_ITEM', itemType: 'chair', x: 140, y: 80, rotation: 1,
    }));
    expect(complete).toHaveBeenCalled();
  });

  it('rotates a service counter during placement', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(placementState);
    const { container } = render(
      <RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'serviceTable' }} />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 120, buttons: 0 });
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.click(canvas, { clientX: 600, clientY: 120 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'serviceTable', x: 600, y: 120, rotation: 1,
    });
  });

  it('rotates an existing service counter while moving it', () => {
    const dispatch = vi.fn();
    const serviceTable = { id: 'st1', x: 100, y: 120 };
    const caseState = { ...makeFixtureMovementState('serviceTable'), serviceTables: [serviceTable] };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(caseState);
    findClickedEntity.mockReturnValue({ type: 'serviceTable', data: serviceTable, text: 'Service counter' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'serviceTable', id: 'st1', x: 500, y: 300, rotation: 1 }],
    });
  });

  for (const { itemType, x, y, state: caseState = placementState } of validPlacementCases) {
    it(`previews and confirms a valid ${itemType} placement`, () => {
      const dispatch = vi.fn();
      const complete = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      useGameState.mockReturnValue(caseState);
      const { container } = render(
        <RestaurantCanvas
          managementOpen={false}
          placementRequest={{ itemType }}
          onPlacementComplete={complete}
        />,
      );
      const canvas = container.querySelector('canvas');

      fireEvent.mouseMove(canvas, { clientX: x, clientY: y, buttons: 0 });

       expect(screen.getByText(new RegExp(`Place ${placementLabels[itemType]}`))).toBeInTheDocument();
      expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();

      fireEvent.click(canvas, { clientX: x, clientY: y });

      expect(dispatch).toHaveBeenCalledWith({
        type: 'PLACE_ITEM', itemType, x, y, rotation: 0,
      });
      expect(complete).toHaveBeenCalledTimes(1);
       expect(screen.queryByText(new RegExp(`Place ${placementLabels[itemType]}`))).not.toBeInTheDocument();
    });
  }

  it('keeps an invalid placement active without dispatching on left click', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({ ...state, tables: [], chairs: [] });
    const { container } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'chair' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PLACE_ITEM' }));
    expect(complete).not.toHaveBeenCalled();
    const banner = screen.getByText(/Place Dining chair/).parentElement;
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText(/chair-table/)).toBeInTheDocument();
  });

  it('preserves equipment metadata through preview and confirmed placement', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      equipment: [{ id: 'eq2', name: 'Oven', owned: false, purchaseCost: 500 }],
    });
    const { container } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'equipmentStation', equipmentId: 'eq2' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 120, buttons: 0 });

    expect(screen.getByText(/Place Oven/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 500, clientY: 120 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq2',
      x: 500, y: 120, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('uses shared typography for placement overlays and canvas controls', () => {
    useGameState.mockReturnValue(placementState);
    const { container } = render(
      <RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 300, buttons: 0 });

    const banner = screen.getByText(/Place Dining table/).parentElement;
    expect(banner).toHaveStyle({
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      fontWeight: '600',
    });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveStyle({
      fontFamily: FONT_FAMILY,
    });
  });

  it('cancels equipment placement on right click and Escape without dispatching', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      equipment: [{ id: 'eq2', name: 'Oven', owned: false, purchaseCost: 500 }],
    });
    const { container, rerender } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'equipmentStation', equipmentId: 'eq2' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.contextMenu(canvas);
    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Place Oven/)).not.toBeInTheDocument();

    rerender(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'equipmentStation', equipmentId: 'eq2' }}
        onPlacementComplete={complete}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Place Oven/)).not.toBeInTheDocument();
  });

  it('cancels placement when right-clicking an overlay control', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({ ...state, tables: [], chairs: [] });
    render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'table' }}
        onPlacementComplete={complete}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Zoom in' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Place Dining table/)).not.toBeInTheDocument();
  });

  it('allows chairs to be placed between 20-pixel grid cells', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 20, clientY: 40 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 131, clientY: 81, buttons: 0 });
    fireEvent.click(canvas, { clientX: 131, clientY: 81 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'chair', id: 'ch1', x: 130, y: 80, rotation: 0, tableId: 't1' }],
    });
  });

  it('closes the selected-object menu when management opens', () => {
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });
    expect(screen.getByRole('button', { name: /Move/ })).toBeInTheDocument();

    rerender(<RestaurantCanvas managementOpen />);

    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument();
  });

  it('reports a genuine empty-space click to the App owner', () => {
    const onEmptySpaceClick = vi.fn();
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas onEmptySpaceClick={onEmptySpaceClick} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 500, clientY: 500 });

    expect(onEmptySpaceClick).toHaveBeenCalledTimes(1);
  });

  it('does not hit-test an idle pointer move', () => {
    const { container } = render(<RestaurantCanvas />);
    const canvas = container.querySelector('canvas');
    findClickedEntity.mockClear();

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 500, buttons: 0 });

    expect(findClickedEntity).not.toHaveBeenCalled();
  });

  it('does not report a furniture click as empty space', () => {
    const onEmptySpaceClick = vi.fn();
    findClickedEntity.mockReturnValue({ type: 'chair', data: chair, text: 'Chair' });
    const { container } = render(<RestaurantCanvas onEmptySpaceClick={onEmptySpaceClick} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });

    expect(onEmptySpaceClick).not.toHaveBeenCalled();
  });

  it('does not report a non-actionable entity click as empty space', () => {
    const onEmptySpaceClick = vi.fn();
    const station = { id: 'k1', x: 100, y: 100 };
    useGameState.mockReturnValue({ ...state, kitchenStations: [station] });
    findClickedEntity.mockReturnValue({ type: 'kitchen', data: station, text: 'Station k1 · Empty' });
    const { container } = render(<RestaurantCanvas onEmptySpaceClick={onEmptySpaceClick} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 100, clientY: 100 });

    expect(onEmptySpaceClick).not.toHaveBeenCalled();
  });

  it('does not report a staff click as empty space', () => {
    const onEmptySpaceClick = vi.fn();
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150, skill: 3 };
    useGameState.mockReturnValue({ ...state, staff: [staff], cashierStations: [] });
    findClickedEntity.mockReturnValue({ type: 'staff', data: staff, text: 'Sofia' });
    const { container } = render(<RestaurantCanvas onEmptySpaceClick={onEmptySpaceClick} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 200, clientY: 200 });

    expect(onEmptySpaceClick).not.toHaveBeenCalled();
  });

  it('does not report a placement click as empty space', () => {
    const onEmptySpaceClick = vi.fn();
    useGameState.mockReturnValue(placementState);
    const { container } = render(
      <RestaurantCanvas
        placementRequest={{ itemType: 'table' }}
        onEmptySpaceClick={onEmptySpaceClick}
      />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 600, clientY: 300 });

    expect(onEmptySpaceClick).not.toHaveBeenCalled();
  });

  it('does not report a movement click as empty space', () => {
    const onEmptySpaceClick = vi.fn();
    const { container } = render(<RestaurantCanvas onEmptySpaceClick={onEmptySpaceClick} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 20, clientY: 40 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(onEmptySpaceClick).not.toHaveBeenCalled();
  });

  it('does not report an overlay interaction as empty space', () => {
    const onEmptySpaceClick = vi.fn();
    render(<RestaurantCanvas onEmptySpaceClick={onEmptySpaceClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    expect(onEmptySpaceClick).not.toHaveBeenCalled();
  });

  it('opens a right-side detail panel when staff are clicked', () => {
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', morale: 79.6, salary: 150, skill: 3 };
    useGameState.mockReturnValue({
      ...state,
      staff: [staff],
      cashierStations: [{ id: 'cashier1', assignedStaffId: staff.id }],
    });
    findClickedEntity.mockReturnValue({ type: 'staff', data: staff, text: 'Sofia' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 200, clientY: 200 });

    expect(screen.getByRole('heading', { name: 'Sofia' })).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Staffing cashier')).toBeInTheDocument();
  });

  it('picks up staff for cursor placement and dispatches only after a valid click', () => {
    const dispatch = vi.fn();
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150, skill: 3, x: 200, y: 200, task: null };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({ ...state, staff: [staff], cashierStations: [] });
    useRenderState.mockReturnValue({ ...state, staff: [staff], cashierStations: [] });
    findClickedEntity.mockReturnValue({ type: 'staff', data: staff, text: 'Sofia' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);

    expect(drawStaffLayer.mock.calls.at(-1)[1].staff[0]).toMatchObject({ x: 500, y: 300 });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).toHaveBeenCalledWith({ type: 'MOVE_STAFF', id: 's1', x: 500, y: 300 });
  });

  it('keeps staff move active for invalid destinations and cancels with Escape', () => {
    const dispatch = vi.fn();
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150, skill: 3, x: 200, y: 200, task: null };
    const caseState = {
      ...state,
      staff: [staff],
      cashierStations: [],
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }],
    };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(caseState);
    useRenderState.mockReturnValue(caseState);
    findClickedEntity.mockReturnValue({ type: 'staff', data: staff, text: 'Sofia' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });

    expect(screen.getByText('Invalid: overlap')).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('revalidates staff placement against occupancy changes before commit', () => {
    const dispatch = vi.fn();
    const staff = { id: 's1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150, skill: 3, x: 200, y: 200, task: null };
    const freeState = { ...state, staff: [staff], cashierStations: [] };
    const occupiedState = {
      ...freeState,
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }],
    };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(freeState);
    useRenderState.mockReturnValue(freeState);
    findClickedEntity.mockReturnValue({ type: 'staff', data: staff, text: 'Sofia' });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });

    useGameState.mockReturnValue(occupiedState);
    useRenderState.mockReturnValue(occupiedState);
    rerender(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid: overlap')).toBeInTheDocument();
  });

  it('uses unnumbered context-menu headings', () => {
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });
    expect(screen.getByText('Chair')).toBeInTheDocument();
    expect(screen.queryByText(/Table \d|Chair \d/)).not.toBeInTheDocument();
  });

  it('subscribes to live reduced-motion changes and removes the listener', () => {
    const previousMatchMedia = window.matchMedia;
    const listeners = new Set();
    const query = {
      matches: false,
      addEventListener: vi.fn((type, listener) => {
        if (type === 'change') listeners.add(listener);
      }),
      removeEventListener: vi.fn((type, listener) => {
        if (type === 'change') listeners.delete(listener);
      }),
    };
    window.matchMedia = vi.fn().mockReturnValue(query);
    const { container, unmount } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);

    try {
      runAnimationFrame(0);
      expect(drawStaffLayer.mock.calls.at(-1)[3]).toEqual(expect.objectContaining({
        timeMs: 0, reducedMotion: false, indexes: expect.any(Object),
      }));
      const listener = [...listeners][0];
      expect(listener).toBeTypeOf('function');
      act(() => listener({ matches: true }));
      runAnimationFrame(16);
      expect(drawStaffLayer.mock.calls.at(-1)[3]).toEqual(expect.objectContaining({
        timeMs: 16, reducedMotion: true, indexes: expect.any(Object),
      }));
      unmount();
      expect(query.removeEventListener).toHaveBeenCalledWith('change', listener);
      expect(listeners.size).toBe(0);
    } finally {
      if (previousMatchMedia === undefined) delete window.matchMedia;
      else window.matchMedia = previousMatchMedia;
    }
  });

  it('scales animation time with game speed and freezes it during game pause', () => {
    const normal = {
      ...state, paused: false, speed: 1,
      restaurant: { ...state.restaurant, gameTime: 10 },
    };
    useGameState.mockReturnValue(normal);
    useRenderState.mockReturnValue(normal);
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);

    runAnimationFrame(0);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(0);
    runAnimationFrame(100);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);

    const paused = { ...normal, paused: true };
    useGameState.mockReturnValue(paused);
    useRenderState.mockReturnValue(paused);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(200);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);
    runAnimationFrame(300);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);

    const resumed = { ...paused, paused: false };
    useGameState.mockReturnValue(resumed);
    useRenderState.mockReturnValue(resumed);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(400);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);
    runAnimationFrame(500);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(200);

    const fast = { ...resumed, speed: 2 };
    useGameState.mockReturnValue(fast);
    useRenderState.mockReturnValue(fast);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(600);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(200);
    runAnimationFrame(700);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(400);
  });

  it('resets the canvas animation clock when the game generation changes', () => {
    let generation = 1;
    const first = {
      ...state, paused: false, speed: 1,
      restaurant: { ...state.restaurant, gameTime: 10 },
    };
    useGameState.mockReturnValue(first);
    useRenderState.mockReturnValue(first);
    useGameGeneration.mockReturnValue(generation);
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);
    runAnimationFrame(0);
    runAnimationFrame(100);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);

    generation = 2;
    const next = { ...first, restaurant: { ...first.restaurant, gameTime: 20 } };
    useGameState.mockReturnValue(next);
    useRenderState.mockReturnValue(next);
    useGameGeneration.mockReturnValue(generation);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(116);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(0);
    runAnimationFrame(132);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(16);
  });

  it('freezes animation time while a career decision is pending', () => {
    const normal = {
      ...state, paused: false, speed: 1,
      restaurant: { ...state.restaurant, gameTime: 10 },
    };
    useGameState.mockReturnValue(normal);
    useRenderState.mockReturnValue(normal);
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);
    runAnimationFrame(0);
    runAnimationFrame(100);

    const decision = { ...normal, careerRun: { needsDecision: true } };
    useGameState.mockReturnValue(decision);
    useRenderState.mockReturnValue(decision);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(200);
    runAnimationFrame(300);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);

    useGameState.mockReturnValue(normal);
    useRenderState.mockReturnValue(normal);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(400);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);
    runAnimationFrame(500);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(200);
  });

  it('freezes animation time when a navigation fault stops simulation ticks', () => {
    const normal = {
      ...state, paused: false, speed: 1,
      restaurant: { ...state.restaurant, gameTime: 10 },
    };
    useGameState.mockReturnValue(normal);
    useRenderState.mockReturnValue(normal);
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);
    runAnimationFrame(0);
    runAnimationFrame(100);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);

    const navigationFault = { ...normal, navigationFault: { issues: [] } };
    useGameState.mockReturnValue(navigationFault);
    useRenderState.mockReturnValue(navigationFault);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(200);
    runAnimationFrame(300);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);

    useGameState.mockReturnValue(normal);
    useRenderState.mockReturnValue(normal);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(400);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(100);
    runAnimationFrame(500);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(200);
  });

  it('freezes animation time across a stopped runtime fault and recovery', () => {
    const reportFault = vi.fn();
    const normal = {
      ...state, paused: false, speed: 1,
      restaurant: { ...state.restaurant, gameTime: 10 },
    };
    useRuntimeFault.mockReturnValue({ fault: null, reportFault });
    useGameState.mockReturnValue(normal);
    useRenderState.mockReturnValue(normal);
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);
    runAnimationFrame(0);
    runAnimationFrame(100);
    const fault = new Error('injected runtime stop');
    drawFloorLayer.mockImplementationOnce(() => { throw fault; });
    runAnimationFrame(200);
    expect(reportFault).toHaveBeenCalledWith(fault, 'drawing');

    useRuntimeFault.mockReturnValue({ fault, reportFault });
    rerender(<RestaurantCanvas managementOpen={false} />);
    useRuntimeFault.mockReturnValue({ fault: null, reportFault });
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(216);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(200);
    runAnimationFrame(232);
    expect(drawStaffLayer.mock.calls.at(-1)[3].timeMs).toBe(216);
  });

  it('uses current canonical service items to validate carried-item gestures', () => {
    const task = { type: 'pickup_service_item', serviceItemId: 'dish', serviceTableId: 'counter' };
    const unladenStaff = [{ id: 'waiter', role: 'waiter', task, carryingServiceItemIds: [] }];
    const onService = [{ id: 'dish', kind: 'dish', state: 'on_service', serviceTableId: 'counter' }];
    const before = {
      ...state, paused: false, speed: 1,
      restaurant: { ...state.restaurant, gameTime: 10 },
      staff: unladenStaff, serviceItems: onService,
    };
    useGameState.mockReturnValue(before);
    useRenderState.mockReturnValue(before);
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    prepareCanvasForFrames(container);
    runAnimationFrame(0);

    const canonical = {
      ...before,
      restaurant: { ...before.restaurant, gameTime: 11 },
      staff: [{ ...unladenStaff[0], carryingServiceItemIds: ['dish'] }],
      serviceItems: [{ ...onService[0], state: 'carried', assignedStaffId: 'waiter' }],
    };
    const staleRender = { ...canonical, serviceItems: onService };
    useGameState.mockReturnValue(canonical);
    useRenderState.mockReturnValue(staleRender);
    rerender(<RestaurantCanvas managementOpen={false} />);
    runAnimationFrame(100);

    const options = drawStaffLayer.mock.calls.at(-1)[3];
    expect(options.gestures.get('waiter')).toBe('pickup');
    expect(canonical.serviceItems[0].state).toBe('carried');
    expect(staleRender.serviceItems[0].state).toBe('on_service');
  });

  it('stops the draw loop after a drawing fault without requeueing a frame', () => {
    const reportFault = vi.fn();
    useRuntimeFault.mockReturnValue({ fault: null, reportFault });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    const fault = new Error('injected drawing fault');
    drawFloorLayer.mockImplementationOnce(() => { throw fault; });
    const frame = requestAnimationFrame.mock.calls[0][0];
    act(() => frame(1250));

    expect(reportFault).toHaveBeenCalledWith(fault, 'drawing');
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('draws interpolated characters while retaining canonical interaction state', () => {
    const renderState = {
      ...state,
      staff: [{ id: 'moving', role: 'waiter', x: 150, y: 200 }],
    };
    useRenderState.mockReturnValue(renderState);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());

    requestAnimationFrame.mock.calls[0][0](0);

    expect(drawStaffLayer).toHaveBeenCalledWith(
      expect.anything(), renderState, expect.anything(), expect.anything(),
    );
  });

  it.each([
    [50, 57, 170, 147],
    [170, 147, 50, 57],
  ])('keeps the drag rectangle canvas-local from (%i, %i) to (%i, %i)', (startX, startY, endX, endY) => {
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    const { container } = render(<RestaurantCanvas />);
    const canvas = container.querySelector('canvas');
    // jsdom has no layout; supply the game area's offset beneath the stats bar.
    canvas.getBoundingClientRect = () => ({ left: 40, top: 47 });

    fireEvent.mouseDown(canvas, { clientX: startX, clientY: startY, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: endX, clientY: endY, buttons: 1 });

    const rectangle = container.querySelector('div[style*="pointer-events: none"]');
    expect(rectangle).toHaveStyle({
      position: 'absolute', left: '10px', top: '10px', width: '120px', height: '90px',
    });

    fireEvent.mouseUp(canvas, { clientX: endX, clientY: endY, button: 0 });
    expect(rectangle).not.toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('positions the context menu beside the click within an offset canvas', () => {
    const { container } = render(<RestaurantCanvas />);
    const canvas = container.querySelector('canvas');
    const wrapper = container.firstElementChild;
    const rect = (width, height) => ({
      width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0,
    });
    canvas.getBoundingClientRect = () => ({ ...rect(800, 600), left: 40, top: 47 });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function measuredRect() {
        if (this.getAttribute?.('aria-label') === 'Fixture actions') return rect(200, 300);
        if (this === wrapper) return rect(800, 600);
        return rect(0, 0);
      });
    try {
      fireEvent.click(canvas, { clientX: 200, clientY: 150 });

      expect(screen.getByRole('button', { name: 'Move' }).parentElement).toHaveStyle({
        position: 'absolute', left: '168px', top: '111px',
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('drag-selects multiple furniture items and exposes shared actions', () => {
    useGameState.mockReturnValue({
      ...state,
        tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
        chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    startDragSelection(canvas, 10, 10, 130, 100);
    finishDragSelection(canvas, 130, 100);

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move selected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell selected' })).toBeInTheDocument();
  });

  it.each([
    ['a mouseup outside the canvas', canvas => {
      fireEvent.mouseUp(document.body, { clientX: 400, clientY: 400, button: 0 });
    }],
    ['a window blur', () => {
      fireEvent.blur(window);
    }],
    ['re-entering the canvas with no primary button held', canvas => {
      fireEvent.mouseMove(canvas, { clientX: 350, clientY: 350, buttons: 0 });
    }],
  ])('cancels an interrupted selection drag on %s without replacing the previous selection', (
    _interruption,
    interrupt,
  ) => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    startDragSelection(canvas, 10, 10, 130, 100);
    finishDragSelection(canvas, 130, 100);
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Consume the click that follows the committed first drag, leaving the
    // previous selection intact and ready to distinguish a swallowed click.
    fireEvent.click(canvas);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    findClickedEntity.mockClear();

    startDragSelection(canvas, 200, 200, 300, 300);
    const rectangle = findSelectionRectangle(container);
    expect(rectangle).toBeInTheDocument();

    interrupt(canvas);

    expect(rectangle).not.toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(canvas, { clientX: 320, clientY: 320 });
    expect(findClickedEntity).toHaveBeenCalledTimes(1);
  });

  it('still commits a selection drag released inside the canvas', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    startDragSelection(canvas, 10, 10, 130, 100);
    const rectangle = findSelectionRectangle(container);
    expect(rectangle).toBeInTheDocument();

    finishDragSelection(canvas, 130, 100);

    expect(rectangle).not.toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves the previous selection alone for idle outside mouseup and window blur events', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    startDragSelection(canvas, 10, 10, 130, 100);
    finishDragSelection(canvas, 130, 100);
    fireEvent.click(canvas);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    findClickedEntity.mockClear();

    fireEvent.mouseUp(document.body, { clientX: 400, clientY: 400, button: 0 });
    fireEvent.blur(window);

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(findSelectionRectangle(container)).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
    expect(findClickedEntity).not.toHaveBeenCalled();
  });

  it('removes the persistent selection cancellation listeners on unmount', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = render(<RestaurantCanvas managementOpen={false} />);
      const mouseUpHandler = addListener.mock.calls
        .find(([type]) => type === 'mouseup')?.[1];
      const blurHandler = addListener.mock.calls
        .find(([type]) => type === 'blur')?.[1];

      expect(mouseUpHandler).toEqual(expect.any(Function));
      expect(blurHandler).toEqual(expect.any(Function));

      unmount();

      expect(removeListener).toHaveBeenCalledWith('mouseup', mouseUpHandler);
      expect(removeListener).toHaveBeenCalledWith('blur', blurHandler);
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });

  it('reviews drag-selected furniture before dispatching one atomic sale', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    expect(dispatch).not.toHaveBeenCalled();
    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(within(review).getByText('Table t1')).toBeInTheDocument();
    expect(within(review).getByText('Chair ch1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sell selected' })).not.toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm' }));

    const eligibleItems = [{ type: 'table', id: 't1' }, { type: 'chair', id: 'ch1' }];
    const expectedSale = getFixtureSaleExpectation(
      getSaleSelection(saleState, eligibleItems),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: eligibleItems,
      expectedSale,
    });
    expect(screen.queryByRole('region', { name: 'Review fixture sale' }))
      .not.toBeInTheDocument();
  });

  it('reviews protected selected dishwashers as excluded and sells only eligible fixtures', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [],
      washStations: [{ id: 'auto', type: 'automatic', x: 110, y: 60 }],
      serviceItems: [{ id: 'dirty', state: 'carried_dirty', reservedWashStationId: 'auto' }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 170, clientY: 130, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 170, clientY: 130, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    expect(dispatch).not.toHaveBeenCalled();
    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(within(review).getByText('Table t1')).toBeInTheDocument();
    expect(within(review).getByText('Wash station auto — In use')).toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm' }));

    const eligibleItems = [{ type: 'table', id: 't1' }];
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: eligibleItems,
      expectedSale: getFixtureSaleExpectation(getSaleSelection(saleState, eligibleItems)),
    });
  });

  it('reviews a single context-menu sale without dispatching until Confirm', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const table = { id: 't1', seats: 2, status: 'empty', x: 140, y: 100 };
    const saleState = {
      ...state,
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 150, y: 80, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sell' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    const requested = [{ type: 'table', id: 't1' }];
    const selection = getSaleSelection(saleState, requested);
    expect(within(review).getByText('Table t1')).toBeInTheDocument();
    expect(within(review).getByText('Removes chairs ch1')).toBeInTheDocument();
    expect(within(review).getByText(`Refund: $${selection.refund}`))
      .toBeInTheDocument();

    const confirm = within(review).getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: requested,
      expectedSale: getFixtureSaleExpectation(selection),
    });
  });

  it('shows eligible and excluded entries with reasons, linked chairs, and the selection refund', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 60, y: 60 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 },
        { id: 'ch2', tableId: 't1', x: 100, y: 100, rotation: 0 },
      ],
      washStations: [{ id: 'auto', type: 'automatic', x: 110, y: 60 }],
      serviceItems: [{ id: 'dirty', state: 'carried_dirty', reservedWashStationId: 'auto' }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 170, clientY: 130, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 170, clientY: 130, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(within(review).getByText('Table t1')).toBeInTheDocument();
    expect(within(review).getByText('Chair ch1')).toBeInTheDocument();
    expect(within(review).getByText('Chair ch2')).toBeInTheDocument();
    expect(within(review).getByText('Wash station auto — In use')).toBeInTheDocument();

    const selection = getSaleSelection(saleState, [
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
      { type: 'chair', id: 'ch2' },
    ]);
    const chairIds = [...selection.removedChairs].map(String).sort();
    expect(within(review).getByText(`Removes chairs ${chairIds.join(', ')}`))
      .toBeInTheDocument();
    expect(within(review).getByText(`Refund: $${selection.refund}`))
      .toBeInTheDocument();
  });

  it('cancels or dismisses a reviewed sale without dispatching', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    const openReview = () => {
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
      fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
      fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));
      return screen.getByRole('region', { name: 'Review fixture sale' });
    };

    const review = openReview();
    fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('region', { name: 'Review fixture sale' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell selected' })).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();

    const reopened = openReview();
    expect(within(reopened).getByText('Table t1')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: 'Review fixture sale' }))
      .not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps the reviewed request frozen and blocks canvas editing while open', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    const ch1 = { id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 };
    findClickedEntity.mockClear();
    findClickedEntity.mockReturnValue({ type: 'chair', data: ch1, text: 'Chair' });

    fireEvent.click(canvas, { clientX: 100, clientY: 70 });
    fireEvent.mouseDown(canvas, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 260, clientY: 260, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 260, clientY: 260, button: 0 });

    expect(findClickedEntity).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Review fixture sale' })).toBe(review);
    expect(within(review).getByText('Table t1')).toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refreshes a stale review with a notice and needs a second confirmation', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const table = { id: 't1', seats: 2, status: 'empty', x: 140, y: 100 };
    const saleState = {
      ...state,
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 150, y: 80, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

    const changedState = {
      ...saleState,
      chairs: [...saleState.chairs, { id: 'ch2', tableId: 't1', x: 150, y: 120, rotation: 0 }],
    };
    useGameState.mockReturnValue(changedState);
    rerender(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(dispatch).not.toHaveBeenCalled();
    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(within(review).getByRole('status')).toHaveTextContent(
      'Sale details changed. Review them before confirming again.',
    );
    const requested = [{ type: 'table', id: 't1' }];
    const changedSelection = getSaleSelection(changedState, requested);
    expect(within(review).getByText('Removes chairs ch1, ch2')).toBeInTheDocument();
    expect(within(review).getByText(`Refund: $${changedSelection.refund}`))
      .toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: requested,
      expectedSale: getFixtureSaleExpectation(changedSelection),
    });
  });

  it('disables Confirm when a refresh leaves no eligible item', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const table = { id: 't1', seats: 2, status: 'empty', x: 140, y: 100 };
    const saleState = {
      ...state,
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 150, y: 80, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

    const occupiedState = {
      ...saleState,
      tables: saleState.tables.map(candidate => ({ ...candidate, status: 'occupied' })),
    };
    useGameState.mockReturnValue(occupiedState);
    rerender(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(dispatch).not.toHaveBeenCalled();
    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(within(review).getByRole('status')).toHaveTextContent(
      'Sale details changed. Review them before confirming again.',
    );
    expect(within(review).getByText('Table t1 — In use')).toBeInTheDocument();
    expect(within(review).queryByText(/^Refund:/)).not.toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('reviews and sells a saved fixture with a numeric id through the real reducer', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const table = { id: 7, seats: 2, status: 'empty', x: 140, y: 100 };
    const saleState = {
      ...state,
      restaurant: { expansionLevel: 1, funds: 600 },
      tables: [table],
      chairs: [{ id: 8, tableId: 7, x: 150, y: 80, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

    const requested = [{ type: 'table', id: 7 }];
    const selection = getSaleSelection(saleState, requested);
    expect(selection).not.toBeNull();
    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(within(review).getByText('Table 7')).toBeInTheDocument();
    expect(within(review).getByText('Removes chairs 8')).toBeInTheDocument();
    expect(within(review).getByText(`Refund: $${selection.refund}`))
      .toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm' }));

    const expectedSale = getFixtureSaleExpectation(selection);
    expect(expectedSale.items).toEqual([
      { type: 'chair', id: '8' },
      { type: 'table', id: '7' },
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: requested,
      expectedSale,
    });

    const action = dispatch.mock.calls[0][0];
    const next = sellFixtures(saleState, action.items, action.expectedSale);
    expect(next).not.toBe(saleState);
    expect(next.tables).toEqual([]);
    expect(next.chairs).toEqual([]);
    expect(next.restaurant.funds).toBe(600 + selection.refund);
  });

  it('keeps raw numeric ids in a multi-select confirm payload with linked chairs', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      restaurant: { expansionLevel: 1, funds: 600 },
      tables: [{ id: 7, seats: 2, status: 'empty', x: 60, y: 60 }],
      chairs: [
        { id: 8, tableId: 7, x: 100, y: 70, rotation: 0 },
        { id: 9, tableId: 7, x: 100, y: 100, rotation: 0 },
      ],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 170, clientY: 130, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 170, clientY: 130, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(within(review).getByText('Table 7')).toBeInTheDocument();
    expect(within(review).getByText('Chair 8')).toBeInTheDocument();
    expect(within(review).getByText('Chair 9')).toBeInTheDocument();

    const requested = [
      { type: 'table', id: 7 },
      { type: 'chair', id: 8 },
      { type: 'chair', id: 9 },
    ];
    const selection = getSaleSelection(saleState, requested);
    expect(selection).not.toBeNull();
    expect(within(review).getByText('Removes chairs 8, 9')).toBeInTheDocument();
    expect(within(review).getByText(`Refund: $${selection.refund}`))
      .toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm' }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: requested,
      expectedSale: getFixtureSaleExpectation(selection),
    });

    const action = dispatch.mock.calls[0][0];
    const next = sellFixtures(saleState, action.items, action.expectedSale);
    expect(next.tables).toEqual([]);
    expect(next.chairs).toEqual([]);
    expect(next.restaurant.funds).toBe(600 + selection.refund);
  });

  it('dismisses an open review when management opens', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const table = { id: 't1', seats: 2, status: 'empty', x: 140, y: 100 };
    const saleState = {
      ...state,
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 150, y: 80, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(screen.getByRole('region', { name: 'Review fixture sale' })).toBeInTheDocument();

    rerender(<RestaurantCanvas managementOpen />);

    expect(screen.queryByRole('region', { name: 'Review fixture sale' }))
      .not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dismisses an open review when the game generation resets', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const table = { id: 't1', seats: 2, status: 'empty', x: 140, y: 100 };
    const saleState = {
      ...state,
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 150, y: 80, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue({ type: 'table', data: table, text: 'Dining table' });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(screen.getByRole('region', { name: 'Review fixture sale' })).toBeInTheDocument();

    useGameGeneration.mockReturnValue(1);
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(screen.queryByRole('region', { name: 'Review fixture sale' }))
      .not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('moves drag-selected furniture while preserving relative spacing', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'occupied' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
      customers: [{ id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1', x: 110, y: 80 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(canvas, { clientX: 130, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));
    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 580, buttons: 0 });
    fireEvent.mouseMove(canvas, { clientX: 140, clientY: 150, buttons: 0 });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);

    const furniturePreview = drawFurnitureLayer.mock.calls.at(-1)[1];
    const customerPreview = drawCustomerLayer.mock.calls.at(-1)[1];
    expect(furniturePreview.tables[0]).toMatchObject({ x: 140, y: 160 });
    expect(furniturePreview.chairs[0]).toMatchObject({ x: 180, y: 170 });
    expect(customerPreview.customers[0]).toMatchObject({ x: 190, y: 180 });
    fireEvent.click(canvas, { clientX: 140, clientY: 150 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [
        { type: 'table', id: 't1', x: 140, y: 160 },
        { type: 'chair', id: 'ch1', x: 180, y: 170, rotation: 0, tableId: 't1' },
      ],
    });
  });

  it.each([
    ['Copy', 'COPY_FIXTURES', 300, 580],
    ['Copy', 'COPY_FIXTURES', 60, 60],
    ['Move selected', 'MOVE_FIXTURES', 300, 580],
    ['Move selected', 'MOVE_FIXTURES', 60, 60],
  ])('anchors %s (%s) to the selection after first moving through (%i, %i)', (action, type, firstX, firstY) => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 95, clientY: 95 });
    fireEvent.click(screen.getByRole('button', { name: action }));
    fireEvent.mouseMove(canvas, { clientX: firstX, clientY: firstY });
    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 300 });
    fireEvent.click(canvas, { clientX: 300, clientY: 300 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type,
      items: [
        { type: 'table', id: 't1', x: 300, y: 300 },
        { type: 'chair', id: 'ch1', x: 340, y: 310, rotation: 0,
          ...(type === 'MOVE_FIXTURES' ? { tableId: 't1' } : {}) },
      ],
    });
  });

  it('puts Copy immediately before Move selected and previews the catalogue total', () => {
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 95, clientY: 95 });

    const copy = screen.getByRole('button', { name: 'Copy' });
    const move = screen.getByRole('button', { name: 'Move selected' });
    expect(copy.compareDocumentPosition(move) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(copy);

    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();
    expect(screen.getByText(/\$350/)).toBeInTheDocument();
  });

  it('dispatches one atomic table copy at the clicked destination without requiring mousemove', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 95, clientY: 95 });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(canvas, { clientX: 307, clientY: 303 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'COPY_FIXTURES',
      items: [
        { type: 'table', id: 't1', x: 300, y: 300 },
        { type: 'chair', id: 'ch1', x: 340, y: 310, rotation: 0 },
      ],
    });
  });

  it('uses the clicked destination after a stale copy preview', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 95, clientY: 95 });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 307, clientY: 303 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'COPY_FIXTURES',
      items: [
        { type: 'table', id: 't1', x: 300, y: 300 },
        { type: 'chair', id: 'ch1', x: 340, y: 310, rotation: 0 },
      ],
    });
  });

  it('keeps an invalid copy click rejected and shows validation feedback', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 95, clientY: 95 });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 60, clientY: 60 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid: The copy overlaps existing furniture.')).toBeInTheDocument();
  });

  it('keeps a copy rejected with a clear reason and cancels without dispatching', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [],
      chairs: [],
      kitchenStations: [{ id: 'k1', equipmentId: 'oven', x: 100, y: 120 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 180, clientY: 180, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 180, clientY: 180 });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(screen.getByText(/unique kitchen equipment cannot be copied/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
  });

  it('draws a cashier copy preview at the canonical dimensions', () => {
    useDispatch.mockReturnValue(vi.fn());
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [],
      chairs: [],
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
      cashierStations: [{ id: 'cashier1', x: 590, y: 300, w: 100, h: 60 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    const context = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      strokeRect: vi.fn(),
      translate: vi.fn(),
    };
    canvas.getContext = vi.fn(() => context);

    fireEvent.mouseDown(canvas, { clientX: 550, clientY: 260, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 710, clientY: 380, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 710, clientY: 380 });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    requestAnimationFrame.mock.calls.at(-1)[0](1000);

    expect(context.fillRect).toHaveBeenCalledWith(500, 300, 40, 40);
  });

  it('moves a selected wash station through the canvas action', () => {
    const dispatch = vi.fn(); useDispatch.mockReturnValue(dispatch);
    const station = { id: 'wash2', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({ ...state, washStations: [station] });
     findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Automatic dishwasher · 0 waiting' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    fireEvent.click(canvas, { clientX: 30, clientY: 50 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 163 });
    fireEvent.click(canvas, { clientX: 137, clientY: 163 });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'washStation', id: 'wash2', x: 140, y: 160 }],
    });
  });

  it('moves selected wash stations through explicit validated dispatches', () => {
    const dispatch = vi.fn(); useDispatch.mockReturnValue(dispatch);
    const station = { id: 'wash2', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({ ...state, washStations: [station] });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 140, clientY: 150 });
    fireEvent.click(canvas, { clientX: 140, clientY: 150 });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'washStation', id: 'wash2', x: 140, y: 160 }],
    });
  });

  it('previews wash stations while moving a mixed selection', () => {
    const station = { id: 'wash2', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({ ...state,
      tables: [{ id: 't1', x: 80, y: 40, status: 'empty' }], chairs: [], washStations: [station] });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100 });
    fireEvent.click(canvas, { clientX: 130, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 140, clientY: 150 });

    const frame = requestAnimationFrame.mock.calls.at(-1)[0];
    frame(1000);
    const previewState = drawFurnitureLayer.mock.calls.at(-1)[1];
    expect(previewState.washStations[0]).toMatchObject({ id: 'wash2', x: 80, y: 160 });
  });

  it.each([
    ['manual sink', { id: 'sink', type: 'manual', x: 20, y: 40, w: 40, h: 40 }, [], true, false],
    ['busy automatic station', { id: 'auto', type: 'automatic', x: 20, y: 40, w: 40, h: 40 },
      [{ id: 'dirty', state: 'queued_for_wash', washStationId: 'auto' }], true, false],
  ])('hides impossible context actions for a %s', (_label, station, serviceItems, moveVisible, sellVisible) => {
    useGameState.mockReturnValue({ ...state, washStations: [station], serviceItems });
    findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Wash station' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });
    expect(Boolean(screen.queryByRole('button', { name: /Move/ }))).toBe(moveVisible);
    expect(Boolean(screen.queryByRole('button', { name: 'Sell' }))).toBe(sellVisible);
  });

  it('hides Sell for a dishwasher with a carried-dirty reservation', () => {
    const station = { id: 'auto', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({
      ...state,
      washStations: [station],
      serviceItems: [{ id: 'dirty', state: 'carried_dirty', reservedWashStationId: 'auto' }],
    });
    findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Wash station' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });

    expect(screen.queryByRole('button', { name: 'Sell' })).not.toBeInTheDocument();
  });

  it.each([
    ['door', 'door', { id: 'door1', y: 340, role: 'entrance' }, 'Door · entrance'],
    ['service counter', 'serviceTable', { id: 'st1', x: 140, y: 120 }, 'Service counter'],
    ['cashier', 'cashierTable', { id: 'cashier1', x: 800, y: 120, w: 40, h: 40 }, 'Cashier'],
  ])('does not expose Sell for a %s in the narrow canvas UI', (_label, type, data, label) => {
    const collections = {
      door: 'doors',
      'serviceTable': 'serviceTables',
      cashierTable: 'cashierStations',
    };
    useGameState.mockReturnValue({
      ...state,
      [collections[type]]: [data],
    });
    findClickedEntity.mockReturnValue({
      type,
      data,
      text: label,
    });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 30, clientY: 50 });

    expect(screen.queryByRole('button', { name: 'Sell' })).not.toBeInTheDocument();
  });

  it('labels a wash-station context menu from the fixture catalogue', () => {
    const station = { id: 'wash2', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({ ...state, washStations: [station] });
     findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Automatic dishwasher · 0 waiting' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });
    expect(screen.getByText('Automatic dishwasher')).toBeInTheDocument();
    expect(screen.queryByText('Chair')).not.toBeInTheDocument();
  });

  it('offers explicit entrance and exit actions for a door context menu', () => {
    const dispatch = vi.fn();
    const door = { id: 'door1', y: 340, role: 'entrance' };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({ ...state, doors: [door] });
    findClickedEntity.mockReturnValue({ type: 'door', data: door, text: 'Door · entrance' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 907, clientY: 340 });

    expect(screen.getByText('Door · entrance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as exit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as entrance' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as exit' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_DOOR_ROLE', id: 'door1', role: 'exit' });
  });

  it('keeps door Move before both role actions in DOM order', () => {
    const door = { id: 'door1', y: 340 };
    useGameState.mockReturnValue({ ...state, doors: [door] });
    findClickedEntity.mockReturnValue({ type: 'door', data: door, text: 'Door' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 907, clientY: 340 });

    const menu = screen.getByText('Door').parentElement;
    const buttons = within(menu).getAllByRole('button').map(button => button.textContent.trim());
    const moveIndex = buttons.findIndex(label => label.startsWith('Move'));
    const entranceIndex = buttons.indexOf('Mark as entrance');
    const exitIndex = buttons.indexOf('Mark as exit');

    expect(moveIndex).toBeLessThan(entranceIndex);
    expect(moveIndex).toBeLessThan(exitIndex);
    expect(buttons).toContain('Move');
    expect(buttons).not.toContain('Move (R=rotate)');
  });

  it('labels a rotatable fixture Move exactly without a rotation suffix', () => {
    useGameState.mockReturnValue(state);
    findClickedEntity.mockReturnValue({ type: 'chair', data: chair, text: 'Chair' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 150, clientY: 80 });

    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move (R=rotate)' })).not.toBeInTheDocument();
  });

  it('shows authoritative dishwasher controls and dispatches only its id for an upgrade', () => {
    const dispatch = vi.fn();
    const station = {
      id: 'wash1', type: 'automatic', level: 1, x: 300, y: 120, w: 40, h: 40,
    };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 5_000, gameTime: 10 },
      washStations: [station],
      serviceItems: [
        { id: 'a', state: 'queued_for_wash', washStationId: 'wash1' },
        { id: 'b', state: 'washing', washStationId: 'wash1' },
      ],
    });
    findClickedEntity.mockReturnValue({
      type: 'washStation', data: station, text: 'Automatic dishwasher',
    });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 320, clientY: 140 });

    expect(screen.getByText('Level 1 / 10')).toBeInTheDocument();
    expect(screen.getByText('Occupancy 2 / 12')).toBeInTheDocument();
    expect(screen.getByText('Nominal 600 seconds per dish')).toBeInTheDocument();
    const nextUpgradeCost = getDishwasherStats(station.level).nextUpgradeCost;
    expect(screen.getByText(`Next upgrade $${nextUpgradeCost}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Upgrade dishwasher ($${nextUpgradeCost})` }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_DISHWASHER', id: 'wash1' });
  });

  it.each([
    ['carried_dirty', 'Occupancy 0 / 12'],
    ['queued_for_wash', 'Occupancy 1 / 12'],
    ['washing', 'Occupancy 1 / 12'],
  ])('shows only deposited dishes in dishwasher controls: %s', (itemState, count) => {
    const station = { id: 'wash1', type: 'automatic', level: 1, x: 300, y: 120, w: 40, h: 40 };
    useGameState.mockReturnValue({
      ...state,
      washStations: [station],
      serviceItems: [{ id: 'dish', state: itemState, washStationId: 'wash1' }],
    });
    findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Automatic dishwasher' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 320, clientY: 140 });

    expect(screen.getByText(count)).toBeInTheDocument();
  });

  it('reports deposited occupancy and incoming reservations from the shared split and preserves the upgrade payload', () => {
    const dispatch = vi.fn();
    const station = { id: 'wash1', type: 'automatic', level: 1, x: 300, y: 120, w: 40, h: 40 };
    const reserved = { id: 'reserved', state: 'dirty_at_table', reservedWashStationId: 'wash1' };
    const carried = { id: 'carried', state: 'carried_dirty', reservedWashStationId: 'wash1' };
    const task = { id: 'task', state: 'dirty_at_table' };
    const worker = {
      id: 'worker',
      task: { type: 'deliver_dirty_item', serviceItemId: 'task', washStationId: 'wash1' },
    };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 5_000, gameTime: 10 },
      washStations: [station],
      serviceItems: [
        { id: 'queued', state: 'queued_for_wash', washStationId: 'wash1' },
        { id: 'washing', state: 'washing', washStationId: 'wash1' },
        reserved,
        carried,
        task,
      ],
      staff: [worker],
    });
    findClickedEntity.mockReturnValue({
      type: 'washStation', data: station, text: 'Automatic dishwasher',
    });
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 320, clientY: 140 });

    expect(screen.getByText('Occupancy 2 / 12')).toBeInTheDocument();
    expect(screen.getByText('Incoming reservations: 3')).toBeInTheDocument();
    expect(screen.getByText(
      'Occupancy counts deposited items. Incoming reservations also use capacity.',
    )).toBeInTheDocument();

    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 5_000, gameTime: 10 },
      washStations: [station],
      serviceItems: [
        { id: 'queued', state: 'queued_for_wash', washStationId: 'wash1' },
        { id: 'washing', state: 'washing', washStationId: 'wash1' },
        { id: 'carried', state: 'queued_for_wash', washStationId: 'wash1' },
        reserved,
        task,
      ],
      staff: [worker],
    });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(screen.getByText('Occupancy 3 / 12')).toBeInTheDocument();
    expect(screen.getByText('Incoming reservations: 2')).toBeInTheDocument();
    expect(screen.queryByText('Incoming reservations: 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Occupancy 5 / 12')).not.toBeInTheDocument();

    const nextUpgradeCost = getDishwasherStats(station.level).nextUpgradeCost;
    fireEvent.click(screen.getByRole('button', { name: `Upgrade dishwasher ($${nextUpgradeCost})` }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_DISHWASHER', id: 'wash1' });
  });

  it('shows the level-ten dishwasher nominal duration as 300 seconds per dish', () => {
    const station = {
      id: 'wash1', type: 'automatic', level: 10, x: 300, y: 120, w: 40, h: 40,
    };
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 100_000, gameTime: 10 },
      washStations: [station],
    });
    findClickedEntity.mockReturnValue({
      type: 'washStation', data: station, text: 'Automatic dishwasher',
    });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);

    fireEvent.click(container.querySelector('canvas'), { clientX: 320, clientY: 140 });

    expect(screen.getByText('Level 10 / 10')).toBeInTheDocument();
    expect(screen.getByText('Nominal 300 seconds per dish')).toBeInTheDocument();
  });

  it.each([
    ['insufficient funds', 1, 50, true],
    ['maximum level', 10, 100_000, true],
  ])('disables dishwasher upgrade for %s', (_reason, level, funds, disabled) => {
    const station = {
      id: 'wash1', type: 'automatic', level, x: 300, y: 120, w: 40, h: 40,
    };
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds, gameTime: 10 },
      washStations: [station],
    });
    findClickedEntity.mockReturnValue({
      type: 'washStation', data: station, text: 'Automatic dishwasher',
    });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 320, clientY: 140 });

    const button = screen.getByRole('button', { name: level === 10 ? 'Dishwasher max level' : /Upgrade dishwasher/ });
    expect(button).toBeDisabled();
    expect(disabled).toBe(true);
  });

  const keyTargetCases = [
    ['input', host => {
      const input = document.createElement('input');
      host.append(input);
      return input;
    }],
    ['textarea', host => {
      const textarea = document.createElement('textarea');
      host.append(textarea);
      return textarea;
    }],
    ['select', host => {
      const select = document.createElement('select');
      host.append(select);
      return select;
    }],
    ['contenteditable child', host => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editable.append(child);
      host.append(editable);
      return child;
    }],
    ['role=textbox', host => {
      const node = document.createElement('div');
      node.setAttribute('role', 'textbox');
      node.tabIndex = 0;
      host.append(node);
      return node;
    }],
    ['role=combobox', host => {
      const node = document.createElement('div');
      node.setAttribute('role', 'combobox');
      node.tabIndex = 0;
      host.append(node);
      return node;
    }],
    ['role=spinbutton', host => {
      const node = document.createElement('div');
      node.setAttribute('role', 'spinbutton');
      node.tabIndex = 0;
      host.append(node);
      return node;
    }],
  ];

  it.each(keyTargetCases)(
    'ignores active-placement R and Escape from a focused %s',
    (_label, createTarget) => {
      const dispatch = vi.fn();
      const complete = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      useGameState.mockReturnValue({
        ...state,
        restaurant: { expansionLevel: 1, funds: 100_000 },
        tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
        chairs: [],
      });
      const { container } = render(
        <RestaurantCanvas
          managementOpen={false}
          placementRequest={{ itemType: 'chair' }}
          onPlacementComplete={complete}
        />,
      );
      const canvas = container.querySelector('canvas');
      const target = createTarget(container);

      const escapeEvent = createEvent.keyDown(target, { key: 'Escape' });
      expect(fireEvent(target, escapeEvent)).toBe(true);
      expect(escapeEvent.defaultPrevented).toBe(false);
      expect(complete).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();

      const rotateEvent = createEvent.keyDown(target, { key: 'r' });
      expect(fireEvent(target, rotateEvent)).toBe(true);
      expect(rotateEvent.defaultPrevented).toBe(false);

      fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
      fireEvent.click(canvas, { clientX: 137, clientY: 83 });

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'PLACE_ITEM', itemType: 'chair', rotation: 0,
      }));
      expect(complete).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['a defaultPrevented keydown', {}, true],
    ['an IME-composing keydown', { isComposing: true }, false],
    ['a repeated keydown', { repeat: true }, false],
    ['an alt-modified keydown', { altKey: true }, false],
    ['a ctrl-modified keydown', { ctrlKey: true }, false],
    ['a meta-modified keydown', { metaKey: true }, false],
    ['a shift-modified keydown', { shiftKey: true }, false],
  ])('ignores active-placement keys given %s', (_label, eventInit, prePrevented) => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 100_000 },
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
      chairs: [],
    });
    const { container } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'chair' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');

    const escapeEvent = createEvent.keyDown(window, { key: 'Escape', ...eventInit });
    const rotateEvent = createEvent.keyDown(window, { key: 'r', ...eventInit });
    if (prePrevented) {
      escapeEvent.preventDefault();
      rotateEvent.preventDefault();
    }
    fireEvent(window, escapeEvent);
    fireEvent(window, rotateEvent);

    if (!prePrevented) {
      expect(escapeEvent.defaultPrevented).toBe(false);
      expect(rotateEvent.defaultPrevented).toBe(false);
    }
    expect(complete).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();

    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLACE_ITEM', itemType: 'chair', rotation: 0,
    }));
  });

  it('ignores active-placement keys while management is open even from a body target', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 100_000 },
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
      chairs: [],
    });
    const placementRequest = { itemType: 'chair' };
    const { container, rerender } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={placementRequest}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();

    rerender(
      <RestaurantCanvas
        managementOpen
        placementRequest={placementRequest}
        onPlacementComplete={complete}
      />,
    );

    const rotateEvent = createEvent.keyDown(document.body, { key: 'r' });
    const escapeEvent = createEvent.keyDown(document.body, { key: 'Escape' });
    expect(fireEvent(document.body, rotateEvent)).toBe(true);
    expect(fireEvent(document.body, escapeEvent)).toBe(true);
    expect(rotateEvent.defaultPrevented).toBe(false);
    expect(escapeEvent.defaultPrevented).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();
  });

  it('rotates an active placement once for a bare-window R keydown', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 100_000 },
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
      chairs: [],
    });
    const { container } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'chair' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });

    const rotateEvent = createEvent.keyDown(window, { key: 'r' });
    fireEvent(window, rotateEvent);

    expect(rotateEvent.defaultPrevented).toBe(true);
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLACE_ITEM', itemType: 'chair', rotation: 1,
    }));
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('cancels an active placement once for a bare-window Escape keydown', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 100_000 },
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
      chairs: [],
    });
    const { container } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'chair' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Place Dining chair/)).not.toBeInTheDocument();
  });

  it('still dismisses a reviewed sale when Escape is pressed on the Cancel button', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    const review = screen.getByRole('region', { name: 'Review fixture sale' });
    const cancel = within(review).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: 'Review fixture sale' }))
      .not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('RestaurantCanvas fixture action panel', () => {
  let measurements;

  beforeEach(() => {
    measurements = {
      wrapper: { width: 320, height: 700 },
      panel: { width: 180, height: 120 },
    };
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReturnValue(state);
    useGameGeneration.mockReturnValue(0);
    useRenderState.mockImplementation(() => useGameState());
    useDispatch.mockReturnValue(vi.fn());
    findClickedEntity.mockReturnValue({ type: 'chair', data: chair, text: 'Chair' });
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeRect(width, height, left = 0, top = 0) {
    return {
      width,
      height,
      left,
      top,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  }

  function installResizeObserver() {
    const instances = [];
    class ResizeObserverStub {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        instances.push(this);
      }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    return { instances };
  }

  function renderMeasuredPanel({ click = { x: 0, y: 0 } } = {}) {
    const view = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = view.container.querySelector('canvas');
    const wrapper = view.container.firstElementChild;
    canvas.getBoundingClientRect = () => makeRect(
      measurements.wrapper.width,
      measurements.wrapper.height,
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measuredRect() {
      if (this.getAttribute?.('aria-label') === 'Fixture actions') {
        return makeRect(measurements.panel.width, measurements.panel.height);
      }
      if (this === wrapper) {
        return makeRect(measurements.wrapper.width, measurements.wrapper.height);
      }
      return makeRect(0, 0);
    });
    fireEvent.click(canvas, { clientX: click.x, clientY: click.y });
    return { ...view, canvas, wrapper };
  }

  it('names the panel as a fixture-action region and clamps a lower-right click', () => {
    const { instances } = installResizeObserver();
    const { wrapper } = renderMeasuredPanel({ click: { x: 310, y: 690 } });

    const panel = screen.getByRole('region', { name: 'Fixture actions' });
    expect(panel).toHaveAttribute('role', 'region');
    expect(panel).not.toHaveAttribute('role', 'menu');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(panel).toHaveStyle({ position: 'absolute', left: '140px', top: '580px' });

    expect(instances[0].observe).toHaveBeenCalledWith(wrapper);
    expect(instances[0].observe).toHaveBeenCalledWith(panel);
  });

  it('keeps a top-left click at the eight-pixel offset', () => {
    installResizeObserver();
    renderMeasuredPanel();

    expect(screen.getByRole('region', { name: 'Fixture actions' })).toHaveStyle({
      left: '8px', top: '8px',
    });
  });

  it('bounds oversized content with scrollable border-box styles', () => {
    installResizeObserver();
    measurements.panel = { width: 500, height: 900 };
    renderMeasuredPanel();

    expect(screen.getByRole('region', { name: 'Fixture actions' })).toHaveStyle({
      boxSizing: 'border-box',
      maxWidth: '100%',
      maxHeight: '100%',
      overflowY: 'auto',
      minWidth: 'min(100px, 100%)',
    });
  });

  it('recomputes from the original click anchor when the wrapper resizes', () => {
    const { instances } = installResizeObserver();
    const { wrapper } = renderMeasuredPanel({ click: { x: 310, y: 690 } });
    const panel = screen.getByRole('region', { name: 'Fixture actions' });
    expect(panel).toHaveStyle({ left: '140px', top: '580px' });
    expect(instances).toHaveLength(1);
    expect(instances[0].observe.mock.calls.map(([element]) => element)).toEqual([wrapper, panel]);

    measurements.wrapper = { width: 200, height: 300 };
    act(() => instances[0].callback());

    expect(panel).toHaveStyle({ left: '20px', top: '180px' });

    measurements.wrapper = { width: 320, height: 700 };
    act(() => instances[0].callback());

    expect(panel).toHaveStyle({ left: '140px', top: '580px' });
  });

  it('falls back to window resize and removes the listener on unmount', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderMeasuredPanel({ click: { x: 310, y: 690 } });
    const resizeListener = addListener.mock.calls.find(([type]) => type === 'resize')?.[1];
    expect(resizeListener).toBeTypeOf('function');

    measurements.wrapper = { width: 200, height: 300 };
    act(() => window.dispatchEvent(new Event('resize')));

    expect(screen.getByRole('region', { name: 'Fixture actions' })).toHaveStyle({
      left: '20px', top: '180px',
    });

    unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', resizeListener);
  });

  it('repositions when dishwasher content grows', () => {
    const { instances } = installResizeObserver();
    const station = { id: 'wash1', type: 'automatic', level: 1, x: 300, y: 120, w: 40, h: 40 };
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 5_000, gameTime: 10 },
      washStations: [station],
      serviceItems: [],
    });
    findClickedEntity.mockReturnValue({
      type: 'washStation', data: station, text: 'Automatic dishwasher',
    });
    const { rerender } = renderMeasuredPanel({ click: { x: 310, y: 690 } });
    const panel = screen.getByRole('region', { name: 'Fixture actions' });
    expect(panel).toHaveStyle({ left: '140px', top: '580px' });

    measurements.panel = { width: 200, height: 260 };
    useGameState.mockReturnValue({
      ...state,
      restaurant: { expansionLevel: 1, funds: 5_000, gameTime: 10 },
      washStations: [station],
      serviceItems: [{ id: 'dirty', state: 'dirty_at_table', reservedWashStationId: 'wash1' }],
    });
    act(() => {
      rerender(<RestaurantCanvas managementOpen={false} />);
      instances[0].callback();
    });

    expect(screen.getByText('Incoming reservations: 1')).toBeInTheDocument();
    expect(panel).toHaveStyle({ left: '120px', top: '440px' });
  });

  it('disconnects the resize observer on unmount', () => {
    const { instances } = installResizeObserver();
    const { unmount } = renderMeasuredPanel();

    expect(instances).toHaveLength(1);
    unmount();
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the door action payload unchanged at a clamped position', () => {
    installResizeObserver();
    const dispatch = vi.fn();
    const door = { id: 'door1', y: 340, role: 'entrance' };
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({ ...state, doors: [door] });
    findClickedEntity.mockReturnValue({ type: 'door', data: door, text: 'Door · entrance' });
    renderMeasuredPanel({ click: { x: 310, y: 690 } });

    const panel = screen.getByRole('region', { name: 'Fixture actions' });
    expect(panel).toHaveStyle({ left: '140px', top: '580px' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark as exit' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_DOOR_ROLE', id: 'door1', role: 'exit' });
  });
});

const canvasHarness = { current: null };

function StatefulCanvas({ initial }) {
  const [state, dispatch] = useReducer(gameReducer, initial);
  canvasHarness.current = { state, dispatch };
  return <RestaurantCanvas managementOpen={false} />;
}

describe('RestaurantCanvas staff details focus', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameGeneration.mockReturnValue(0);
    useGameState.mockImplementation(() => canvasHarness.current.state);
    useDispatch.mockImplementation(() => canvasHarness.current.dispatch);
    useRenderState.mockImplementation(() => canvasHarness.current.state);
    findClickedEntity.mockReset();
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
  });

  const openStaffDetails = (initial) => {
    const view = render(<StatefulCanvas initial={initial} />);
    findClickedEntity.mockReturnValue({
      type: 'staff',
      data: initial.staff.find(worker => worker.id === 'starter-waiter'),
      text: 'Sofia',
    });
    fireEvent.click(view.container.querySelector('canvas'), { clientX: 10, clientY: 10 });
    return view;
  };

  it('exposes a focusable Restaurant canvas name', () => {
    const view = render(<StatefulCanvas initial={createInitialState()} />);

    const canvas = view.container.querySelector('canvas');
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(canvas).toHaveAccessibleName('Restaurant canvas');
  });

  it('returns focus to the canvas when the staff details panel is closed normally', () => {
    const view = openStaffDetails(createInitialState());
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close staff details' }));

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(view.container.querySelector('canvas')).toHaveFocus();
  });

  it('focuses the real staff heading on open and restores canvas focus on close', () => {
    const view = openStaffDetails(createInitialState());

    const heading = screen.getByRole('heading', { name: 'Sofia' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Sofia' })).toContainElement(heading);

    fireEvent.click(screen.getByRole('button', { name: 'Close staff details' }));

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(view.container.querySelector('canvas')).toHaveFocus();
  });

  it('returns focus to the canvas after a confirmed fire removes the employee', () => {
    const view = openStaffDetails(createInitialState());

    fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Sofia' }));

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(view.container.querySelector('canvas')).toHaveFocus();
  });
});

describe('RestaurantCanvas locate requests', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameGeneration.mockReset().mockReturnValue(0);
    useGameState.mockReset();
    useRenderState.mockReset();
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset();
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  const workerState = (worker, overrides = {}) => ({ ...state, staff: [worker], ...overrides });

  function renderWithViewport({ stateValue }) {
    useGameState.mockReturnValue(stateValue);
    useRenderState.mockImplementation(() => useGameState());
    const onLocateResult = vi.fn();
    const view = render(<RestaurantCanvas managementOpen={false} onLocateResult={onLocateResult} />);
    const canvas = view.container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 });
    canvas.getContext = vi.fn(() => drawingContext());
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](0));
    const camera = drawFloorLayer.mock.calls.at(-1)[2];
    return { view, canvas, camera, onLocateResult };
  }

  const guardCases = [
    {
      label: 'a generation mismatch',
      stateValue: () => workerState({ id: 'worker', x: 100, y: 60 }),
      props: () => ({ locateRequest: { id: 'worker', token: 1, generation: 1 } }),
    },
    {
      label: 'an unresolved raw id',
      stateValue: () => workerState({ id: 'worker', x: 100, y: 60 }),
      props: () => ({ locateRequest: { id: 'ghost', token: 1, generation: 0 } }),
    },
    {
      label: 'non-finite worker coordinates',
      stateValue: () => workerState({ id: 'worker', x: Number.NaN, y: 60 }),
      props: () => ({ locateRequest: { id: 'worker', token: 1, generation: 0 } }),
    },
    {
      label: 'a zero-width viewport',
      stateValue: () => workerState({ id: 'worker', x: 100, y: 60 }),
      props: () => ({ locateRequest: { id: 'worker', token: 1, generation: 0 } }),
      width: 0,
    },
    {
      label: 'an active placement request',
      stateValue: () => workerState({ id: 'worker', x: 100, y: 60 }),
      props: () => ({
        locateRequest: { id: 'worker', token: 1, generation: 0 },
        placementRequest: { itemType: 'chair' },
      }),
    },
    {
      label: 'a pending career decision',
      stateValue: () => ({
        ...workerState({ id: 'worker', x: 100, y: 60 }),
        careerRun: { needsDecision: true },
      }),
      props: () => ({ locateRequest: { id: 'worker', token: 1, generation: 0 } }),
    },
  ];

  it('centres the current employee at the preserved zoom and keeps the synced viewport on the next draw', () => {
    const worker = { id: 'worker', name: 'W', role: 'waiter', x: 120, y: 80 };
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { view, canvas, camera, onLocateResult } = renderWithViewport({
      stateValue: workerState(worker),
    });
    expect(camera.manual).toBe(false);
    camera.zoom = 2;
    camera.x = 5;
    camera.y = 6;
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 900 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 700 });
    const request = { id: 'worker', token: 1, generation: 0 };

    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        locateRequest={request} onLocateResult={onLocateResult} />);
    });

    expect(camera).toMatchObject({ x: 900 / 2 - 120 * 2, y: 700 / 2 - 80 * 2, zoom: 2, manual: true });
    expect(onLocateResult).toHaveBeenCalledTimes(1);
    expect(onLocateResult).toHaveBeenCalledWith({ token: 1, success: true });
    expect(canvas).toHaveFocus();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();

    calculateFitCamera.mockClear();
    useGameState.mockReturnValue(workerState({ ...worker, x: 500, y: 400 }));
    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        locateRequest={request} onLocateResult={onLocateResult} />);
    });
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](16));

    expect(camera).toMatchObject({ x: 900 / 2 - 120 * 2, y: 700 / 2 - 80 * 2, zoom: 2, manual: true });
    expect(onLocateResult).toHaveBeenCalledTimes(1);
    expect(calculateFitCamera).not.toHaveBeenCalled();
  });

  it('locates the same employee again for a new token', () => {
    const worker = { id: 'worker', name: 'W', role: 'waiter', x: 100, y: 60 };
    const { view, camera, onLocateResult } = renderWithViewport({ stateValue: workerState(worker) });

    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        locateRequest={{ id: 'worker', token: 1, generation: 0 }} onLocateResult={onLocateResult} />);
    });
    expect(camera).toMatchObject({ x: 400 - 100, y: 300 - 60 });

    useGameState.mockReturnValue(workerState({ ...worker, x: 40, y: 30 }));
    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        locateRequest={{ id: 'worker', token: 2, generation: 0 }} onLocateResult={onLocateResult} />);
    });

    expect(camera).toMatchObject({ x: 400 - 40, y: 300 - 30 });
    expect(onLocateResult).toHaveBeenCalledTimes(2);
    expect(onLocateResult).toHaveBeenLastCalledWith({ token: 2, success: true });
  });

  it('consumes a token once even when the parent recreates the request object', () => {
    const worker = { id: 'worker', name: 'W', role: 'waiter', x: 100, y: 60 };
    const { view, camera, onLocateResult } = renderWithViewport({ stateValue: workerState(worker) });
    const request = { id: 'worker', token: 1, generation: 0 };

    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        locateRequest={request} onLocateResult={onLocateResult} />);
    });
    camera.zoom = 3;
    camera.x = 77;
    camera.y = 88;
    useGameState.mockReturnValue(workerState({ ...worker, x: 10, y: 10 }));

    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        locateRequest={{ ...request }} onLocateResult={onLocateResult} />);
    });

    expect(camera).toMatchObject({ x: 77, y: 88, zoom: 3 });
    expect(onLocateResult).toHaveBeenCalledTimes(1);
  });

  it.each(guardCases)('fails closed without touching the camera for $label', scenario => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { view, canvas, camera, onLocateResult } = renderWithViewport({
      stateValue: scenario.stateValue(),
    });
    if (scenario.width !== undefined) {
      Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: scenario.width });
    }
    camera.x = 11;
    camera.y = 12;
    camera.zoom = 1.5;
    camera.manual = false;

    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        onLocateResult={onLocateResult} {...scenario.props()} />);
    });

    expect(camera).toMatchObject({ x: 11, y: 12, zoom: 1.5, manual: false });
    expect(onLocateResult).toHaveBeenCalledTimes(1);
    expect(onLocateResult).toHaveBeenCalledWith({ token: 1, success: false });
    expect(dispatch).not.toHaveBeenCalled();

    act(() => {
      view.rerender(<RestaurantCanvas managementOpen={false}
        onLocateResult={onLocateResult} {...scenario.props()} />);
    });
    expect(onLocateResult).toHaveBeenCalledTimes(1);
  });
});

describe('RestaurantCanvas placement feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  const HINT = 'Arrow keys move when the canvas is focused. Enter or click to buy. '
    + 'R rotates supported items. Right click or Escape cancels.';
  const feedbackRegion = () => screen.getByRole('status', { name: 'Placement feedback' });
  const feedbackText = () => feedbackRegion().textContent;
  const chairState = {
    ...state,
    restaurant: { expansionLevel: 1, funds: 100_000 },
    tables: [{ id: 't1', seats: 2, status: 'empty', x: 140, y: 100 }],
    chairs: [],
  };

  function renderWithRequest(request, stateValue = placementState, extraProps = {}) {
    useGameState.mockReturnValue(stateValue);
    return render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={request}
        {...extraProps}
      />,
    );
  }

  it('mounts a persistent visually-hidden status region that starts empty', () => {
    useGameState.mockReturnValue(state);
    const { rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const region = feedbackRegion();

    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region.textContent).toBe('');
    expect(region).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    expect(region.style.clip).toContain('rect(0px, 0px, 0px, 0px)');
    expect(region.style.display).not.toBe('none');
    expect(region.style.visibility).not.toBe('hidden');

    rerender(<RestaurantCanvas managementOpen />);
    expect(feedbackRegion()).toBe(region);
    expect(feedbackRegion().textContent).toBe('');
  });

  it('announces the armed placement label and interaction hints', () => {
    renderWithRequest({ itemType: 'table' });

    expect(feedbackText()).toBe(`Placing Dining table. ${HINT}`);
  });

  it('resolves the equipment name in the armed announcement', () => {
    renderWithRequest({ itemType: 'equipmentStation', equipmentId: 'eq2' }, {
      ...placementState,
      equipment: [{ id: 'eq2', name: 'Oven', owned: false, purchaseCost: 500 }],
    });

    expect(feedbackText()).toBe(`Placing Oven. ${HINT}`);
  });

  it('announces an accepted rotation and keeps the rotated purchase payload', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = renderWithRequest({ itemType: 'chair' }, chairState);
    const canvas = container.querySelector('canvas');
    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });

    fireEvent.keyDown(window, { key: 'r' });
    expect(feedbackText()).toBe(
      'Placement rotated. Arrow keys move when the canvas is focused. '
      + 'Enter or click to buy. Escape to cancel.',
    );

    fireEvent.click(canvas, { clientX: 137, clientY: 83 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'chair', x: 140, y: 80, rotation: 1,
    });
    expect(feedbackText()).toBe('Placement submitted.');
  });

  it('leaves the armed announcement untouched for ignored rotation keys', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const request = { itemType: 'chair' };
    const { container, rerender } = renderWithRequest(request, chairState);
    const canvas = container.querySelector('canvas');
    const armed = `Placing Dining chair. ${HINT}`;
    expect(feedbackText()).toBe(armed);

    fireEvent.keyDown(window, { key: 'r', shiftKey: true });
    fireEvent.keyDown(window, { key: 'r', repeat: true });
    fireEvent.keyDown(window, { key: 'x' });
    expect(feedbackText()).toBe(armed);

    rerender(<RestaurantCanvas managementOpen placementRequest={request} />);
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(feedbackText()).toBe(armed);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('announces the label and reason of a blocked purchase click without dispatching', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = renderWithRequest(
      { itemType: 'chair' },
      { ...state, tables: [], chairs: [] },
      { onPlacementComplete: complete },
    );
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining chair: chair-table.');
    expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();
  });

  it('announces submission and keeps the terminal status when the request is withdrawn', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(placementState);
    const { container, rerender } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'table' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');
    const region = feedbackRegion();

    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 600, clientY: 300 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 600, y: 300, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(feedbackText()).toBe('Placement submitted.');

    rerender(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={null}
        onPlacementComplete={complete}
      />,
    );
    expect(feedbackRegion()).toBe(region);
    expect(feedbackText()).toBe('Placement submitted.');
    expect(screen.queryByText(/Place Dining table/)).not.toBeInTheDocument();
  });

  it('announces one cancellation for Escape and keeps the terminal status on withdrawal', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { rerender } = renderWithRequest({ itemType: 'table' }, placementState, {
      onPlacementComplete: complete,
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Placement cancelled.');

    rerender(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={null}
        onPlacementComplete={complete}
      />,
    );
    expect(feedbackText()).toBe('Placement cancelled.');
  });

  it('announces cancellation for a context-menu cancel of an actual placement', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = renderWithRequest({ itemType: 'table' }, placementState, {
      onPlacementComplete: complete,
    });

    fireEvent.contextMenu(container.querySelector('canvas'));

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(feedbackText()).toBe('Placement cancelled.');
  });

  it('does not announce placement cancellation for a copy-only cancel', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const copyState = {
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    useGameState.mockReturnValue(copyState);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    const startCopy = () => {
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 95, clientY: 95, buttons: 1 });
      fireEvent.mouseUp(canvas, { clientX: 95, clientY: 95 });
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();
    };

    startCopy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(feedbackText()).toBe('');

    startCopy();
    fireEvent.contextMenu(canvas);
    expect(feedbackText()).toBe('');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('announces cancellation when the request is withdrawn while a placement remains', () => {
    const complete = vi.fn();
    const { rerender } = renderWithRequest({ itemType: 'table' }, placementState, {
      onPlacementComplete: complete,
    });
    expect(feedbackText()).toBe(`Placing Dining table. ${HINT}`);

    rerender(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={null}
        onPlacementComplete={complete}
      />,
    );

    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Placement cancelled.');
    expect(screen.queryByText(/Place Dining table/)).not.toBeInTheDocument();
  });

  it('clears the status on a generation change', () => {
    const request = { itemType: 'table' };
    const { rerender } = renderWithRequest(request);
    expect(feedbackText()).toBe(`Placing Dining table. ${HINT}`);

    useGameGeneration.mockReturnValue(1);
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={request} />);

    expect(feedbackText()).toBe('');
  });

  it('clears instead of announcing a false cancellation when a generation change withdraws the request', () => {
    const request = { itemType: 'table' };
    const { rerender } = renderWithRequest(request);
    expect(feedbackText()).toBe(`Placing Dining table. ${HINT}`);

    useGameGeneration.mockReturnValue(1);
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={null} />);

    expect(feedbackText()).toBe('');
  });

  it('preserves the status region node through arm, rotation, submission and cancellation', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container, rerender } = renderWithRequest({ itemType: 'chair' }, chairState);
    const region = feedbackRegion();
    const canvas = container.querySelector('canvas');

    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.keyDown(window, { key: 'r' });
    expect(feedbackRegion()).toBe(region);

    fireEvent.click(canvas, { clientX: 137, clientY: 83 });
    expect(feedbackRegion()).toBe(region);

    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);
    expect(feedbackRegion()).toBe(region);
    expect(feedbackText()).toBe(`Placing Dining table. ${HINT}`);

    fireEvent.contextMenu(container.querySelector('canvas'));
    expect(feedbackRegion()).toBe(region);
    expect(feedbackText()).toBe('Placement cancelled.');
  });

  it('keeps the armed announcement across pointer, tick, management, zoom and ignored-key churn', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const request = { itemType: 'table' };
    const { container, rerender } = renderWithRequest(request, placementState);
    const canvas = container.querySelector('canvas');
    const armed = `Placing Dining table. ${HINT}`;
    expect(feedbackText()).toBe(armed);

    fireEvent.mouseMove(canvas, { clientX: 620, clientY: 320, buttons: 0 });
    expect(feedbackText()).toBe(armed);

    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { ...placementState.restaurant, gameTime: 5 },
    });
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={request} />);
    expect(feedbackText()).toBe(armed);

    rerender(<RestaurantCanvas managementOpen placementRequest={request} />);
    expect(feedbackText()).toBe(armed);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(feedbackText()).toBe(armed);

    fireEvent.keyDown(window, { key: 'r', shiftKey: true });
    expect(feedbackText()).toBe(armed);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('bounds the live placement banner width without restyling the rest of the overlay', () => {
    renderWithRequest({ itemType: 'table' });

    const banner = screen.getByText(/Place Dining table/).parentElement;
    expect(banner.style.width).toBe('calc(100% - 32px)');
    expect(banner.style.boxSizing).toBe('border-box');
    expect(banner.style.overflowWrap).toBe('break-word');
    expect(banner).toHaveStyle({ textAlign: 'center' });
  });
});

describe('RestaurantCanvas keyboard placement', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  const feedbackText = () => screen.getByRole('status', { name: 'Placement feedback' }).textContent;

  function renderKeyboardPlacement({
    itemType = 'table',
    stateValue = placementState,
    props = {},
  } = {}) {
    useGameState.mockReturnValue(stateValue);
    const view = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType }}
        {...props}
      />,
    );
    const canvas = view.container.querySelector('canvas');
    return { ...view, canvas };
  }

  it.each([
    ['ArrowLeft', 200 - GRID_SIZE, 200],
    ['ArrowRight', 200 + GRID_SIZE, 200],
    ['ArrowUp', 200, 200 - GRID_SIZE],
    ['ArrowDown', 200, 200 + GRID_SIZE],
  ])('moves an armed placement one grid step for %s with real canvas focus', (key, x, y) => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement();
    canvas.focus();
    expect(canvas).toHaveFocus();

    const event = createEvent.keyDown(canvas, { key });
    fireEvent(canvas, event);
    expect(event.defaultPrevented).toBe(true);

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x, y, rotation: 0,
    });
    expect(feedbackText()).toBe('Placement submitted.');
  });

  it('moves placement in world units independently of camera zoom and origin', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container, canvas } = renderKeyboardPlacement();
    prepareCanvasForFrames(container);
    act(() => requestAnimationFrame.mock.calls.at(-1)[0](0));
    const camera = drawFloorLayer.mock.calls.at(-1)[2];
    camera.x = -640;
    camera.y = 215;
    camera.zoom = 2.75;
    camera.manual = true;

    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM',
      itemType: 'table',
      x: 200 + GRID_SIZE,
      y: 200 + GRID_SIZE,
      rotation: 0,
    });
  });

  it('keeps placement active when arrows flip it from valid to invalid and back', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const blockedState = {
      ...placementState,
      tables: [{ id: 'blocker', seats: 2, status: 'empty', x: 240, y: 200 }],
    };
    const { canvas } = renderKeyboardPlacement({
      stateValue: blockedState,
      props: { onPlacementComplete: complete },
    });
    canvas.focus();
    expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();
    expect(screen.getByText('Invalid: overlap')).toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('submits the initial placement on Enter without prior mouse movement', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement({
      props: { onPlacementComplete: complete },
    });
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(feedbackText()).toBe('Placement submitted.');
    expect(screen.queryByText(/Place Dining table/)).not.toBeInTheDocument();
  });

  it('keeps an initial invalid placement without dispatching on Enter', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement({
      itemType: 'chair',
      stateValue: { ...placementState, tables: [], chairs: [] },
      props: { onPlacementComplete: complete },
    });
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining chair: chair-table.');
    expect(screen.getByText(/Place Dining chair/)).toBeInTheDocument();
  });

  it('revalidates the displayed point against current funds and occupancy before Enter submits', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const request = <RestaurantCanvas
      managementOpen={false}
      placementRequest={{ itemType: 'table' }}
      onPlacementComplete={complete}
    />;
    useGameState.mockReturnValue(placementState);
    const { container, rerender } = render(request);
    const canvas = container.querySelector('canvas');
    useGameState.mockReturnValue({
      ...placementState,
      customers: [{ id: 'c1', state: 'waiting', x: 210, y: 210 }],
    });
    rerender(<RestaurantCanvas
      managementOpen={false}
      placementRequest={{ itemType: 'table' }}
      onPlacementComplete={complete}
    />);
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining table: actor-occupied.');
  });

  it('dispatches the same canonical payload for mouse and keyboard placement', () => {
    const keyboardDispatch = vi.fn();
    useDispatch.mockReturnValue(keyboardDispatch);
    useGameState.mockReturnValue(placementState);
    const keyboardView = render(
      <RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />,
    );
    const keyboardCanvas = keyboardView.container.querySelector('canvas');
    keyboardCanvas.focus();
    fireEvent.keyDown(keyboardCanvas, { key: 'ArrowRight' });
    fireEvent.keyDown(keyboardCanvas, { key: 'ArrowDown' });
    fireEvent.keyDown(keyboardCanvas, { key: 'Enter' });

    const mouseDispatch = vi.fn();
    useDispatch.mockReturnValue(mouseDispatch);
    useGameState.mockReturnValue(placementState);
    const mouseView = render(
      <RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />,
    );
    const mouseCanvas = mouseView.container.querySelector('canvas');
    fireEvent.mouseMove(mouseCanvas, {
      clientX: 200 + GRID_SIZE,
      clientY: 200 + GRID_SIZE,
      buttons: 0,
    });
    fireEvent.click(mouseCanvas, {
      clientX: 200 + GRID_SIZE,
      clientY: 200 + GRID_SIZE,
    });

    expect(keyboardDispatch).toHaveBeenCalledTimes(1);
    expect(mouseDispatch).toHaveBeenCalledTimes(1);
    expect(keyboardDispatch.mock.calls[0][0]).toEqual(mouseDispatch.mock.calls[0][0]);
  });

  it('consumes the placement once so repeated Enter and a following click do not resubmit', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement({
      props: { onPlacementComplete: complete },
    });
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'Enter' });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter and arrows originating from Buy and zoom buttons', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = renderKeyboardPlacement();
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.textContent = 'Buy';
    container.firstChild.appendChild(buy);
    buy.focus();
    const zoom = screen.getByRole('button', { name: 'Zoom in' });

    for (const control of [buy, zoom]) {
      control.focus();
      const enterEvent = createEvent.keyDown(control, { key: 'Enter' });
      fireEvent(control, enterEvent);
      expect(enterEvent.defaultPrevented).toBe(false);
      fireEvent.keyDown(control, { key: 'ArrowRight' });
    }

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();
  });

  it('ignores canvas keydown while the canvas is not the active element', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement();
    expect(canvas).not.toHaveFocus();

    const arrowEvent = createEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent(canvas, arrowEvent);
    expect(arrowEvent.defaultPrevented).toBe(false);
    fireEvent.keyDown(canvas, { key: 'Enter' });

    const zoom = screen.getByRole('button', { name: 'Zoom in' });
    zoom.focus();
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();

    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
  });

  it('ignores placement keys while management is open', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement({
      props: { managementOpen: true, onPlacementComplete: complete },
    });
    canvas.focus();

    const arrowEvent = createEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent(canvas, arrowEvent);
    const enterEvent = createEvent.keyDown(canvas, { key: 'Enter' });
    fireEvent(canvas, enterEvent);

    expect(arrowEvent.defaultPrevented).toBe(false);
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();
  });

  it('ignores placement keys while a fixture sale review is open', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const saleState = {
      ...state,
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    useGameState.mockReturnValue(saleState);
    const { container, rerender } = render(
      <RestaurantCanvas managementOpen={false} onPlacementComplete={complete} />,
    );
    const canvas = container.querySelector('canvas');
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));
    expect(screen.getByRole('region', { name: 'Review fixture sale' })).toBeInTheDocument();

    rerender(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'table' }}
        onPlacementComplete={complete}
      />,
    );
    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Review fixture sale' })).toBeInTheDocument();
  });

  it.each([
    ['a defaultPrevented keydown', {}, true],
    ['an IME-composing keydown', { isComposing: true }, false],
    ['a repeated keydown', { repeat: true }, false],
    ['an alt-modified keydown', { altKey: true }, false],
    ['a ctrl-modified keydown', { ctrlKey: true }, false],
    ['a meta-modified keydown', { metaKey: true }, false],
    ['a shift-modified keydown', { shiftKey: true }, false],
  ])('ignores keyboard placement given %s', (_label, eventInit, prePrevented) => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderKeyboardPlacement({
      props: { onPlacementComplete: complete },
    });
    canvas.focus();

    const arrowEvent = createEvent.keyDown(canvas, { key: 'ArrowRight', ...eventInit });
    const enterEvent = createEvent.keyDown(canvas, { key: 'Enter', ...eventInit });
    if (prePrevented) {
      arrowEvent.preventDefault();
      enterEvent.preventDefault();
    }
    fireEvent(canvas, arrowEvent);
    fireEvent(canvas, enterEvent);

    expect(arrowEvent.defaultPrevented).toBe(prePrevented);
    expect(enterEvent.defaultPrevented).toBe(prePrevented);
    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
  });
});

describe('RestaurantCanvas placement purchase eligibility', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  const feedbackText = () => screen.getByRole('status', { name: 'Placement feedback' }).textContent;
  const tablePrice = getPlaceable('table').price;

  function tableRequest(complete, props = {}) {
    return <RestaurantCanvas
      managementOpen={false}
      placementRequest={{ itemType: 'table' }}
      onPlacementComplete={complete}
      {...props}
    />;
  }

  function equipmentRequest(complete, props = {}) {
    return <RestaurantCanvas
      managementOpen={false}
      placementRequest={{ itemType: 'equipmentStation', equipmentId: 'eq2' }}
      onPlacementComplete={complete}
      {...props}
    />;
  }

  function equipmentState({ funds = 1000, ...overrides } = {}) {
    return {
      ...placementState,
      restaurant: { expansionLevel: 1, funds },
      equipment: [{
        id: 'eq2', name: 'Oven', owned: false, purchaseCost: 500, ...overrides,
      }],
    };
  }

  it('blocks a clear-geometry mouse purchase when funds drop while armed', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: 1000 },
    });
    const { container, rerender } = render(tableRequest(complete));
    const canvas = container.querySelector('canvas');
    expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();

    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: 5 },
    });
    rerender(tableRequest(complete));
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining table: Insufficient funds.');
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();
    expect(screen.queryByText('Invalid: Insufficient funds')).not.toBeInTheDocument();

    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: 1000 },
    });
    rerender(tableRequest(complete));
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('blocks a clear-geometry Enter purchase when funds drop while armed', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: 1000 },
    });
    const { container, rerender } = render(tableRequest(complete));
    const canvas = container.querySelector('canvas');
    canvas.focus();
    expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();

    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: 5 },
    });
    rerender(tableRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining table: Insufficient funds.');
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();

    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: 1000 },
    });
    rerender(tableRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('accepts a purchase when funds exactly equal the catalogue price', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: tablePrice },
    });
    const { container } = render(tableRequest(complete));
    const canvas = container.querySelector('canvas');
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM', itemType: 'table', x: 200, y: 200, rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects a purchase one unit below the exact catalogue price', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds: tablePrice - 1 },
    });
    const { container } = render(tableRequest(complete));
    const canvas = container.querySelector('canvas');
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining table: Insufficient funds.');
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
  ])('rejects non-finite funds (%s) without dispatching', (_label, funds) => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...placementState,
      restaurant: { expansionLevel: 1, funds },
    });
    const { container } = render(tableRequest(complete));
    const canvas = container.querySelector('canvas');
    canvas.focus();

    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Dining table: Insufficient funds.');
    expect(screen.getByText(/Place Dining table/)).toBeInTheDocument();
  });

  it('rechecks ownership and existence before consuming an armed equipment purchase', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(equipmentState());
    const { container, rerender } = render(equipmentRequest(complete));
    const canvas = container.querySelector('canvas');
    canvas.focus();
    expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();

    useGameState.mockReturnValue(equipmentState({ owned: true }));
    rerender(equipmentRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Oven: Purchase unavailable.');
    expect(screen.getByText(/Place Oven/)).toBeInTheDocument();

    useGameState.mockReturnValue({
      ...equipmentState(),
      equipment: [],
    });
    rerender(equipmentRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Equipment station: Purchase unavailable.');

    useGameState.mockReturnValue(equipmentState());
    rerender(equipmentRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLACE_ITEM',
      itemType: 'equipmentStation',
      equipmentId: 'eq2',
      x: 200,
      y: 200,
      rotation: 0,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rechecks a changed equipment cost against current funds while armed', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(equipmentState({ purchaseCost: 500, funds: 500 }));
    const { container, rerender } = render(equipmentRequest(complete));
    const canvas = container.querySelector('canvas');
    canvas.focus();

    useGameState.mockReturnValue(equipmentState({ purchaseCost: 501, funds: 500 }));
    rerender(equipmentRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Oven: Insufficient funds.');

    useGameState.mockReturnValue(equipmentState({ purchaseCost: Number.NaN, funds: 500 }));
    rerender(equipmentRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(feedbackText()).toBe('Cannot place Oven: Purchase unavailable.');

    useGameState.mockReturnValue(equipmentState({ purchaseCost: 500, funds: 500 }));
    rerender(equipmentRequest(complete));
    fireEvent.keyDown(canvas, { key: 'Enter' });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLACE_ITEM',
      itemType: 'equipmentStation',
      equipmentId: 'eq2',
    }));
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('RestaurantCanvas fixture move feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  const MOVING_TEXT = 'Moving fixtures. Click to place, R to rotate when available, '
    + 'or press Escape to cancel.';
  const ROTATED_TEXT = 'Fixture move rotated.';
  const SUBMITTED_TEXT = 'Fixture move submitted.';
  const CANCELLED_TEXT = 'Fixture move cancelled.';
  const fixtureFeedbackRegion = () => screen.getByRole('status', {
    name: 'Fixture move feedback',
  });
  const fixtureFeedbackText = () => fixtureFeedbackRegion().textContent;
  const placementFeedbackText = () => screen.getByRole('status', {
    name: 'Placement feedback',
  }).textContent;

  function renderMove(stateValue, clicked = null, props = {}) {
    useGameState.mockReturnValue(stateValue);
    findClickedEntity.mockReturnValue(clicked);
    const view = render(<RestaurantCanvas managementOpen={false} {...props} />);
    return { ...view, canvas: view.container.querySelector('canvas') };
  }

  function startMenuMove(canvas, click = { clientX: 100, clientY: 120 }) {
    fireEvent.click(canvas, click);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  }

  const table = { id: 't1', seats: 2, status: 'empty', x: 100, y: 120 };
  const tableMoveState = {
    ...makeFixtureMovementState('table'),
    tables: [table],
  };

  it('mounts a persistent visually-hidden status region that starts empty', () => {
    useGameState.mockReturnValue(state);
    const { rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const region = fixtureFeedbackRegion();

    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region.textContent).toBe('');
    expect(region).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    expect(region.style.clip).toContain('rect(0px, 0px, 0px, 0px)');
    expect(region.style.display).not.toBe('none');
    expect(region.style.visibility).not.toBe('hidden');

    rerender(<RestaurantCanvas managementOpen />);
    expect(fixtureFeedbackRegion()).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('announces a single-fixture move armed from the context menu', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });

    startMenuMove(canvas);

    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);
    expect(screen.getByText(/Click to place ·/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('announces a multi-fixture move armed from the selection actions', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const moveState = {
      ...makeFixtureMovementState('table'),
      tables: [{ id: 't1', seats: 2, x: 60, y: 60, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
    };
    const { canvas } = renderMove(moveState);

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));

    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('announces an accepted rotation and submits the rotated payload once', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderMove(state, { type: 'chair', data: chair, text: 'Chair' });
    startMenuMove(canvas, { clientX: 150, clientY: 80 });

    fireEvent.keyDown(window, { key: 'r' });
    expect(fixtureFeedbackText()).toBe(ROTATED_TEXT);

    fireEvent.mouseMove(canvas, { clientX: 137, clientY: 83, buttons: 0 });
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'chair', id: 'ch1', x: 140, y: 80, rotation: 1, tableId: 't1' }],
    });
    expect(fixtureFeedbackText()).toBe(SUBMITTED_TEXT);

    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fixtureFeedbackText()).toBe(SUBMITTED_TEXT);
  });

  it('announces the current validation reason for an invalid explicit click', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const moveState = makeFixtureMovementState('kitchenStation');
    moveState.tables = [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }];
    const station = moveState.kitchenStations[0];
    const { canvas } = renderMove(moveState, {
      type: 'kitchenStation', data: station, text: 'Drinks Dispenser',
    });
    startMenuMove(canvas);

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);

    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(fixtureFeedbackText()).toBe('Cannot move fixtures: overlap.');
    expect(screen.getByText(/Click to place ·/)).toBeInTheDocument();
  });

  it('uses the destination fallback when validation carries no reason', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });
    startMenuMove(canvas);

    validateFixtureMoves.mockReturnValueOnce({ valid: false, reason: null });
    fireEvent.click(canvas, { clientX: 100, clientY: 120 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(fixtureFeedbackText()).toBe('Cannot move fixtures: Destination is invalid.');
  });

  it('keeps the cancellation terminal after repeated Escape, pointers and rerenders', () => {
    const { canvas, rerender } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });
    startMenuMove(canvas);
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(fixtureFeedbackText()).toBe(CANCELLED_TEXT);
    expect(screen.queryByText(/Click to place ·/)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(fixtureFeedbackText()).toBe(CANCELLED_TEXT);
  });

  it('clears the text silently when management opens', () => {
    const { canvas, rerender } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });
    startMenuMove(canvas);
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);

    rerender(<RestaurantCanvas managementOpen />);
    expect(fixtureFeedbackText()).toBe('');

    rerender(<RestaurantCanvas managementOpen={false} />);
    expect(fixtureFeedbackText()).toBe('');
  });

  it('clears the text silently on a generation change', () => {
    const { canvas, rerender } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });
    startMenuMove(canvas);
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);

    useGameGeneration.mockReturnValue(1);
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(fixtureFeedbackText()).toBe('');
  });

  it('clears stale text when placement replaces the interaction mode', () => {
    const { canvas, rerender } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });
    startMenuMove(canvas);
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);

    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(fixtureFeedbackText()).toBe('');
  });

  it('stays quiet across pointer movement and state ticks until an explicit click', () => {
    const moveState = makeFixtureMovementState('table');
    moveState.tables = [{ id: 't1', seats: 2, status: 'empty', x: 100, y: 120 }];
    const { canvas, rerender } = renderMove(moveState, {
      type: 'table', data: moveState.tables[0], text: 'Dining table',
    });
    startMenuMove(canvas);
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200, buttons: 0 });
    useGameState.mockReturnValue({
      ...moveState,
      restaurant: { ...moveState.restaurant, gameTime: 5 },
      tables: [{ ...moveState.tables[0], status: 'occupied' }],
    });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);
    expect(screen.queryByText(/Cannot move fixtures/)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'r' });
    expect(fixtureFeedbackText()).toBe(MOVING_TEXT);
  });

  it('leaves the existing placement feedback region unchanged', () => {
    const { canvas } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    }, { placementRequest: { itemType: 'table' } });

    expect(placementFeedbackText()).toMatch(/^Placing Dining table\./);
    expect(fixtureFeedbackText()).toBe('');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(placementFeedbackText()).toBe('Placement cancelled.');
    expect(fixtureFeedbackText()).toBe('');

    expect(placementFeedbackText()).toBe('Placement cancelled.');
    expect(fixtureFeedbackText()).toBe('');
    expect(canvas).toBeInTheDocument();
  });

  it('bounds the live move banner width and wraps long content', () => {
    const { canvas } = renderMove(tableMoveState, {
      type: 'table', data: table, text: 'Dining table',
    });
    startMenuMove(canvas);

    const banner = screen.getByText(/Click to place ·/);
    expect(banner.style.width).toBe('calc(100% - 32px)');
    expect(banner.style.boxSizing).toBe('border-box');
    expect(banner.style.overflowWrap).toBe('break-word');
    expect(banner).toHaveStyle({ textAlign: 'center' });
  });
});

describe('RestaurantCanvas fixture copy feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
    validateFixtureCopies.mockClear();
    validateFixtureMoves.mockClear();
  });

  const COPYING_TEXT = 'Copying fixtures. Click to purchase the copy or press Escape to cancel.';
  const SUBMITTED_TEXT = 'Fixture copy submitted.';
  const CANCELLED_TEXT = 'Fixture copy cancelled.';
  const MOVING_TEXT = 'Moving fixtures. Click to place, R to rotate when available, '
    + 'or press Escape to cancel.';
  const copyFeedbackRegion = () => screen.getByRole('status', {
    name: 'Fixture copy feedback',
  });
  const copyFeedbackText = () => copyFeedbackRegion().textContent;
  const moveFeedbackText = () => screen.getByRole('status', {
    name: 'Fixture move feedback',
  }).textContent;
  const placementFeedbackText = () => screen.getByRole('status', {
    name: 'Placement feedback',
  }).textContent;

  const copyState = {
    ...makeFixtureMovementState('table'),
    restaurant: { expansionLevel: 1, funds: 1000 },
    tables: [{ id: 't1', seats: 2, status: 'empty', x: 60, y: 60 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 70, rotation: 0 }],
  };

  function renderCopy(stateValue = copyState, props = {}, clicked = null) {
    useGameState.mockReturnValue(stateValue);
    findClickedEntity.mockReturnValue(clicked);
    const view = render(<RestaurantCanvas managementOpen={false} {...props} />);
    return { ...view, canvas: view.container.querySelector('canvas') };
  }

  function selectTableAndChair(canvas) {
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
  }

  function startCopy(canvas) {
    selectTableAndChair(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  }

  it('mounts a persistent visually-hidden status region that starts empty', () => {
    useGameState.mockReturnValue(state);
    const { rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const region = copyFeedbackRegion();

    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region.textContent).toBe('');
    expect(region).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    expect(region.style.clip).toContain('rect(0px, 0px, 0px, 0px)');
    expect(region.style.display).not.toBe('none');
    expect(region.style.visibility).not.toBe('hidden');

    rerender(<RestaurantCanvas managementOpen />);
    expect(copyFeedbackRegion()).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('announces the copy hint when Copy arms from a valid selection', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderCopy();

    startCopy(canvas);

    expect(copyFeedbackText()).toBe(COPYING_TEXT);
    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();
    expect(moveFeedbackText()).toBe('');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('arms copy from an existing unavailable selection without inventing a gate', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const unavailableState = {
      ...makeFixtureMovementState('table'),
      restaurant: { expansionLevel: 1, funds: 1000 },
      tables: [],
      chairs: [],
      kitchenStations: [{ id: 'k1', equipmentId: 'oven', x: 100, y: 120 }],
    };
    const { canvas } = renderCopy(unavailableState);

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 180, clientY: 180, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 180, clientY: 180, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copyFeedbackText()).toBe(COPYING_TEXT);
    expect(screen.getByText(/unique kitchen equipment cannot be copied/i)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('stays quiet across pointer movement and state ticks until an explicit click', () => {
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200, buttons: 0 });
    useGameState.mockReturnValue({
      ...copyState,
      restaurant: { ...copyState.restaurant, gameTime: 5 },
      tables: [{ ...copyState.tables[0], status: 'occupied' }],
    });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(copyFeedbackText()).toBe(COPYING_TEXT);
    expect(screen.queryByText(/Cannot copy fixtures/)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'r' });
    expect(copyFeedbackText()).toBe(COPYING_TEXT);
  });

  it('announces the current validation reason for an invalid explicit click', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderCopy();
    startCopy(canvas);

    fireEvent.click(canvas, { clientX: 60, clientY: 60 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(copyFeedbackText()).toBe('Cannot copy fixtures: overlap.');
    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();
  });

  it('uses the destination fallback when validation carries no reason', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderCopy();
    startCopy(canvas);

    validateFixtureCopies.mockReturnValueOnce({ valid: false, reason: null });
    fireEvent.click(canvas, { clientX: 307, clientY: 303 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(copyFeedbackText()).toBe('Cannot copy fixtures: Destination is invalid.');
    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();
  });

  it('reports the current cost guard without dispatching or leaving copy mode', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);

    useGameState.mockReturnValue({
      ...copyState,
      restaurant: { ...copyState.restaurant, funds: 100 },
    });
    rerender(<RestaurantCanvas managementOpen={false} />);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    fireEvent.click(canvas, { clientX: 307, clientY: 303 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(copyFeedbackText()).toBe('Cannot copy fixtures: insufficient-funds.');
    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();
  });

  it('submits the validated copy payload once and announces submission', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderCopy();
    startCopy(canvas);

    fireEvent.click(canvas, { clientX: 307, clientY: 303 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'COPY_FIXTURES',
      items: [
        { type: 'table', id: 't1', x: 300, y: 300 },
        { type: 'chair', id: 'ch1', x: 340, y: 310, rotation: 0 },
      ],
    });
    expect(copyFeedbackText()).toBe(SUBMITTED_TEXT);
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();

    fireEvent.click(canvas, { clientX: 307, clientY: 303 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(copyFeedbackText()).toBe(SUBMITTED_TEXT);
  });

  it('announces cancellation on Escape and keeps it terminal', () => {
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(copyFeedbackText()).toBe(CANCELLED_TEXT);
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(copyFeedbackText()).toBe(CANCELLED_TEXT);
  });

  it('announces cancellation on the context menu and keeps it terminal', () => {
    const { canvas } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    fireEvent.contextMenu(canvas);
    expect(copyFeedbackText()).toBe(CANCELLED_TEXT);
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();

    fireEvent.contextMenu(canvas);
    expect(copyFeedbackText()).toBe(CANCELLED_TEXT);
  });

  it('clears the text silently when management opens', () => {
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    rerender(<RestaurantCanvas managementOpen />);
    expect(copyFeedbackText()).toBe('');

    rerender(<RestaurantCanvas managementOpen={false} />);
    expect(copyFeedbackText()).toBe('');
  });

  it('clears the text silently on a generation change', () => {
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    useGameGeneration.mockReturnValue(1);
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(copyFeedbackText()).toBe('');
  });

  it('clears stale copy text when placement replaces the interaction mode', () => {
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(copyFeedbackText()).toBe('');
    expect(placementFeedbackText()).toMatch(/^Placing Dining table\./);
  });

  it('clears copy text when a fixture move replaces the mode and preserves move feedback', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderCopy(copyState, {}, {
      type: 'table', data: copyState.tables[0], text: 'Dining table',
    });
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(copyFeedbackText()).toBe(CANCELLED_TEXT);

    fireEvent.click(canvas, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(copyFeedbackText()).toBe('');
    expect(moveFeedbackText()).toBe(MOVING_TEXT);
    expect(placementFeedbackText()).toBe('');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('replaces an armed copy when a new placement request arrives', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    expect(copyFeedbackText()).toBe(COPYING_TEXT);

    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(copyFeedbackText()).toBe('');
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
    expect(placementFeedbackText()).toMatch(/^Placing Dining table\./);

    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 300 });
    fireEvent.click(canvas, { clientX: 600, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'PLACE_ITEM')).toHaveLength(1);
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'COPY_FIXTURES')).toHaveLength(0);

    fireEvent.click(canvas, { clientX: 307, clientY: 303 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'COPY_FIXTURES')).toHaveLength(0);
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
  });

  it('does not restore a replaced copy after Escape cancels the placement', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(placementFeedbackText()).toBe('Placement cancelled.');
    expect(copyFeedbackText()).toBe('');
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();

    fireEvent.click(canvas, { clientX: 307, clientY: 303 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'COPY_FIXTURES')).toHaveLength(0);
  });

  it('does not restore a replaced copy after the context menu cancels the placement', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderCopy();
    startCopy(canvas);
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
    fireEvent.contextMenu(canvas);

    expect(placementFeedbackText()).toBe('Placement cancelled.');
    expect(copyFeedbackText()).toBe('');
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();

    fireEvent.click(canvas, { clientX: 307, clientY: 303 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'COPY_FIXTURES')).toHaveLength(0);
  });

  it('bounds the live copy banner width and wraps long content', () => {
    const { canvas } = renderCopy();
    startCopy(canvas);

    const banner = screen.getByText(/Click to place copy/).parentElement;
    expect(banner.style.width).toBe('calc(100% - 32px)');
    expect(banner.style.boxSizing).toBe('border-box');
    expect(banner.style.overflowWrap).toBe('break-word');
    expect(banner).toHaveStyle({ textAlign: 'center' });
  });
});

describe('RestaurantCanvas staff move feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
    validateStaffMove.mockClear();
  });

  const MOVING_TEXT = 'Moving employee. Click a destination or press Escape to cancel.';
  const SUBMITTED_TEXT = 'Employee move submitted.';
  const CANCELLED_TEXT = 'Employee move cancelled.';
  const staffFeedbackRegion = () => screen.getByRole('status', {
    name: 'Staff move feedback',
  });
  const staffFeedbackText = () => staffFeedbackRegion().textContent;
  const otherFeedbackText = name => screen.getByRole('status', { name }).textContent;

  const worker = {
    id: 's1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150, skill: 3,
    x: 200, y: 200, task: null,
  };
  const staffState = {
    ...state,
    restaurant: { expansionLevel: 1, funds: 1000 },
    staff: [worker],
    cashierStations: [],
  };
  const staffClicked = { type: 'staff', data: worker, text: 'Sofia' };

  function renderStaffMove(stateValue = staffState, clicked = staffClicked, props = {}) {
    useGameState.mockReturnValue(stateValue);
    findClickedEntity.mockReturnValue(clicked);
    const view = render(<RestaurantCanvas managementOpen={false} {...props} />);
    return { ...view, canvas: view.container.querySelector('canvas') };
  }

  function startStaffMove(canvas) {
    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  }

  it('mounts a persistent visually-hidden status region that starts empty', () => {
    useGameState.mockReturnValue(state);
    const { rerender } = render(<RestaurantCanvas managementOpen={false} />);
    const region = staffFeedbackRegion();

    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region.textContent).toBe('');
    expect(region).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    expect(region.style.clip).toContain('rect(0px, 0px, 0px, 0px)');
    expect(region.style.display).not.toBe('none');
    expect(region.style.visibility).not.toBe('hidden');

    rerender(<RestaurantCanvas managementOpen />);
    expect(staffFeedbackRegion()).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('announces the move hint, closes the details panel and focuses the canvas', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderStaffMove();

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    expect(screen.getByRole('complementary', { name: 'Sofia' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(staffFeedbackText()).toBe(MOVING_TEXT);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(canvas).toHaveFocus();
    expect(screen.getByText(/Click to place staff/)).toBeInTheDocument();
    expect(otherFeedbackText('Placement feedback')).toBe('');
    expect(otherFeedbackText('Fixture move feedback')).toBe('');
    expect(otherFeedbackText('Fixture copy feedback')).toBe('');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('announces the current validation reason and retains the mode on an invalid explicit click', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const blockedState = {
      ...staffState,
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }],
    };
    const { canvas } = renderStaffMove(blockedState);
    startStaffMove(canvas);

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    expect(staffFeedbackText()).toBe(MOVING_TEXT);
    expect(screen.getByText('Invalid: overlap')).toBeInTheDocument();

    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(staffFeedbackText()).toBe('Cannot move employee: overlap.');
    expect(screen.getByText(/Click to place staff/)).toBeInTheDocument();
  });

  it('uses the destination fallback when validation carries no reason', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderStaffMove();
    startStaffMove(canvas);

    validateStaffMove.mockReturnValueOnce({ valid: false, reason: null });
    fireEvent.click(canvas, { clientX: 307, clientY: 303 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(staffFeedbackText()).toBe('Cannot move employee: Destination is invalid.');
    expect(screen.getByText(/Click to place staff/)).toBeInTheDocument();
  });

  it('revalidates against the latest state before committing', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderStaffMove();
    startStaffMove(canvas);
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });

    useGameState.mockReturnValue({
      ...staffState,
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }],
    });
    rerender(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(staffFeedbackText()).toBe('Cannot move employee: overlap.');
    expect(screen.getByText(/Click to place staff/)).toBeInTheDocument();
  });

  it('submits the exact payload once and announces submission', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderStaffMove();
    startStaffMove(canvas);
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    canvas.blur();
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'MOVE_STAFF', id: 's1', x: 500, y: 300 });
    expect(staffFeedbackText()).toBe(SUBMITTED_TEXT);
    expect(canvas).toHaveFocus();
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();

    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(staffFeedbackText()).toBe(SUBMITTED_TEXT);
  });

  it('announces cancellation on Escape, focuses the canvas and keeps it terminal', () => {
    const { canvas, rerender } = renderStaffMove();
    startStaffMove(canvas);
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    const zoom = screen.getByRole('button', { name: 'Zoom in' });
    zoom.focus();
    expect(zoom).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(staffFeedbackText()).toBe(CANCELLED_TEXT);
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();
    expect(canvas).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(staffFeedbackText()).toBe(CANCELLED_TEXT);
  });

  it('stays quiet across pointer movement and state ticks until an explicit click', () => {
    const { canvas, rerender } = renderStaffMove();
    startStaffMove(canvas);
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 0 });
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    useGameState.mockReturnValue({
      ...staffState,
      restaurant: { ...staffState.restaurant, gameTime: 5 },
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }],
    });
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(staffFeedbackText()).toBe(MOVING_TEXT);
    expect(screen.queryByText(/Cannot move employee/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'r' });
    expect(staffFeedbackText()).toBe(MOVING_TEXT);
  });

  it('clears the text silently and ends the move when management opens', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderStaffMove();
    startStaffMove(canvas);
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    rerender(<RestaurantCanvas managementOpen />);
    expect(staffFeedbackText()).toBe('');
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();

    rerender(<RestaurantCanvas managementOpen={false} />);
    expect(staffFeedbackText()).toBe('');
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_STAFF')).toHaveLength(0);
  });

  it('clears the text silently and ends the move on a generation change', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderStaffMove();
    startStaffMove(canvas);
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    useGameGeneration.mockReturnValue(1);
    rerender(<RestaurantCanvas managementOpen={false} />);

    expect(staffFeedbackText()).toBe('');
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();
    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_STAFF')).toHaveLength(0);
  });

  it('replaces an armed staff move with a placement without leaving it hidden', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderStaffMove();
    startStaffMove(canvas);
    expect(staffFeedbackText()).toBe(MOVING_TEXT);

    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(staffFeedbackText()).toBe('');
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();
    expect(otherFeedbackText('Placement feedback')).toMatch(/^Placing Dining table\./);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(otherFeedbackText('Placement feedback')).toBe('Placement cancelled.');
    expect(staffFeedbackText()).toBe('');

    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_STAFF')).toHaveLength(0);
    expect(screen.queryByText(/Click to place staff/)).not.toBeInTheDocument();
  });

  it('clears stale staff text when a fixture move replaces the mode', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderStaffMove();
    startStaffMove(canvas);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(staffFeedbackText()).toBe(CANCELLED_TEXT);

    findClickedEntity.mockReturnValue({
      type: 'table', data: staffState.tables[0], text: 'Dining table',
    });
    fireEvent.click(canvas, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(staffFeedbackText()).toBe('');
    expect(otherFeedbackText('Fixture move feedback')).toContain('Moving fixtures.');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves the placement feedback region unchanged', () => {
    const { canvas } = renderStaffMove(staffState, null, {
      placementRequest: { itemType: 'table' },
    });

    expect(otherFeedbackText('Placement feedback')).toMatch(/^Placing Dining table\./);
    expect(staffFeedbackText()).toBe('');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(otherFeedbackText('Placement feedback')).toBe('Placement cancelled.');
    expect(staffFeedbackText()).toBe('');
    expect(canvas).toBeInTheDocument();
  });

  it('bounds the live staff banner width and wraps long content', () => {
    const { canvas } = renderStaffMove();
    startStaffMove(canvas);

    const banner = screen.getByText(/Click to place staff/);
    expect(banner.style.width).toBe('calc(100% - 32px)');
    expect(banner.style.boxSizing).toBe('border-box');
    expect(banner.style.overflowWrap).toBe('break-word');
    expect(banner).toHaveStyle({ textAlign: 'center' });
  });
});

describe('RestaurantCanvas mode replacement lifetime', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useRuntimeFault.mockReset().mockReturnValue({ fault: null, reportFault: vi.fn() });
    useGameState.mockReset();
    useGameGeneration.mockReset().mockReturnValue(0);
    useRenderState.mockReset().mockImplementation(() => useGameState());
    useDispatch.mockReset().mockReturnValue(vi.fn());
    findClickedEntity.mockReset().mockReturnValue(null);
    adjustCameraZoom.mockReset();
    calculateFitCamera.mockReset().mockReturnValue({ x: 0, y: 0, zoom: 1 });
    screenToWorld.mockReset().mockImplementation((_camera, x, y) => ({ x, y }));
    [drawFloorLayer, drawFurnitureLayer, drawStaffLayer, drawCustomerLayer,
      drawQueueLayer, drawSelectionLayer, drawPlacementPreview].forEach(layer => layer.mockReset());
    createRenderIndexes.mockClear();
  });

  // React's delegated handler is the only exposed callback for the inline
  // context-menu action. Capture it before copy mode hides that menu, then
  // invoke the real closure after copy is armed.
  function captureReactOnClick(element) {
    const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
    return propsKey ? element[propsKey].onClick : null;
  }

  const fixtureMoveFeedback = () => screen.getByRole('status', {
    name: 'Fixture move feedback',
  }).textContent;
  const copyFeedback = () => screen.getByRole('status', {
    name: 'Fixture copy feedback',
  }).textContent;
  const placementFeedback = () => screen.getByRole('status', {
    name: 'Placement feedback',
  }).textContent;

  const table = { id: 't1', seats: 2, status: 'empty', x: 60, y: 60 };
  const replacementState = {
    ...makeFixtureMovementState('table'),
    restaurant: { expansionLevel: 1, funds: 100000 },
    tables: [{ ...table, x: 100, y: 120 }],
  };
  const tableState = {
    ...makeFixtureMovementState('table'),
    restaurant: { expansionLevel: 1, funds: 1000 },
    tables: [table],
  };
  const staffState = {
    ...tableState,
    staff: [{
      id: 's1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150, skill: 3,
      x: 200, y: 200, task: null,
    }],
    cashierStations: [],
  };

  function renderCanvas(stateValue, props = {}, clicked = null) {
    useGameState.mockReturnValue(stateValue);
    findClickedEntity.mockReturnValue(clicked);
    const view = render(<RestaurantCanvas managementOpen={false} {...props} />);
    return { ...view, canvas: view.container.querySelector('canvas') };
  }

  function armFixtureMove(canvas, click = { clientX: 100, clientY: 120 }) {
    fireEvent.click(canvas, click);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  }

  function selectTable(canvas) {
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
  }

  it('clears an armed fixture move when placement replaces it and never submits it after placement completion', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderCanvas(replacementState, {}, {
      type: 'table', data: replacementState.tables[0], text: 'Dining table',
    });

    armFixtureMove(canvas);
    expect(fixtureMoveFeedback()).toContain('Moving fixtures.');
    expect(screen.getByText(/Click to place ·/)).toBeInTheDocument();
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });

    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(fixtureMoveFeedback()).toBe('');
    expect(screen.queryByText(/Click to place ·/)).not.toBeInTheDocument();
    expect(placementFeedback()).toMatch(/^Placing Dining table\./);

    fireEvent.mouseMove(canvas, { clientX: 600, clientY: 300 });
    fireEvent.click(canvas, { clientX: 600, clientY: 300 });

    expect(dispatch.mock.calls.filter(([action]) => action.type === 'PLACE_ITEM')).toHaveLength(1);
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_FIXTURES')).toHaveLength(0);

    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 700, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_FIXTURES')).toHaveLength(0);
    expect(screen.queryByText(/Click to place ·/)).not.toBeInTheDocument();
  });

  it('clears an armed fixture move when placement replaces it and never resumes after placement cancellation', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas, rerender } = renderCanvas(replacementState, {}, {
      type: 'table', data: replacementState.tables[0], text: 'Dining table',
    });

    armFixtureMove(canvas);
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    rerender(<RestaurantCanvas managementOpen={false} placementRequest={{ itemType: 'table' }} />);

    expect(fixtureMoveFeedback()).toBe('');
    expect(screen.queryByText(/Click to place ·/)).not.toBeInTheDocument();

    fireEvent.contextMenu(canvas);

    expect(placementFeedback()).toBe('Placement cancelled.');
    expect(fixtureMoveFeedback()).toBe('');
    expect(screen.queryByText(/Click to place ·/)).not.toBeInTheDocument();

    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_FIXTURES')).toHaveLength(0);
  });

  it('clears an armed copy when a staff move replaces it and the staff move receives the next destination', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const worker = staffState.staff[0];
    const { canvas } = renderCanvas(staffState, {}, {
      type: 'staff', data: worker, text: 'Sofia',
    });

    fireEvent.click(canvas, { clientX: 200, clientY: 200 });
    const invokeStaffMove = captureReactOnClick(
      screen.getByRole('button', { name: 'Move' }),
    );
    expect(invokeStaffMove).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: 'Close staff details' }));

    selectTable(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyFeedback()).toContain('Copying fixtures.');
    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();

    act(() => invokeStaffMove());

    expect(copyFeedback()).toBe('');
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
    expect(screen.getByText(/Click to place staff/)).toBeInTheDocument();

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });

    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_STAFF')).toHaveLength(1);
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'COPY_FIXTURES')).toHaveLength(0);
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
  });

  it('clears an armed copy when a single fixture move replaces it and copy cannot resume', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { canvas } = renderCanvas(tableState, {}, {
      type: 'table', data: table, text: 'Dining table',
    });

    fireEvent.click(canvas, { clientX: 60, clientY: 60 });
    const invokeMoveEntity = captureReactOnClick(
      screen.getByRole('button', { name: 'Move' }),
    );
    expect(invokeMoveEntity).toBeTypeOf('function');

    selectTable(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyFeedback()).toContain('Copying fixtures.');
    expect(screen.getByText(/Click to place copy/)).toBeInTheDocument();

    act(() => invokeMoveEntity());

    expect(copyFeedback()).toBe('');
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
    expect(fixtureMoveFeedback()).toContain('Moving fixtures.');
    expect(screen.getByText(/Click to place ·/)).toBeInTheDocument();

    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 300, buttons: 0 });
    fireEvent.click(canvas, { clientX: 500, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'MOVE_FIXTURES')).toHaveLength(1);

    findClickedEntity.mockReturnValue(null);
    fireEvent.click(canvas, { clientX: 300, clientY: 300 });
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'COPY_FIXTURES')).toHaveLength(0);
    expect(screen.queryByText(/Click to place copy/)).not.toBeInTheDocument();
  });
});
