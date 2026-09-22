import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameProvider, useDispatch, useGameState } from './GameContext';
import { createInitialState } from './initialState';
import { hydrateState } from './persistence';
import { movementSaveSnapshot } from './movementPersistence';
import { getRestaurantWorld } from '../simulation/world';
import SettingsMenu from '../components/SettingsMenu';

function StaffNameHarness() {
  const state = useGameState();
  const dispatch = useDispatch();

  return (
    <>
      <span>{state.staff[0].name}</span>
      <span>${state.staff[0].salary}</span>
      <button onClick={() => dispatch({ type: 'RENAME_STAFF', id: state.staff[0].id, name: 'Matteo' })}>
        Rename starter
      </button>
      <button onClick={() => dispatch({ type: 'SET_STAFF_SALARY', id: state.staff[0].id, salary: 240 })}>
        Raise starter
      </button>
    </>
  );
}

function TableHarness() {
  const state = useGameState();
  const dispatch = useDispatch();
  const newestTableId = state.tables.at(-1).id;
  const rotations = state.chairs
    .filter(chair => chair.tableId === newestTableId)
    .map(chair => chair.rotation)
    .join(',');

  return (
    <>
      <span data-testid="newest-chair-rotations">{rotations}</span>
      <button onClick={() => dispatch({ type: 'ADD_TABLE' })}>Add table</button>
    </>
  );
}

function ItemHarness() {
  const state = useGameState();
  const dispatch = useDispatch();
  return (
    <>
      <span data-testid="funds">{state.restaurant.funds}</span>
      <span data-testid="table-count">{state.tables.length}</span>
      <span data-testid="chair-count">{state.chairs.length}</span>
      <span data-testid="door-count">{state.doors.length}</span>
      <button onClick={() => dispatch({ type: 'BUY_TABLE', cost: 1 })}>Buy table</button>
      <button onClick={() => dispatch({ type: 'BUY_CHAIR', cost: 1 })}>Buy chair</button>
      <button onClick={() => dispatch({ type: 'SELL_ITEMS', items: [{ type: 'chair', id: 'ch1' }] })}>Sell chair</button>
      <button onClick={() => dispatch({ type: 'BUY_DOOR', cost: 1 })}>Buy door</button>
    </>
  );
}

function ReducerHarness({ current }) {
  const state = useGameState();
  const dispatch = useDispatch();
  current.state = state;
  current.dispatch = dispatch;
  return null;
}

function renderReducer(overrides = {}) {
  const initial = createInitialState();
  const hasExplicitVersion = Object.prototype.hasOwnProperty.call(overrides, 'version');
  const saved = {
    ...initial,
    ...overrides,
    // Most reducer fixtures intentionally contain partial legacy-shaped records;
    // inject those directly instead of making them pretend to be v10 saves.
    ...(hasExplicitVersion ? {} : { version: undefined }),
    restaurant: { ...initial.restaurant, ...(overrides.restaurant || {}) },
  };
  if (hasExplicitVersion) localStorage.setItem('restaurant-sim-save', JSON.stringify(saved));
  const current = {};
  render(<GameProvider><ReducerHarness current={current} /></GameProvider>);
  if (!hasExplicitVersion) {
    act(() => current.dispatch({ type: 'LOAD_STATE', state: saved }));
  }
  return {
    dispatch(action) {
      act(() => current.dispatch(action));
    },
    get state() {
      return current.state;
    },
  };
}

describe('GameProvider operating-hours actions', () => {
  beforeEach(() => localStorage.clear());

  it('updates valid half-hour values atomically', () => {
    const game = renderReducer();

    game.dispatch({ type: 'SET_OPERATING_HOURS', openHour: 18.5, closeHour: 2 });

    expect(game.state.restaurant).toMatchObject({ openHour: 18.5, closeHour: 2 });
  });

  it('leaves both hours unchanged when either value is invalid', () => {
    const game = renderReducer({ restaurant: { openHour: 10, closeHour: 22 } });
    const before = game.state;

    game.dispatch({ type: 'SET_OPERATING_HOURS', openHour: 10.25, closeHour: 2 });

    expect(game.state).toBe(before);
    expect(game.state.restaurant).toMatchObject({ openHour: 10, closeHour: 22 });
  });
});

