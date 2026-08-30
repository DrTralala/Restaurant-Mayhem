import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RestaurantCanvas from './RestaurantCanvas';
import { drawCustomerLayer, drawFurnitureLayer, drawStaffLayer } from './layers';
import { calculateFitCamera } from './camera';
import { useDispatch, useGameState } from '../state/GameContext';
import { useRenderState } from '../state/SimulationRuntime';
import { findClickedEntity } from './interaction';
import { getRestaurantWorld } from '../simulation/world';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

vi.mock('../state/SimulationRuntime', () => ({
  useRenderState: vi.fn(),
}));

vi.mock('./camera', () => ({
  adjustCameraZoom: vi.fn(),
  calculateFitCamera: vi.fn(),
  createCamera: () => ({ x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 3, manual: true }),
  screenToWorld: (_camera, x, y) => ({ x, y }),
}));

vi.mock('./sprites', () => ({ loadSprites: () => ({}) }));
vi.mock('./layers', () => ({
  drawFloorLayer: vi.fn(),
  drawFurnitureLayer: vi.fn(),
  drawStaffLayer: vi.fn(),
  drawCustomerLayer: vi.fn(),
  drawOverlayLayer: vi.fn(),
  drawQueueLayer: vi.fn(),
  drawSelectionLayer: vi.fn(),
  drawPlacementPreview: vi.fn(),
}));
vi.mock('./interaction', () => ({ findClickedEntity: vi.fn() }));

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
  tables: [],
  chairs: [],
  doors: [{ id: 'door1', y: 340 }],
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

function makeFixtureMovementState(type) {
  const movementState = {
    restaurant: { expansionLevel: 1 },
    tables: [],
    chairs: [],
    doors: [{ id: 'door1', y: 340 }],
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

const fixtureMovementCases = [
  ['table', 't1', 'Dining table'],
  ['chair', 'ch1', 'Chair'],
  ['door', 'door1', 'Door'],
  ['serviceTable', 'st1', 'Service counter'],
  ['cashierTable', 'cashier1', 'Cashier table'],
  ['kitchenStation', 'k1', 'Kitchen station'],
  ['washStation', 'wash1', 'Sink'],
];

describe('RestaurantCanvas object movement', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useGameState.mockReturnValue(state);
    useRenderState.mockImplementation(() => useGameState());
    useDispatch.mockReturnValue(vi.fn());
    findClickedEntity.mockReturnValue({ type: 'chair', data: chair, text: 'Chair' });
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
        ...(type === 'chair' ? { rotation: 0 } : {}),
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
    canvas.getContext = vi.fn(() => ({ scale: vi.fn(), fillText: vi.fn() }));
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

  it('keeps invalid fixture movement active and reports the validation reason', () => {
    const dispatch = vi.fn();
    const caseState = makeFixtureMovementState('kitchenStation');
    const station = caseState.kitchenStations[0];
    caseState.tables = [{ id: 't1', seats: 2, status: 'empty', x: 500, y: 300 }];
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue(caseState);
    findClickedEntity.mockReturnValue({ type: 'kitchenStation', data: station, text: 'Kitchen station' });
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

    expect(screen.getByText(/Click to place/)).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'chair', id: 'ch1', x: 140, y: 80, rotation: 0 }],
    });
  });

  it('previews an item, rotates a chair, and confirms only on left click', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
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
    expect(screen.getByText(/Place chair/)).toBeInTheDocument();
    fireEvent.click(canvas, { clientX: 137, clientY: 83 });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLACE_ITEM', itemType: 'chair', x: 140, y: 80, rotation: 1,
    }));
    expect(complete).toHaveBeenCalled();
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

      expect(screen.getByText(new RegExp(`Place ${itemType}`))).toBeInTheDocument();
      expect(screen.queryByText(/Invalid:/)).not.toBeInTheDocument();

      fireEvent.click(canvas, { clientX: x, clientY: y });

      expect(dispatch).toHaveBeenCalledWith({
        type: 'PLACE_ITEM', itemType, x, y, rotation: 0,
      });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(new RegExp(`Place ${itemType}`))).not.toBeInTheDocument();
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
    expect(screen.getByText(/Place chair/)).toBeInTheDocument();
    expect(screen.getByText(/chair-table/)).toBeInTheDocument();
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
    expect(screen.queryByText(/Place table/)).not.toBeInTheDocument();
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
      items: [{ type: 'chair', id: 'ch1', x: 130, y: 80, rotation: 0 }],
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

  it('uses unnumbered context-menu headings', () => {
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });
    expect(screen.getByText('Chair')).toBeInTheDocument();
    expect(screen.queryByText(/Table \d|Chair \d/)).not.toBeInTheDocument();
  });

  it('passes animation time and reduced-motion preference to character layers', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    canvas.getContext = vi.fn(() => ({ scale: vi.fn(), fillText: vi.fn() }));
    calculateFitCamera.mockReturnValue({ x: 0, y: 0, zoom: 1 });

    const frame = requestAnimationFrame.mock.calls[0][0];
    frame(1250);

    expect(drawStaffLayer).toHaveBeenCalledWith(
      expect.anything(), state, expect.anything(),
      { timeMs: 1250, reducedMotion: true },
    );
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
    canvas.getContext = vi.fn(() => ({ scale: vi.fn(), fillText: vi.fn() }));

    requestAnimationFrame.mock.calls[0][0](0);

    expect(drawStaffLayer).toHaveBeenCalledWith(
      expect.anything(), renderState, expect.anything(), expect.anything(),
    );
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

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move selected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell selected' })).toBeInTheDocument();
  });

  it('sells all drag-selected furniture in one action', () => {
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

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell selected' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELL_ITEMS',
      items: [{ type: 'table', id: 't1' }, { type: 'chair', id: 'ch1' }],
    });
  });

  it('moves drag-selected furniture while preserving relative spacing', () => {
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

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 130, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 130, clientY: 100, button: 0 });
    fireEvent.click(canvas, { clientX: 130, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 0 });
    fireEvent.mouseMove(canvas, { clientX: 140, clientY: 150, buttons: 0 });
    fireEvent.click(canvas, { clientX: 140, clientY: 150 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_FIXTURES',
      items: [
        { type: 'table', id: 't1', x: 100, y: 120 },
        { type: 'chair', id: 'ch1', x: 140, y: 120, rotation: 0 },
      ],
    });
  });

  it('moves a selected wash station through the canvas action', () => {
    const dispatch = vi.fn(); useDispatch.mockReturnValue(dispatch);
    const station = { id: 'wash2', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({ ...state, washStations: [station] });
    findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Automatic Dishwasher · 0 waiting' });
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
      items: [{ type: 'washStation', id: 'wash2', x: 60, y: 100 }],
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
    canvas.getContext = vi.fn(() => ({ scale: vi.fn(), fillText: vi.fn() }));
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
    expect(previewState.washStations[0]).toMatchObject({ id: 'wash2', x: 60, y: 100 });
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

  it('labels a wash-station context menu from the fixture catalogue', () => {
    const station = { id: 'wash2', type: 'automatic', x: 20, y: 40, w: 40, h: 40 };
    useGameState.mockReturnValue({ ...state, washStations: [station] });
    findClickedEntity.mockReturnValue({ type: 'washStation', data: station, text: 'Automatic Dishwasher · 0 waiting' });
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });
    expect(screen.getByText('Automatic dishwasher')).toBeInTheDocument();
    expect(screen.queryByText('Chair')).not.toBeInTheDocument();
  });
});
