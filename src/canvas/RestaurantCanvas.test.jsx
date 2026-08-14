import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RestaurantCanvas from './RestaurantCanvas';
import { drawStaffLayer } from './layers';
import { calculateFitCamera } from './camera';
import { useDispatch, useGameState } from '../state/GameContext';
import { findClickedEntity } from './interaction';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
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

const chair = { id: 'ch1', tableId: 't1', x: 20, y: 40, rotation: 0 };
const state = {
  restaurant: { expansionLevel: 1 },
  tables: [],
  chairs: [chair],
  staff: [],
  customers: [],
  queue: [],
  kitchenStations: [],
  serviceTables: [],
  foodItems: [],
  equipment: [],
  dishes: [],
};

describe('RestaurantCanvas object movement', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(vi.fn());
    findClickedEntity.mockReturnValue({ type: 'chair', data: chair, text: 'Chair' });
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
      type: 'MOVE_CHAIR', id: 'ch1', x: 140, y: 80, rotation: 0,
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

  it('cancels placement on right click and Escape without dispatching', () => {
    const dispatch = vi.fn();
    const complete = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({ ...state, tables: [], chairs: [] });
    const { container, rerender } = render(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'table' }}
        onPlacementComplete={complete}
      />,
    );
    const canvas = container.querySelector('canvas');

    fireEvent.contextMenu(canvas);
    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Place table/)).not.toBeInTheDocument();

    rerender(
      <RestaurantCanvas
        managementOpen={false}
        placementRequest={{ itemType: 'table' }}
        onPlacementComplete={complete}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Place table/)).not.toBeInTheDocument();
  });

  it('allows chairs to be placed between 20-pixel grid cells', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.click(canvas, { clientX: 20, clientY: 40 });
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    fireEvent.mouseMove(canvas, { clientX: 131, clientY: 91, buttons: 0 });
    fireEvent.click(canvas, { clientX: 131, clientY: 91 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_CHAIR', id: 'ch1', x: 130, y: 90, rotation: 0,
    });
  });

  it('closes the selected-object menu when management opens', () => {
    const { container, rerender } = render(<RestaurantCanvas managementOpen={false} />);
    fireEvent.click(container.querySelector('canvas'), { clientX: 20, clientY: 40 });
    expect(screen.getByRole('button', { name: /Move/ })).toBeInTheDocument();

    rerender(<RestaurantCanvas managementOpen />);

    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument();
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

  it('drag-selects multiple furniture items and exposes shared actions', () => {
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', x: 20, y: 20, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 70, y: 30, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100, button: 0 });

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move selected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell selected' })).toBeInTheDocument();
  });

  it('sells all drag-selected furniture in one action', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...state,
      tables: [{ id: 't1', x: 20, y: 20, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 70, y: 30, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100, button: 0 });
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
      tables: [{ id: 't1', x: 20, y: 20, status: 'empty' }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 70, y: 30, rotation: 0 }],
    });
    findClickedEntity.mockReturnValue(null);
    const { container } = render(<RestaurantCanvas managementOpen={false} />);
    const canvas = container.querySelector('canvas');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Move selected' }));
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100, buttons: 0 });
    fireEvent.mouseMove(canvas, { clientX: 140, clientY: 150, buttons: 0 });
    fireEvent.click(canvas, { clientX: 140, clientY: 150 });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_ITEMS',
      items: [
        { type: 'table', id: 't1', x: 60, y: 80 },
        { type: 'chair', id: 'ch1', x: 110, y: 80 },
      ],
    });
  });
});