describe('GameProvider staff actions', () => {
  beforeEach(() => localStorage.clear());

  it('starts fresh rather than installing a local save with invalid fixture geometry', () => {
    const saved = createInitialState();
    saved.restaurant.funds = 999;
    saved.cashierStations[0].w = -1;
    const serialized = JSON.stringify(saved);
    localStorage.setItem('restaurant-sim-save', serialized);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<GameProvider><ItemHarness /></GameProvider>);
      expect(screen.getByTestId('funds')).toHaveTextContent('600');
      expect(localStorage.getItem('restaurant-sim-save')).toBe(serialized);
    } finally {
      warning.mockRestore();
    }
  });

  it('shows repository geometry rejection without replacing the current game', async () => {
    const saved = createInitialState();
    saved.restaurant.funds = 999;
    saved.cashierStations[0].w = -1;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ state: saved, filename: 'invalid.json' }),
    });
    const current = {};
    try {
      render(<GameProvider><ReducerHarness current={current} /><SettingsMenu isOpen /></GameProvider>);
      const before = current.state;
      await act(async () => screen.getByRole('button', { name: 'Load game' }).click());
      expect(screen.getByRole('status')).toHaveTextContent('Invalid saved navigation geometry');
      expect(current.state).toBe(before);
      expect(current.state.restaurant.funds).toBe(600);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('hydrates the current version without runtime state', () => {
    const game = renderReducer({ version: createInitialState().version, restaurant: { funds: 999 },
      movementCoordinator: { requests: { counterfeit: true } } });
    expect(game.state.version).toBe(createInitialState().version);
    expect(game.state.restaurant.funds).toBe(999);
    expect(game.state.movementCoordinator.requests).toEqual(new Map());
  });

  it.each([4, 5, 6])('ignores old version %s saves and starts fresh without deleting the saved JSON', version => {
    const saved = { ...createInitialState(), version, restaurant: { funds: 999 } };
    localStorage.setItem('restaurant-sim-save', JSON.stringify(saved));

    render(<GameProvider><ItemHarness /></GameProvider>);

    expect(screen.getByTestId('funds')).toHaveTextContent('600');
    expect(localStorage.getItem('restaurant-sim-save')).toBe(JSON.stringify(saved));
  });

  it('renames only the selected staff member', () => {
    render(
      <GameProvider>
        <StaffNameHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Rename starter' }).click());

    expect(screen.getByText('Matteo')).toBeInTheDocument();
  });

  it('updates only the selected staff salary', () => {
    render(
      <GameProvider>
        <StaffNameHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Raise starter' }).click());

    expect(screen.getByText('$240')).toBeInTheDocument();
  });

  it('rejects invalid salary adjustments and missing staff targets', () => {
    const game = renderReducer();

    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'starter-cook', salary: -1 });
    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'starter-cook', salary: Number.POSITIVE_INFINITY });
    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'missing', salary: 250 });

    expect(game.state.staff.find(staff => staff.id === 'starter-cook').salary).toBe(200);
    expect(game.state.staff).toHaveLength(5);
  });

  it('preserves raise-only salary adjustment semantics', () => {
    const game = renderReducer();

    game.dispatch({ type: 'SET_STAFF_SALARY', id: 'starter-cook', salary: 190 });

    expect(game.state.staff.find(staff => staff.id === 'starter-cook').salary).toBe(200);
  });

  it('hires a janitor through the reducer at the authoritative $120 salary', () => {
    const game = renderReducer({ restaurant: { funds: 500 } });

    game.dispatch({
      type: 'HIRE_STAFF',
      staff: { id: 'janitor-1', name: 'June', role: 'janitor', salary: 999, skill: 1, morale: 80 },
    });

    expect(game.state.restaurant.funds).toBe(380);
    expect(game.state.staff.at(-1)).toMatchObject({ role: 'janitor', salary: 120 });
  });

  it('hires beyond the legacy seven-staff capacity while charging each authoritative salary', () => {
    const game = renderReducer({ restaurant: { funds: 450 } });
    const makeStaff = id => ({ id, name: id, role: 'waiter', skill: 1, morale: 80, salary: 1 });

    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('sixth') });
    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('seventh') });
    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('eighth') });

    expect(game.state.staff).toHaveLength(8);
    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.staff.slice(-3).map(staff => staff.salary)).toEqual([150, 150, 150]);
  });

  it('accepts an exact-salary hire without requiring spare funds', () => {
    const game = renderReducer({ restaurant: { funds: 120 } });

    game.dispatch({
      type: 'HIRE_STAFF',
      staff: { id: 'janitor-exact', name: 'June', role: 'janitor', salary: 0, skill: 1, morale: 80 },
    });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.staff.at(-1)).toMatchObject({ role: 'janitor', salary: 120 });
  });

  it('gives every hire fresh all-work duty defaults instead of accepting caller runtime state', () => {
    const game = renderReducer({ restaurant: { funds: 300 } });
    const forgedSchedule = Array.from({ length: 48 }, () => 'rest');

    game.dispatch({
      type: 'HIRE_STAFF',
      staff: {
        id: 'hired-one', name: 'June', role: 'waiter', skill: 1, morale: 80,
        schedule: forgedSchedule, effectiveDuty: 'rest', task: { type: 'fake' },
      },
    });
    game.dispatch({
      type: 'HIRE_STAFF',
      staff: { id: 'hired-two', name: 'Jules', role: 'waiter', skill: 1, morale: 80 },
    });

    const first = game.state.staff.find(staff => staff.id === 'hired-one');
    const second = game.state.staff.find(staff => staff.id === 'hired-two');
    expect(first).toMatchObject({ salary: 150, effectiveDuty: 'work', dutyPhase: 'available', task: null });
    expect(first.schedule).toEqual(Array.from({ length: 48 }, () => 'work'));
    expect(first.schedule).not.toBe(second.schedule);
    first.schedule[0] = 'rest';
    expect(second.schedule[0]).toBe('work');
  });

  it('accepts only a complete cyclic staff schedule and copies the caller array', () => {
    const game = renderReducer();
    const validSchedule = Array.from({ length: 48 }, (_, index) =>
      index >= 10 && index < 24 ? 'pto' : 'work');

    game.dispatch({ type: 'SET_STAFF_SCHEDULE', id: 'starter-cook', schedule: validSchedule });

    const worker = game.state.staff.find(staff => staff.id === 'starter-cook');
    expect(worker.schedule).toEqual(validSchedule);
    expect(worker.schedule).not.toBe(validSchedule);
    expect(worker).toMatchObject({ effectiveDuty: 'work', dutyPhase: 'available' });
    validSchedule[0] = 'rest';
    expect(worker.schedule[0]).toBe('work');
  });

  it('rejects invalid staff schedules atomically', () => {
    const game = renderReducer();
    const before = game.state;
    const short = Array.from({ length: 47 }, () => 'work');
    const badMode = Array.from({ length: 48 }, () => 'work');
    badMode[0] = 'break';
    const shortPto = Array.from({ length: 48 }, (_, index) =>
      index < 13 ? 'pto' : 'work');

    for (const schedule of [short, badMode, shortPto]) {
      game.dispatch({ type: 'SET_STAFF_SCHEDULE', id: 'starter-cook', schedule });
      expect(game.state).toBe(before);
    }
    game.dispatch({ type: 'SET_STAFF_SCHEDULE', id: 'missing', schedule: badMode });
    expect(game.state).toBe(before);
  });

  it('moves staff through the guarded reducer action without accepting an invalid destination', () => {
    const game = renderReducer();
    const before = game.state;

    game.dispatch({ type: 'MOVE_STAFF', id: 'starter-cook', x: 500, y: 300 });
    expect(game.state.staff.find(staff => staff.id === 'starter-cook')).toMatchObject({ x: 500, y: 300 });

    const moved = game.state;
    game.dispatch({ type: 'MOVE_STAFF', id: 'starter-cook', x: Number.NaN, y: 300 });
    expect(game.state).toBe(moved);
    expect(game.state).not.toBe(before);
  });

  it('keeps a cashier assignment when its waiter is moved', () => {
    const game = renderReducer();

    game.dispatch({ type: 'MOVE_STAFF', id: 'starter-cashier-waiter', x: 500, y: 300 });

    expect(game.state.cashierStations[0]).toMatchObject({ assignedStaffId: 'starter-cashier-waiter' });
    expect(game.state.staff.find(staff => staff.id === 'starter-cashier-waiter'))
      .toMatchObject({ x: 500, y: 300, role: 'waiter', salary: 150 });
  });
});

describe('GameProvider furniture actions', () => {
  beforeEach(() => localStorage.clear());

  it('faces chairs added with a table inwards', () => {
    render(
      <GameProvider>
        <TableHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Add table' }).click());

    expect(screen.getByTestId('newest-chair-rotations')).toHaveTextContent('2,0,1,3');
  });

  it('allocates an added table after the greatest existing table suffix', () => {
    const game = renderReducer({
      tables: [
        { id: 't1', seats: 4, status: 'empty', x: 200, y: 200 },
        { id: 't3', seats: 4, status: 'empty', x: 360, y: 200 },
      ],
      chairs: [],
    });

    game.dispatch({ type: 'ADD_TABLE' });

    expect(game.state.tables.at(-1).id).toBe('t4');
  });

  it('allocates four unique chairs after the greatest existing chair suffix', () => {
    const game = renderReducer({
      chairs: [
        { id: 'ch1', tableId: 't1', x: 210, y: 180 },
        { id: 'ch5', tableId: 't1', x: 210, y: 240 },
      ],
    });

    game.dispatch({ type: 'ADD_TABLE' });

    const newTableId = game.state.tables.at(-1).id;
    const newChairIds = game.state.chairs
      .filter(chair => chair.tableId === newTableId)
      .map(chair => chair.id);
    expect(newChairIds).toEqual(['ch6', 'ch7', 'ch8', 'ch9']);
    expect(new Set(game.state.chairs.map(chair => chair.id)).size)
      .toBe(game.state.chairs.length);
  });

  it('buys tables and chairs while deducting their item prices', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Buy table' }).click());
    expect(screen.getByTestId('funds')).toHaveTextContent('300');
    expect(screen.getByTestId('table-count')).toHaveTextContent('5');

    act(() => screen.getByRole('button', { name: 'Buy chair' }).click());
    expect(screen.getByTestId('funds')).toHaveTextContent('250');
    expect(screen.getByTestId('chair-count')).toHaveTextContent('13');
  });

  it('refunds half the chair price when selling selected furniture', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Sell chair' }).click());

    expect(screen.getByTestId('funds')).toHaveTextContent('625');
    expect(screen.getByTestId('chair-count')).toHaveTextContent('11');
  });

  it('moves a free dishwasher, preserves invalid overlaps, and refunds an idle automatic station', () => {
    const game = renderReducer({ washStations: [{ id: 'wash2', type: 'automatic', x: 300, y: 120, w: 40, h: 40 }] });
    game.dispatch({ type: 'MOVE_WASH_STATION', id: 'wash2', x: 500, y: 300 });
    expect(game.state.washStations[0]).toMatchObject({ x: 500, y: 300 });
    game.dispatch({ type: 'MOVE_WASH_STATION', id: 'wash2', x: game.state.tables[0].x, y: game.state.tables[0].y });
    expect(game.state.washStations[0]).toMatchObject({ x: 500, y: 300 });
    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'washStation', id: 'wash2' }] });
    expect(game.state.washStations).toEqual([]);
    expect(game.state.restaurant.funds).toBe(1600);
  });

  it('blocks a manual wash station from being sold', () => {
    const station = { id: 'wash2', type: 'manual', x: 300, y: 120, w: 40, h: 40 };
    const game = renderReducer({ washStations: [station] });

    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'washStation', id: 'wash2' }] });

    expect(game.state.washStations).toEqual([station]);
    expect(game.state.restaurant.funds).toBe(600);
  });

  it.each(['queued_for_wash', 'washing'])('blocks an automatic wash station with %s work from being sold', state => {
    const station = { id: 'wash2', type: 'automatic', x: 300, y: 120, w: 40, h: 40 };
    const game = renderReducer({
      washStations: [station],
      serviceItems: [{ id: 'dirty', washStationId: 'wash2', state }],
    });

    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'washStation', id: 'wash2' }] });

    expect(game.state.washStations).toEqual([station]);
    expect(game.state.restaurant.funds).toBe(600);
  });

  it.each(['queued_for_wash', 'washing'])('rejects moving a busy automatic wash station with %s work', state => {
    const game = renderReducer({
      washStations: [{ id: 'wash2', type: 'automatic', x: 300, y: 120, w: 40, h: 40 }],
      serviceItems: [{ id: 'dirty', washStationId: 'wash2', washStartedAt: 10, state }],
    });
    const before = game.state;

    game.dispatch({ type: 'MOVE_WASH_STATION', id: 'wash2', x: 500, y: 300 });

    expect(game.state).toBe(before);
  });

  it.each([
    ['couch', 400, [
      { index: 0, reservedBy: null, occupiedBy: null },
      { index: 1, reservedBy: null, occupiedBy: null },
    ]],
    ['arcade', 800, [{ index: 0, reservedBy: null, occupiedBy: null }]],
    ['bed', 500, [{ index: 0, reservedBy: null, occupiedBy: null }]],
  ])('sells an idle %s at its canonical half-price refund', (type, price, slots) => {
    const amenity = { id: 'amenity1', type, x: 500, y: 300, rotation: 0, slots };
    const game = renderReducer({ restaurant: { funds: 600 }, staffAmenities: [amenity] });

    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'staffAmenity', id: 'amenity1' }] });

    expect(game.state.restaurant.funds).toBe(600 + Math.round(price * 0.5));
    expect(game.state.staffAmenities).toEqual([]);
  });

  it('rejects a sale batch atomically when any selected fixture is protected or stale', () => {
    const staff = createInitialState().staff.map(worker => worker.id === 'starter-cook'
      ? {
          ...worker,
          amenityUse: { amenityId: 'amenity1', slotIndex: 0, phase: 'reserved' },
        }
      : worker);
    const game = renderReducer({
      restaurant: { funds: 600 },
      staff,
      washStations: [{ id: 'auto', type: 'automatic', level: 1, x: 500, y: 120 }],
      staffAmenities: [{
        id: 'amenity1', type: 'couch', x: 500, y: 300, rotation: 0,
        slots: [
          { index: 0, reservedBy: 'starter-cook', occupiedBy: null },
          { index: 1, reservedBy: null, occupiedBy: null },
        ],
      }],
      serviceItems: [{ id: 'dirty', state: 'queued_for_wash', washStationId: 'auto' }],
    });
    const before = game.state;

    game.dispatch({ type: 'SELL_ITEMS', items: [
      { type: 'washStation', id: 'auto' },
      { type: 'staffAmenity', id: 'amenity1' },
    ] });
    expect(game.state).toBe(before);

    game.dispatch({ type: 'SELL_ITEMS', items: [
      { type: 'staffAmenity', id: 'amenity1' },
      { type: 'staffAmenity', id: 'missing' },
    ] });
    expect(game.state).toBe(before);
  });

  it('protects occupied furniture from direct deletion actions', () => {
    const game = renderReducer({
      tables: [{ id: 'table', seats: 1, status: 'occupied', x: 500, y: 300 }],
      chairs: [{ id: 'chair', tableId: 'table', x: 510, y: 280, rotation: 2 }],
      customers: [{ id: 'customer', tableId: 'table', chairId: 'chair', state: 'eating' }],
    });
    const before = game.state;

    game.dispatch({ type: 'DELETE_TABLE', id: 'table' });
    expect(game.state).toBe(before);
    game.dispatch({ type: 'DELETE_CHAIR', id: 'chair' });
    expect(game.state).toBe(before);
  });

  it('allows safe legacy table and chair deletion actions', () => {
    const game = renderReducer({
      tables: [{ id: 'table', seats: 1, status: 'empty', x: 500, y: 300 }],
      chairs: [{ id: 'chair', tableId: 'table', x: 510, y: 280, rotation: 2 }],
    });

    game.dispatch({ type: 'DELETE_CHAIR', id: 'chair' });
    expect(game.state.chairs).toEqual([]);

    game.dispatch({ type: 'DELETE_TABLE', id: 'table' });
    expect(game.state.tables).toEqual([]);
  });

  it('buys an additional door and deducts its item price', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Buy door' }).click());

    expect(screen.getByTestId('funds')).toHaveTextContent('200');
    expect(screen.getByTestId('door-count')).toHaveTextContent('3');
  });

  it('defaults purchased doors to entrances and supports changing a door role', () => {
    const game = renderReducer();

    game.dispatch({ type: 'BUY_DOOR' });
    expect(game.state.doors.at(-1)).toMatchObject({ role: 'entrance' });

    game.dispatch({ type: 'SET_DOOR_ROLE', id: 'door1', role: 'exit' });
    expect(game.state.doors.find(door => door.id === 'door1')).toMatchObject({ role: 'exit' });
  });

  it('protects doors referenced by active admissions and leavers from sale', () => {
    const game = renderReducer({
      doors: [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 440, role: 'exit' },
      ],
      customers: [
        { id: 'entering', state: 'entering', entryDoorId: 'door1', x: 973, y: 340 },
        { id: 'leaving', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2', x: 960, y: 460 },
      ],
      queueAdmissionGate: { partyId: 'party', customerIds: ['entering'], tableId: 't1', doorId: 'door1' },
      doorAdmissions: {
        nextSequence: 2,
        requests: { leaving: { doorId: 'door2', sequence: 1 } },
      },
    });

    const before = game.state;
    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'door', id: 'door1' }] });
    expect(game.state).toBe(before);
    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'door', id: 'door2' }] });
    expect(game.state).toBe(before);
  });

  it('allows a door sale when only a stale entry reference remains on a seated customer', () => {
    const game = renderReducer({
      doors: [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 440, role: 'exit' },
      ],
      customers: [{ id: 'seated', state: 'seated', entryDoorId: 'door1', x: 220, y: 190 }],
    });

    game.dispatch({ type: 'SELL_ITEMS', items: [{ type: 'door', id: 'door1' }] });

    expect(game.state.doors).toEqual([{ id: 'door2', y: 440, role: 'exit' }]);
  });
});

describe('GameProvider authoritative placement actions', () => {
  beforeEach(() => localStorage.clear());

  const authoritativePlacementCases = [
    {
      itemType: 'automaticDishwasher',
      cost: 2000,
      overrides: { restaurant: { funds: 2500 } },
      action: { x: 500, y: 300, rotation: 0, cost: 1 },
      assertPlacement(state) {
        expect(state.washStations).toContainEqual(expect.objectContaining({
          id: 'wash2', type: 'automatic', level: 1, x: 500, y: 300, w: 40, h: 40,
        }));
      },
    },
    {
      itemType: 'table',
      cost: 300,
      action: { x: 600, y: 300, rotation: 0, cost: 1 },
      assertPlacement(state) {
        expect(state.tables.at(-1)).toMatchObject({
          id: 't5', seats: 4, status: 'empty', x: 600, y: 300,
        });
      },
    },
    {
      itemType: 'chair',
      cost: 50,
      overrides: {
        tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 200 }],
        chairs: [],
      },
      action: { x: 210, y: 180, rotation: 2, cost: 1 },
      assertPlacement(state) {
        expect(state.chairs.at(-1)).toMatchObject({
          id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2,
        });
      },
    },
    {
      itemType: 'door',
      cost: 400,
      action: {
        x: getRestaurantWorld(createInitialState().restaurant).doorX,
        y: 181,
        rotation: 0,
        cost: 1,
      },
      assertPlacement(state) {
        expect(state.doors.at(-1)).toEqual({ id: 'door3', y: 180, role: 'entrance' });
      },
    },
    {
      itemType: 'serviceTable',
      cost: 300,
      action: { x: 400, y: 120, rotation: 1, cost: 1 },
      assertPlacement(state) {
        expect(state.serviceTables.at(-1)).toEqual({ id: 'st2', x: 400, y: 120, rotation: 1 });
      },
    },
    {
      itemType: 'cashierTable',
      cost: 300,
      action: { x: 600, y: 300, rotation: 0, cost: 1 },
      assertPlacement(state) {
        expect(state.cashierStations.at(-1)).toMatchObject({
          id: 'cashier2', x: 600, y: 300, w: 40, h: 40,
        });
      },
    },
  ];

  for (const { itemType, cost, overrides, action, assertPlacement } of authoritativePlacementCases) {
    it(`places a valid ${itemType} through the reducer at its catalogue price`, () => {
      const game = renderReducer(overrides);

      game.dispatch({ type: 'PLACE_ITEM', itemType, ...action });

    expect(game.state.restaurant.funds).toBe((overrides?.restaurant?.funds ?? 600) - cost);
      assertPlacement(game.state);
    });
  }

  it.each([
    ['couch', 400, 600, 300, 1],
    ['arcade', 800, 700, 300, 2],
    ['bed', 500, 600, 400, 3],
  ])('places a %s with canonical pricing, rotation and empty slots',
    (itemType, price, x, y, rotation) => {
      const game = renderReducer({
        restaurant: { funds: price },
        tables: [], chairs: [], kitchenStations: [], serviceTables: [],
        cashierStations: [], washStations: [], staffAmenities: [],
      });

      game.dispatch({ type: 'PLACE_ITEM', itemType, x, y, rotation, cost: 1 });

      expect(game.state.restaurant.funds).toBe(0);
      expect(game.state.staffAmenities).toContainEqual({
        id: 'amenity1', type: itemType, x, y, rotation,
        slots: itemType === 'couch'
          ? [
            { index: 0, reservedBy: null, occupiedBy: null },
            { index: 1, reservedBy: null, occupiedBy: null },
          ]
          : [{ index: 0, reservedBy: null, occupiedBy: null }],
      });
    });

  it('upgrades an automatic dishwasher at its authoritative cost after settling its old rate', () => {
    const game = renderReducer({
      restaurant: { funds: 100, gameTime: 100 },
      washStations: [{ id: 'auto', type: 'automatic', level: 1, x: 500, y: 120, w: 40, h: 40 }],
      serviceItems: [{
        id: 'dirty', state: 'washing', washStationId: 'auto', washStartedAt: 0,
        accumulatedWork: 0, lastProgressAt: 0,
      }],
    });

    game.dispatch({ type: 'UPGRADE_DISHWASHER', id: 'auto', cost: 1 });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.washStations[0]).toMatchObject({ id: 'auto', level: 2 });
    expect(game.state.serviceItems[0]).toMatchObject({
      state: 'washing', washStationId: 'auto', accumulatedWork: 100, lastProgressAt: 100,
    });
  });

  it('rejects invalid, stale, manual, capped and repeated dishwasher upgrades atomically', () => {
    const invalidCases = [
      { id: 'missing', station: null, funds: 100 },
      { id: 'manual', station: { id: 'manual', type: 'manual', x: 500, y: 120 }, funds: 100 },
      { id: 'max', station: { id: 'max', type: 'automatic', level: 10, x: 500, y: 120 }, funds: 100_000 },
      { id: 'fractional', station: { id: 'fractional', type: 'automatic', level: 1.5, x: 500, y: 120 }, funds: 100 },
      { id: 'poor', station: { id: 'poor', type: 'automatic', level: 1, x: 500, y: 120 }, funds: 99 },
    ];

    for (const { id, station, funds } of invalidCases) {
      const game = renderReducer({
        restaurant: { funds }, washStations: station ? [station] : [], serviceItems: [],
      });
      const before = game.state;
      game.dispatch({ type: 'UPGRADE_DISHWASHER', id, cost: -1000 });
      expect(game.state).toBe(before);
    }

    const repeated = renderReducer({
      restaurant: { funds: 100 },
      washStations: [{ id: 'auto', type: 'automatic', level: 1, x: 500, y: 120 }],
      serviceItems: [],
    });
    repeated.dispatch({ type: 'UPGRADE_DISHWASHER', id: 'auto', cost: 0 });
    const afterFirst = repeated.state;
    repeated.dispatch({ type: 'UPGRADE_DISHWASHER', id: 'auto', cost: 0 });
    expect(repeated.state).toBe(afterFirst);
    expect(repeated.state.restaurant.funds).toBe(0);
    expect(repeated.state.washStations[0].level).toBe(2);
  });

  it('rejects an overlapping placement without charging funds or adding the item', () => {
    const game = renderReducer({ restaurant: { funds: 300 } });
    const before = game.state;

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'table',
      x: 200,
      y: 200,
      rotation: 0,
      cost: 1,
    });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(300);
    expect(game.state.tables).toHaveLength(4);
  });

  it('charges the catalogue price and assigns a free waiter to a cashier station', () => {
    const game = renderReducer();

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'cashierTable',
      x: 600,
      y: 300,
      rotation: 0,
      cost: 1,
    });

    expect(game.state.restaurant.funds).toBe(300);
    expect(game.state.cashierStations.at(-1)).toMatchObject({
      id: 'cashier2',
      x: 600,
      y: 300,
      w: 40,
      h: 40,
      assignedStaffId: 'starter-waiter',
    });
    expect(game.state.staff).toHaveLength(5);
  });

  it('creates an unassigned cashier station when no waiter is available', () => {
    const initial = createInitialState();
    const game = renderReducer({
      staff: initial.staff.filter(staff => staff.role !== 'waiter'),
    });

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'cashierTable',
      x: 600,
      y: 300,
      rotation: 0,
    });

    expect(game.state.restaurant.funds).toBe(300);
    expect(game.state.cashierStations.at(-1)).not.toHaveProperty('assignedStaffId');
    expect(game.state.staff).toHaveLength(2);
  });

  it('assigns a newly placed cashier only to a genuinely available waiter', () => {
    const initial = createInitialState();
    const game = renderReducer({
      cashierStations: [],
      customers: [{ id: 'c2', state: 'waiting_for_items', dishId: 'd1', tableId: 't1' }],
      serviceItems: [{
        id: 'i2', kind: 'dish', menuItemId: 'd1', customerId: 'c2', tableId: 't1', state: 'carried',
      }],
      staff: initial.staff.map(staff => {
        if (staff.id === 'starter-waiter') {
           return { ...staff, task: { type: 'pickup_service_item', serviceItemId: 'i1' } };
        }
        if (staff.id === 'starter-host') {
           return { ...staff, carryingServiceItemIds: ['i2'] };
        }
        return staff;
      }),
    });

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'cashierTable',
      x: 600,
      y: 300,
      rotation: 0,
    });

    expect(game.state.restaurant.funds).toBe(300);
     expect(game.state.cashierStations.at(-1)).toHaveProperty('assignedStaffId', 'starter-cashier-waiter');
  });

  it('stores a snapped y coordinate for an authoritative door placement', () => {
    const initial = createInitialState();
    const game = renderReducer();
    const { doorX } = getRestaurantWorld(initial.restaurant);

    game.dispatch({
      type: 'PLACE_ITEM',
      itemType: 'door',
      x: doorX,
       y: 181,
      rotation: 0,
    });

    expect(game.state.doors.at(-1)).toEqual({ id: 'door3', y: 180, role: 'entrance' });
  });

  it('clears cashier assignments when firing staff', () => {
    const game = renderReducer({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'starter-waiter' },
        { id: 'cashier2', x: 600, y: 300, w: 80, h: 40, assignedStaffId: 'starter-waiter' },
      ],
    });

    game.dispatch({ type: 'FIRE_STAFF', id: 'starter-waiter' });

    expect(game.state.staff.some(staff => staff.id === 'starter-waiter')).toBe(false);
    expect(game.state.cashierStations).toEqual([
      { id: 'cashier1', x: 800, y: 120, w: 80, h: 40 },
      { id: 'cashier2', x: 600, y: 300, w: 80, h: 40 },
    ]);
  });

  it('forces a sleeping amenity release when firing without granting a recovery reward', () => {
    const game = renderReducer({
      restaurant: { gameTime: 100 },
      staff: [{
        id: 'sleeper', name: 'Pia', role: 'waiter', skill: 1, morale: 42, salary: 150,
        x: 610, y: 520, effectiveDuty: 'pto', dutyPhase: 'active',
        ptoSession: { sleepStartedAt: 100, minimumEndAt: 25_300, startingMorale: 42 },
        amenityUse: {
          amenityId: 'bed', slotIndex: 0, phase: 'occupied', activityStartedAt: 100,
          activityEndsAt: 25_300, lastRecoveryAt: 100,
        },
      }],
      cashierStations: [],
      staffAmenities: [{
        id: 'bed', type: 'bed', x: 600, y: 500, rotation: 0,
        slots: [{ index: 0, reservedBy: null, occupiedBy: 'sleeper' }],
      }],
    });

    game.dispatch({ type: 'FIRE_STAFF', id: 'sleeper' });

    expect(game.state.staff).toEqual([]);
    expect(game.state.staffAmenities[0].slots[0]).toEqual({
      index: 0, reservedBy: null, occupiedBy: null,
    });
  });

  it('releases every member of a cooking batch when firing its cook', () => {
    const game = renderReducer({
      staff: [{ id: 'batch-cook', role: 'cook', skill: 5, morale: 80, x: 200, y: 200 }],
      kitchenStations: [{ id: 'k1', equipmentId: null, x: 100, y: 120 }],
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'recipe' },
        { id: 'c2', state: 'waiting_for_items', dishId: 'recipe' },
      ],
      dishes: [{ id: 'recipe', prepTime: 60 }],
      serviceItems: [
        {
          id: 'i1', kind: 'dish', menuItemId: 'recipe', customerId: 'c1', state: 'preparing',
          batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'batch-cook', preparationStartedAt: 50,
        },
        {
          id: 'i2', kind: 'dish', menuItemId: 'recipe', customerId: 'c2', state: 'ready',
          batchId: 'batch-1', stationId: 'k1', assignedStaffId: 'batch-cook', readyAt: 80,
        },
      ],
      cookingBatches: [{
        id: 'batch-1', cookId: 'batch-cook', stationId: 'k1', serviceItemIds: ['i1', 'i2'],
        status: 'preparing', startedAt: 50,
      }],
    });

    game.dispatch({ type: 'FIRE_STAFF', id: 'batch-cook' });

    expect(game.state.cookingBatches).toEqual([]);
    expect(game.state.serviceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'i1', state: 'ordered', assignedStaffId: null }),
      expect.objectContaining({ id: 'i2', state: 'ready', assignedStaffId: null }),
    ]));
    expect(game.state.serviceItems.find(item => item.id === 'i1')).not.toHaveProperty('batchId');
    expect(game.state.serviceItems.find(item => item.id === 'i2')).not.toHaveProperty('batchId');
  });

  it('clears only the fired staff actor from movement runtime bookkeeping', () => {
    const game = renderReducer();
    const coordinator = game.state.movementCoordinator;
    const runtimeMaps = ['requests', 'statuses', 'claims', 'records', 'plans'];
    runtimeMaps.forEach(name => {
      coordinator[name].set('starter-waiter', { id: 'starter-waiter' });
      coordinator[name].set('starter-cook', { id: 'starter-cook' });
    });
    coordinator.diagnostics = {
      ...coordinator.diagnostics,
      waiting: new Map([['starter-waiter', true], ['starter-cook', true]]),
      actorExpansions: new Map([['starter-waiter', 1], ['starter-cook', 1]]),
      recoveries: new Map([['starter-waiter', 1], ['starter-cook', 1]]),
    };

    game.dispatch({ type: 'FIRE_STAFF', id: 'starter-waiter' });

    expect(game.state.staff.some(staff => staff.id === 'starter-waiter')).toBe(false);
    runtimeMaps.forEach(name => {
      expect(game.state.movementCoordinator[name].has('starter-waiter')).toBe(false);
      expect(game.state.movementCoordinator[name].has('starter-cook')).toBe(true);
    });
    ['waiting', 'actorExpansions', 'recoveries'].forEach(name => {
      expect(game.state.movementCoordinator.diagnostics[name].has('starter-waiter')).toBe(false);
      expect(game.state.movementCoordinator.diagnostics[name].has('starter-cook')).toBe(true);
    });
  });
});

describe('GameProvider guarded economy actions', () => {
  beforeEach(() => localStorage.clear());

  it('uses the selected upgrade state to derive its cost and maximum level', () => {
    const game = renderReducer({ restaurant: { funds: 1000 } });

    game.dispatch({ type: 'BUY_UPGRADE', id: 'u3', cost: 1 });

    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.upgrades.find(upgrade => upgrade.id === 'u3').level).toBe(1);

    const maxedUpgrades = game.state.upgrades.map(upgrade =>
      upgrade.id === 'u3' ? { ...upgrade, level: upgrade.costs.length } : upgrade);
    game.dispatch({ type: 'LOAD_STATE', state: { ...game.state, upgrades: maxedUpgrades } });
    game.dispatch({ type: 'BUY_UPGRADE', id: 'u3', cost: -1000 });
    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.upgrades.find(upgrade => upgrade.id === 'u3').level).toBe(4);
  });

  it('applies configured reputation upgrade effects without relying on upgrade identity', () => {
    const reputationUpgrade = {
      id: 'custom-decor',
      name: 'Wall Art',
      level: 0,
      costs: [150],
      effects: { type: 'reputation', value: 0.1 },
    };
    const game = renderReducer({
      restaurant: { funds: 150, reputation: 2 },
      upgrades: [reputationUpgrade],
    });

    game.dispatch({ type: 'BUY_UPGRADE', id: 'custom-decor' });

    expect(game.state.restaurant).toMatchObject({ funds: 0, reputation: 2.1 });
    expect(game.state.upgrades[0].level).toBe(1);

    const capped = renderReducer({
      restaurant: { funds: 150, reputation: 4.95 },
      upgrades: [reputationUpgrade],
    });
    capped.dispatch({ type: 'BUY_UPGRADE', id: 'custom-decor' });
    expect(capped.state.restaurant.reputation).toBe(5);
  });

  it('ignores malformed reputation effect values while completing a valid purchase', () => {
    const game = renderReducer({
      restaurant: { funds: 150, reputation: 2 },
      upgrades: [{
        id: 'broken-decor', level: 0, costs: [150],
        effects: { type: 'reputation', value: Number.NaN },
      }],
    });

    game.dispatch({ type: 'BUY_UPGRADE', id: 'broken-decor' });

    expect(game.state.restaurant).toMatchObject({ funds: 0, reputation: 2 });
    expect(game.state.upgrades[0].level).toBe(1);
  });

  it('places unowned equipment and charges its canonical purchase cost exactly once', () => {
    const game = renderReducer({ restaurant: { funds: 600 } });

    game.dispatch({
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq2',
      x: 500, y: 120, rotation: 0, cost: 1,
    });

    expect(game.state.restaurant.funds).toBe(100);
    expect(game.state.equipment.find(equipment => equipment.id === 'eq2').owned).toBe(true);
    expect(game.state.kitchenStations.at(-1)).toEqual({
      id: 'k3', equipmentId: 'eq2', x: 500, y: 120,
    });
  });

  it('rejects overlapping equipment placement without charging or adding a station', () => {
    const game = renderReducer({ restaurant: { funds: 600 } });
    const before = game.state;

    game.dispatch({
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq2',
      x: 100, y: 120, rotation: 0,
    });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.kitchenStations).toHaveLength(2);
  });

  it('rejects unaffordable equipment placement without charging or adding a station', () => {
    const game = renderReducer({ restaurant: { funds: 499 } });
    const before = game.state;

    game.dispatch({
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq2',
      x: 500, y: 120, rotation: 0,
    });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(499);
    expect(game.state.kitchenStations).toHaveLength(2);
  });

  it('rejects unknown equipment placement without charging or adding a station', () => {
    const game = renderReducer({ restaurant: { funds: 600 } });
    const before = game.state;

    game.dispatch({
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'missing',
      x: 500, y: 120, rotation: 0,
    });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.kitchenStations).toHaveLength(2);
  });

  it('rejects already-owned equipment placement without charging or adding a station', () => {
    const game = renderReducer({ restaurant: { funds: 600 } });
    const before = game.state;

    game.dispatch({
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq1',
      x: 500, y: 120, rotation: 0,
    });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.kitchenStations).toHaveLength(2);
  });

  it('rejects a repeated equipment placement action after the first purchase', () => {
    const game = renderReducer({ restaurant: { funds: 600 } });
    const action = {
      type: 'PLACE_ITEM', itemType: 'equipmentStation', equipmentId: 'eq2',
      x: 500, y: 120, rotation: 0,
    };

    game.dispatch(action);
    const afterPurchase = game.state;
    game.dispatch(action);

    expect(game.state).toBe(afterPurchase);
    expect(game.state.restaurant.funds).toBe(100);
    expect(game.state.kitchenStations).toHaveLength(3);
  });

  it('ignores legacy equipment purchase actions without charging or adding a station', () => {
    const game = renderReducer({ restaurant: { funds: 600 } });
    const before = game.state;

    game.dispatch({ type: 'BUY_EQUIPMENT', id: 'eq2', cost: 0 });

    expect(game.state).toBe(before);
    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.kitchenStations).toHaveLength(2);
  });

  it('updates equipment level multipliers using the canonical upgrade cost', () => {
    const game = renderReducer({ restaurant: { funds: 100 } });

    game.dispatch({ type: 'UPGRADE_EQUIPMENT', id: 'eq1', cost: 0 });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.equipment.find(equipment => equipment.id === 'eq1')).toMatchObject({
      level: 2,
      speedMultiplier: 1.1,
      qualityBonus: 0.05,
    });
  });

  it('stops hiring at the staff slot limit and when salary is unaffordable', () => {
    const game = renderReducer({ restaurant: { funds: 300 } });
    const makeStaff = id => ({ id, name: id, role: 'waiter', skill: 1, morale: 80, salary: 150 });

    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('fifth') });
    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('sixth') });
    game.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('seventh') });

    expect(game.state.staff).toHaveLength(7);
    expect(game.state.restaurant.funds).toBe(0);

    const unaffordable = renderReducer({ restaurant: { funds: 149 } });
    unaffordable.dispatch({ type: 'HIRE_STAFF', staff: makeStaff('fifth') });
    expect(unaffordable.state.staff).toHaveLength(5);
    expect(unaffordable.state.restaurant.funds).toBe(149);

    const forgedSalary = renderReducer({ restaurant: { funds: 150 } });
    forgedSalary.dispatch({ type: 'HIRE_STAFF', staff: { ...makeStaff('forged'), salary: 0 } });
    expect(forgedSalary.state.restaurant.funds).toBe(0);
    expect(forgedSalary.state.staff.at(-1).salary).toBe(150);

    const unknownRole = renderReducer({ restaurant: { funds: 1000 } });
    unknownRole.dispatch({
      type: 'HIRE_STAFF',
      staff: { ...makeStaff('invalid'), role: 'manager', salary: 0 },
    });
    expect(unknownRole.state.staff).toHaveLength(5);
    expect(unknownRole.state.restaurant.funds).toBe(1000);
  });

  it('does not let staff development or service counters overdraw funds', () => {
    const training = renderReducer({ restaurant: { funds: 100 } });
    training.dispatch({ type: 'TRAIN_STAFF', id: 'starter-cook', cost: 0 });
    expect(training.state.restaurant.funds).toBe(100);
    expect(training.state.staff.find(staff => staff.id === 'starter-cook')).toMatchObject({
      skill: 3, morale: 80, carryingServiceItemIds: [],
    });

    training.dispatch({ type: 'GIVE_BONUS', id: 'starter-cook', cost: -100 });
    expect(training.state.restaurant.funds).toBe(50);
    expect(training.state.staff.find(staff => staff.id === 'starter-cook').morale).toBe(100);

    const service = renderReducer({ restaurant: { funds: 299 } });
    service.dispatch({ type: 'BUY_SERVICE_TABLE', cost: 0 });
    expect(service.state.restaurant.funds).toBe(299);
    expect(service.state.serviceTables).toHaveLength(1);
  });

  it('charges the shared current-skill training price rather than a caller-supplied cost', () => {
    const game = renderReducer({
      restaurant: { funds: 620 },
      staff: createInitialState().staff.map(staff => staff.id === 'starter-cook'
        ? { ...staff, skill: 3 }
        : staff),
    });

    game.dispatch({ type: 'TRAIN_STAFF', id: 'starter-cook', cost: 1 });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.staff.find(staff => staff.id === 'starter-cook'))
      .toMatchObject({ skill: 4, morale: 90 });
  });

  it('settles target-owned work before training changes the worker rate', () => {
    const initial = createInitialState();
    const game = renderReducer({
      restaurant: { funds: 620, gameTime: 100 },
      staff: initial.staff.map(staff => staff.id === 'starter-cook'
        ? {
          ...staff,
          task: { type: 'clean_table', tableId: 't1', cleaningStartedAt: 0 },
        }
        : staff),
      tables: initial.tables.map(table => table.id === 't1'
        ? {
          ...table,
          status: 'dirty',
          cleaningAction: {
            staffId: 'starter-cook', startedAt: 0, cleaningStartedAt: 0,
            accumulatedWork: 0, lastProgressAt: 0,
          },
        }
        : table),
    });

    game.dispatch({ type: 'TRAIN_STAFF', id: 'starter-cook', cost: 1 });

    expect(game.state.staff.find(staff => staff.id === 'starter-cook'))
      .toMatchObject({ skill: 4, morale: 90 });
    expect(game.state.tables.find(table => table.id === 't1').cleaningAction)
      .toMatchObject({ staffId: 'starter-cook', accumulatedWork: 130, lastProgressAt: 100 });
  });

  it('settles service-item work before a bonus changes the worker rate', () => {
    const initial = createInitialState();
    const game = renderReducer({
      restaurant: { funds: 50, gameTime: 100 },
      washStations: [{ id: 'wash1', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
      staff: initial.staff.map(staff => staff.id === 'starter-janitor'
        ? {
          ...staff,
          task: { type: 'wash_item', serviceItemId: 'dirty', washStationId: 'wash1', washingStartedAt: 0 },
        }
        : staff),
      serviceItems: [{
        id: 'dirty', kind: 'dish', state: 'washing', washStationId: 'wash1',
        assignedStaffId: 'starter-janitor', washStartedAt: 0,
        accumulatedWork: 0, lastProgressAt: 0,
      }],
    });

    game.dispatch({ type: 'GIVE_BONUS', id: 'starter-janitor' });

    expect(game.state.serviceItems[0]).toMatchObject({ accumulatedWork: 130, lastProgressAt: 100 });
    expect(game.state.staff.find(staff => staff.id === 'starter-janitor').task)
      .toMatchObject({ accumulatedWork: 130, lastProgressAt: 100 });
  });

  it('caps trained skill and morale without discarding an existing load', () => {
    const training = renderReducer({
      restaurant: { funds: 17600 },
      staff: createInitialState().staff.map(staff => staff.id === 'starter-cook'
        ? { ...staff, skill: 9, morale: 95, carryingServiceItemIds: ['dish', 'drink'] }
        : staff),
      customers: [
        { id: 'c1', state: 'waiting_for_items', dishId: 'dish' },
        { id: 'c2', state: 'waiting_for_items', drinkId: 'water' },
      ],
      serviceItems: [
        { id: 'dish', kind: 'dish', state: 'carried', customerId: 'c1' },
        { id: 'drink', kind: 'drink', state: 'carried', customerId: 'c2' },
      ],
    });

    training.dispatch({ type: 'TRAIN_STAFF', id: 'starter-cook' });

    expect(training.state.staff.find(staff => staff.id === 'starter-cook')).toMatchObject({
      skill: 10, morale: 100, carryingServiceItemIds: ['dish', 'drink'],
    });
    expect(training.state.restaurant.funds).toBe(0);
  });

  it('uses the canonical expansion cost and rejects expansion at the configured maximum', () => {
    const game = renderReducer({ restaurant: { funds: 20000, expansionLevel: 3 } });
    const initialStationCount = game.state.kitchenStations.length;

    game.dispatch({ type: 'EXPAND', cost: 1 });

    expect(game.state.restaurant).toMatchObject({ funds: 14000, expansionLevel: 4 });
    expect(game.state.kitchenStations).toHaveLength(initialStationCount + 1);

    game.dispatch({ type: 'EXPAND', cost: 1 });

    expect(game.state.restaurant).toMatchObject({ funds: 14000, expansionLevel: 4 });
    expect(game.state.kitchenStations).toHaveLength(initialStationCount + 1);
  });

  it('allocates an expanded kitchen station after the greatest existing suffix', () => {
    const game = renderReducer({
      restaurant: { funds: 1000, expansionLevel: 1 },
      kitchenStations: [
        { id: 'k1', equipmentId: null, x: 100, y: 120 },
        { id: 'k3', equipmentId: null, x: 200, y: 120 },
      ],
    });

    game.dispatch({ type: 'EXPAND' });

    expect(game.state.kitchenStations.at(-1).id).toBe('k4');
    expect(new Set(game.state.kitchenStations.map(station => station.id)).size)
      .toBe(game.state.kitchenStations.length);
  });

  it('places an expanded kitchen station in a save-safe snapped slot', () => {
    const game = renderReducer({ restaurant: { funds: 10000 } });

    game.dispatch({ type: 'EXPAND' });

    expect(game.state.restaurant).toMatchObject({ funds: 9000, expansionLevel: 2 });
    expect(game.state.kitchenStations.at(-1)).toMatchObject({ id: 'k3', x: 260, y: 120 });

    const snapshot = movementSaveSnapshot(game.state);
    const restored = hydrateState(snapshot, createInitialState());

    expect(restored.kitchenStations).toEqual(game.state.kitchenStations);
    expect(restored.restaurant).toMatchObject({ funds: 9000, expansionLevel: 2 });
  });

  it('keeps repeated expansions valid around moved fixtures and kitchen ID gaps', () => {
    const game = renderReducer({
      restaurant: { funds: 10000, expansionLevel: 1 },
      kitchenStations: [
        { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
        { id: 'k7', equipmentId: null, x: 360, y: 120 },
      ],
      washStations: [{ id: 'wash1', type: 'manual', x: 240, y: 120, w: 40, h: 40 }],
      serviceTables: [{ id: 'st1', x: 500, y: 120 }],
    });

    game.dispatch({ type: 'EXPAND' });
    game.dispatch({ type: 'EXPAND' });
    game.dispatch({ type: 'EXPAND' });

    const snapshot = movementSaveSnapshot(game.state);
    const restored = hydrateState(snapshot, createInitialState());

    expect(game.state.restaurant).toMatchObject({ funds: 0, expansionLevel: 4 });
    expect(game.state.kitchenStations.map(station => station.id)).toEqual([
      'k1', 'k7', 'k8', 'k9', 'k10',
    ]);
    expect(game.state.kitchenStations.slice(2).map(station => ({ x: station.x, y: station.y })))
      .toEqual([{ x: 280, y: 120 }, { x: 400, y: 120 }, { x: 460, y: 120 }]);
    expect(restored.kitchenStations).toEqual(game.state.kitchenStations);
  });

  it('rejects expansion atomically when a real fixture blocks every post-expansion slot', () => {
    const expandedWorld = getRestaurantWorld({ expansionLevel: 2 });
    const game = renderReducer({
      restaurant: { funds: 10000, expansionLevel: 1 },
      tables: [],
      chairs: [],
      kitchenStations: [],
      serviceTables: [],
      cashierStations: [],
      // This real wash-station footprint intentionally covers the whole
      // level-2 floor, exhausting every candidate without mocking placement.
      washStations: [{
        id: 'blocking-sink',
        type: 'manual',
        x: expandedWorld.floorX,
        y: expandedWorld.diningY,
        w: expandedWorld.floorW,
        h: expandedWorld.floorH - (expandedWorld.diningY - expandedWorld.kitchenY),
      }],
    });
    const before = game.state;
    const beforeStations = before.kitchenStations;

    game.dispatch({ type: 'EXPAND' });

    expect(game.state).toBe(before);
    expect(game.state.restaurant).toMatchObject({ funds: 10000, expansionLevel: 1 });
    expect(game.state.kitchenStations).toBe(beforeStations);
    expect(game.state.kitchenStations).toEqual([]);
  });

  it('enforces price limits and paid dish quality', () => {
    const game = renderReducer({ restaurant: { funds: 50 } });

    game.dispatch({ type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: -20, quality: 10 } });
    expect(game.state.dishes[0]).toMatchObject({ price: 1, quality: 1 });

    game.dispatch({ type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: 101 } });
    expect(game.state.dishes[0].price).toBe(100);

    game.dispatch({ type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: 0 });
    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.dishes[0].quality).toBe(2);

    game.dispatch({ type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast', cost: -50 });
    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.dishes[0].quality).toBe(2);

    game.dispatch({ type: 'UPDATE_DISH', id: 'starter-toast', changes: { price: Number.POSITIVE_INFINITY } });
    expect(game.state.dishes[0].price).toBe(100);
  });

  it('allows adding dishes beyond the legacy recipe-slot count', () => {
    const game = renderReducer({ recipeSlots: 1 });
    const extraDish = { ...game.state.dishes[0], id: 'extra-dish' };

    game.dispatch({ type: 'ADD_DISH', dish: extraDish });

    expect(game.state.dishes).toHaveLength(2);
  });

  it('unlocks a canonical drink once at its catalogue cost', () => {
    const game = renderReducer({ restaurant: { funds: 500 } });

    game.dispatch({ type: 'UNLOCK_DRINK', id: 'tea', cost: 1 });
    game.dispatch({ type: 'UNLOCK_DRINK', id: 'tea', cost: 1 });

    expect(game.state.restaurant.funds).toBe(350);
    expect(game.state.unlockedDrinkIds).toEqual(['water', 'tea']);
  });

  it('rejects unknown and unaffordable drink unlocks', () => {
    const game = renderReducer({ restaurant: { funds: 149 } });

    game.dispatch({ type: 'UNLOCK_DRINK', id: 'tea' });
    game.dispatch({ type: 'UNLOCK_DRINK', id: 'unknown' });

    expect(game.state.restaurant.funds).toBe(149);
    expect(game.state.unlockedDrinkIds).toEqual(['water']);
  });

  it('updates only an unlocked known drink price', () => {
    const game = renderReducer({
      unlockedDrinkIds: ['water', 'tea'], drinkOverrides: {},
      restaurant: { funds: 200 },
    });
    game.dispatch({ type: 'UPDATE_DRINK', id: 'tea', changes: { price: 19.6, popularity: 100 } });
    expect(game.state.drinkOverrides).toEqual({ tea: { price: 20 } });
    game.dispatch({ type: 'UPDATE_DRINK', id: 'coffee', changes: { price: 10 } });
    expect(game.state.drinkOverrides).toEqual({ tea: { price: 20 } });
  });

  it('upgrades unlocked drink quality once for $50 and caps level ten', () => {
    const game = renderReducer({
      unlockedDrinkIds: ['water'], drinkOverrides: {},
      restaurant: { funds: 100 },
    });
    game.dispatch({ type: 'UPGRADE_DRINK_QUALITY', id: 'water' });
    expect(game.state.restaurant.funds).toBe(50);
    expect(game.state.drinkOverrides.water).toEqual({ quality: 2 });
  });

  it('rejects malformed, locked, unknown, unaffordable, and capped drink actions', () => {
    const missingChanges = renderReducer({ unlockedDrinkIds: ['water'] });
    const missingChangesState = missingChanges.state;
    missingChanges.dispatch({ type: 'UPDATE_DRINK', id: 'water' });
    expect(missingChanges.state).toBe(missingChangesState);

    const invalidPrice = renderReducer({ unlockedDrinkIds: ['water'] });
    const invalidPriceState = invalidPrice.state;
    invalidPrice.dispatch({ type: 'UPDATE_DRINK', id: 'water', changes: { price: Number.NaN } });
    expect(invalidPrice.state).toBe(invalidPriceState);
    invalidPrice.dispatch({ type: 'UPDATE_DRINK', id: 'water', changes: {} });
    expect(invalidPrice.state).toBe(invalidPriceState);

    const locked = renderReducer({ unlockedDrinkIds: ['water'] });
    const lockedState = locked.state;
    locked.dispatch({ type: 'UPDATE_DRINK', id: 'tea', changes: { price: 10 } });
    expect(locked.state).toBe(lockedState);

    const unknown = renderReducer({ unlockedDrinkIds: ['water'] });
    const unknownState = unknown.state;
    unknown.dispatch({ type: 'UPGRADE_DRINK_QUALITY', id: 'missing' });
    expect(unknown.state).toBe(unknownState);

    const insufficient = renderReducer({
      unlockedDrinkIds: ['water'], restaurant: { funds: 49 },
    });
    const insufficientState = insufficient.state;
    insufficient.dispatch({ type: 'UPGRADE_DRINK_QUALITY', id: 'water' });
    expect(insufficient.state).toBe(insufficientState);
    expect(insufficient.state.restaurant.funds).toBe(49);

    const capped = renderReducer({
      unlockedDrinkIds: ['water'], drinkOverrides: { water: { quality: 10 } },
    });
    const cappedState = capped.state;
    capped.dispatch({ type: 'UPGRADE_DRINK_QUALITY', id: 'water' });
    expect(capped.state).toBe(cappedState);
    expect(capped.state.restaurant.funds).toBe(600);
  });

  it('canonicalises valid dish creation and rejects malformed dishes', () => {
    const initial = createInitialState();
    const game = renderReducer({ dishes: [], recipeSlots: 3 });
    const validDish = {
      ...initial.dishes[0],
      id: 'new-dish',
      price: 100.6,
      quality: 10,
    };
    delete validDish.cookbookId; // This regression exercises unrestricted custom creation.

    game.dispatch({ type: 'ADD_DISH', dish: validDish });
    expect(game.state.dishes).toEqual([{ ...validDish, price: 100, quality: 1 }]);

    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: 'bad-price', price: Number.NaN } });
    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: 'bad-quality', quality: Number.NaN } });
    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: 'zero-quality', quality: 0 } });
    game.dispatch({ type: 'ADD_DISH', dish: { ...validDish, id: '' } });

    expect(game.state.dishes).toHaveLength(1);
  });

  it('normalises fractional quality before enforcing the paid maximum', () => {
    const initial = createInitialState();
    const game = renderReducer({
      restaurant: { funds: 50 },
      dishes: [{ ...initial.dishes[0], cookbookId: null, quality: 9.5 }],
    });

    game.dispatch({ type: 'UPGRADE_DISH_QUALITY', id: 'starter-toast' });

    expect(game.state.restaurant.funds).toBe(0);
    expect(game.state.dishes[0].quality).toBe(10);
  });
});

describe('GameProvider service counter actions', () => {
  beforeEach(() => localStorage.clear());

  it('blocks deletion for a unified on-service item on the counter', () => {
    const game = renderReducer({
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'd1' }],
       serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'c1', serviceTableId: 'st1', state: 'on_service' }],
    });

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });

     expect(game.state.serviceTables.map(table => table.id)).toEqual(['st1', 'st2']);
  });

  it('allows deletion when an item is carried away from the counter', () => {
    const game = renderReducer({
      serviceTables: [
        { id: 'st1', x: 140, y: 120 },
        { id: 'st2', x: 400, y: 120 },
      ],
       serviceItems: [{ id: 'i1', kind: 'dish', customerId: 'c1', serviceTableId: 'st1', state: 'carried' }],
    });

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });
     expect(game.state.serviceTables.map(table => table.id)).toEqual(['st2']);
  });

  it('blocks deletion for an exact valid drink reservation', () => {
    const game = renderReducer({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water' }],
      serviceItems: [{ id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 2, assignedStaffId: 'w1' }],
       staff: [{ id: 'w1', role: 'cook', task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 2 } }],
    });
    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });
    expect(game.state.serviceTables).toHaveLength(1);
  });

  it('blocks deletion for a cancelled physical counter occupant', () => {
    const game = renderReducer({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{
        id: 'waste', kind: 'dish', serviceTableId: 'st1', serviceSlotIndex: 0,
        state: 'to_clean', foodCancelled: true, deliveryProhibited: true,
        cancelledAt: 100, x: 150, y: 130,
        wasteOrigin: { state: 'on_service', serviceTableId: 'st1', serviceSlotIndex: 0,
          x: 150, y: 130 },
      }],
    });

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });

    expect(game.state.serviceTables).toEqual([{ id: 'st1', x: 140, y: 120 }]);
  });

  it('blocks deletion for a cook-carried dish reserved for a counter slot', () => {
    const initial = createInitialState();
    const game = renderReducer({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      staff: [
        ...initial.staff.filter(worker => worker.id !== 'starter-cook'),
        {
          ...initial.staff.find(worker => worker.id === 'starter-cook'),
          id: 'cook', x: 220, y: 220, carryingServiceItemIds: ['carried-dish'],
        },
      ],
      serviceItems: [{
        id: 'carried-dish', kind: 'dish', serviceTableId: 'st1', serviceSlotIndex: 0,
        state: 'carried', assignedStaffId: 'cook', customerId: 'c1', x: 220, y: 220,
      }],
      customers: [{ id: 'c1', state: 'waiting_for_items', dishId: 'starter-toast' }],
    });

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });

    expect(game.state.serviceTables).toEqual([{ id: 'st1', x: 140, y: 120 }]);
  });

  it('allows deletion for a malformed drink reservation', () => {
    const game = renderReducer({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      customers: [{ id: 'c1', state: 'waiting_for_items', drinkId: 'water' }],
      serviceItems: [{ id: 'i1', kind: 'drink', menuItemId: 'water', customerId: 'c1', state: 'preparing', serviceTableId: 'st1', serviceSlotIndex: 2, assignedStaffId: 'w1' }],
       staff: [{ id: 'w1', role: 'waiter', task: { type: 'prepare_drink', serviceItemId: 'i1', serviceTableId: 'st1', serviceSlotIndex: 2 } }],
    });
    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });
    expect(game.state.serviceTables).toEqual([]);
  });

  it('preserves cleanup items when deleting an unoccupied counter', () => {
    const cleanupItem = {
      id: 'service-item-1', kind: 'dish', menuItemId: 'starter-toast', customerId: 'c1',
      serviceTableId: 'st1', state: 'to_clean',
    };
    const game = renderReducer({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [cleanupItem],
    });
    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st1' });
    expect(game.state.serviceTables).toEqual([]);

    game.dispatch({ type: 'DELETE_SERVICE_TABLE', id: 'st2' });
    expect(game.state.serviceTables).toEqual([]);
    expect(game.state.serviceItems).toEqual([cleanupItem]);
  });
});

describe('GameProvider fixture movement actions', () => {
  beforeEach(() => localStorage.clear());

  it('delegates the unified action while preserving station equipment', () => {
    const game = renderReducer();

    game.dispatch({
      type: 'MOVE_FIXTURES',
      items: [{ type: 'kitchenStation', id: 'k1', x: 500, y: 120 }],
    });

    expect(game.state.kitchenStations.find(station => station.id === 'k1')).toEqual({
      id: 'k1', equipmentId: 'eq1', x: 500, y: 120,
    });
  });

  it('retains accepted legacy table, chair, wash, counter, and grouped payloads', () => {
    const tableGame = renderReducer();
    tableGame.dispatch({ type: 'MOVE_TABLE', id: 't1', x: 300, y: 240 });
    expect(tableGame.state.tables[0]).toMatchObject({ x: 300, y: 240 });
    expect(tableGame.state.chairs.slice(0, 2)).toEqual([
      { id: 'ch1', tableId: 't1', x: 310, y: 220, rotation: 2 },
      { id: 'ch2', tableId: 't1', x: 310, y: 280, rotation: 0 },
    ]);

    const chairGame = renderReducer();
    chairGame.dispatch({ type: 'MOVE_CHAIR', id: 'ch1', x: 180, y: 210, rotation: 1 });
    expect(chairGame.state.chairs[0]).toMatchObject({ x: 180, y: 210, rotation: 1 });

    const washGame = renderReducer({
      washStations: [{ id: 'wash2', type: 'automatic', x: 300, y: 120, w: 40, h: 40 }],
    });
    washGame.dispatch({ type: 'MOVE_WASH_STATION', id: 'wash2', x: 500, y: 300 });
    expect(washGame.state.washStations[0]).toMatchObject({ x: 500, y: 300 });

    const counterGame = renderReducer();
    counterGame.dispatch({ type: 'MOVE_SERVICE_TABLE', id: 'st1', x: 500, y: 120 });
    expect(counterGame.state.serviceTables[0]).toMatchObject({ x: 500, y: 120 });

    const groupedGame = renderReducer();
    groupedGame.dispatch({
      type: 'MOVE_ITEMS',
      items: [
        { type: 'table', id: 't1', x: 300, y: 240 },
        { type: 'chair', id: 'ch1', x: 310, y: 220, rotation: 2 },
        { type: 'chair', id: 'ch2', x: 310, y: 280, rotation: 0 },
      ],
    });
    expect(groupedGame.state.tables[0]).toMatchObject({ x: 300, y: 240 });
    expect(groupedGame.state.chairs.slice(0, 2).map(chair => [chair.x, chair.y])).toEqual([
      [310, 220], [310, 280],
    ]);
  });
});

describe('GameProvider pause toggles', () => {
  beforeEach(() => localStorage.clear());

  it.each([1, 2, 4])('preserves the original speed %s across two pause toggles', speed => {
    const game = renderReducer();

    game.dispatch({ type: 'SET_SPEED', speed });
    expect(game.state).toMatchObject({ speed, paused: false });

    game.dispatch({ type: 'TOGGLE_PAUSE' });
    expect(game.state).toMatchObject({ speed, paused: true });

    game.dispatch({ type: 'TOGGLE_PAUSE' });
    expect(game.state).toMatchObject({ speed, paused: false });
  });
});
