import { describe, expect, it } from 'vitest';
import { getPlaceable } from '../data/placeables';
import { createInitialState } from '../state/initialState';
import {
  getNextNumericId,
  getNextNumericIds,
  getPlacementRect,
  snapPlacement,
  validateFixtureCopies,
  validateFixtureMoves,
  validatePlacement,
} from './placement';

const state = {
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 't1', x: 200, y: 200, status: 'empty', seats: 2 }],
  chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 }],
  kitchenStations: [{ id: 'k1', x: 100, y: 120, equipmentId: 'eq1' }],
  serviceTables: [{ id: 'st1', x: 140, y: 120 }],
  cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 40, h: 40 }],
  doors: [{ id: 'door1', y: 340, role: 'entrance' }],
};

describe('ordinary chair transfers', () => {
  it('does not combine different dining parties through simultaneous occupied-chair transfers', () => {
    const initial = createInitialState();
    initial.chairs = initial.chairs.filter(chair => chair.tableId !== 't3');
    initial.customers = [
      { id: 'c1', partyId: 'p1', state: 'eating', tableId: 't1', chairId: 'ch1' },
      { id: 'c2', partyId: 'p2', state: 'eating', tableId: 't2', chairId: 'ch3' },
    ];
    expect(validateFixtureMoves(initial, [
      { type: 'chair', id: 'ch1', x: 210, y: 340 },
      { type: 'chair', id: 'ch3', x: 210, y: 400 },
    ])).toMatchObject({ valid: false, reason: 'chair-table' });
  });

  it.each([0, 1, 2, 3])('allows a starter chair at a purchasable destination with rotation %s', rotation => {
    const initial = createInitialState();
    const placement = { itemType: 'chair', x: 180, y: 200, rotation };
    expect(validatePlacement(initial, placement)).toMatchObject({ valid: true, tableId: 't1' });
    const result = validateFixtureMoves(initial, [{ type: 'chair', id: 'ch5', ...placement }]);
    expect(result).toMatchObject({ valid: true, moves: [{ id: 'ch5', tableId: 't1', rotation }] });
  });

  it('does not let an unrelated detached chair veto a valid move', () => {
    const initial = createInitialState();
    initial.chairs.push({ id: 'legacy', tableId: 'missing', x: 600, y: 500 });
    expect(validateFixtureMoves(initial, [{ type: 'chair', id: 'ch5', x: 200, y: 340, rotation: 0 }]).valid).toBe(true);
  });

  it('checks final capacity when multiple chairs transfer together', () => {
    const initial = createInitialState();
    initial.tables[0].seats = 3;
    const moves = [
      { type: 'chair', id: 'ch5', x: 180, y: 200 },
      { type: 'chair', id: 'ch6', x: 240, y: 200 },
    ];
    expect(validateFixtureMoves(initial, moves)).toMatchObject({ valid: false, reason: 'chair-table' });
    initial.tables[0].seats = 4;
    expect(validateFixtureMoves(initial, moves)).toMatchObject({ valid: true,
      moves: [expect.objectContaining({ tableId: 't1' }), expect.objectContaining({ tableId: 't1' })] });
  });

  it('excludes moving chairs when swapping between full tables', () => {
    const initial = createInitialState();
    const moves = [
      { type: 'chair', id: 'ch5', x: 370, y: 340 },
      { type: 'chair', id: 'ch9', x: 210, y: 340 },
    ];
    expect(validateFixtureMoves(initial, moves)).toMatchObject({ valid: true,
      moves: [expect.objectContaining({ tableId: 't4' }), expect.objectContaining({ tableId: 't3' })] });
  });
});

it('exposes canonical prices and footprints', () => {
  expect(getPlaceable('table')).toMatchObject({ price: 300, width: 40, height: 40 });
  expect(getPlaceable('chair')).toMatchObject({ price: 50, width: 20, height: 20, rotatable: true });
  expect(getPlaceable('door')).toMatchObject({ price: 400, width: 6, height: 40 });
  expect(getPlaceable('serviceTable')).toMatchObject({ price: 300, width: 120, height: 40, rotatable: true });
  expect(getPlaceable('cashierTable')).toMatchObject({ price: 300, width: 40, height: 40 });
  expect(getPlaceable('automaticDishwasher')).toMatchObject({ price: 2000, width: 40, height: 40 });
});

describe('numeric ID allocation', () => {
  it('allocates one or many IDs after the greatest numeric suffix', () => {
    const records = [{ id: 't1' }, { id: 't3' }, { id: 'legacy' }];

    expect(getNextNumericId(records, 't')).toBe('t4');
    expect(getNextNumericIds(records, 't', 3)).toEqual(['t4', 't5', 't6']);
  });

  it('uses exact string arithmetic beyond Number.MAX_SAFE_INTEGER', () => {
    const records = [
      { id: 't9007199254740991' },
      { id: 't9007199254740992' },
    ];

    expect(getNextNumericId(records, 't')).toBe('t9007199254740993');
    expect(getNextNumericIds(records, 't', 3)).toEqual([
      't9007199254740993',
      't9007199254740994',
      't9007199254740995',
    ]);
  });
});

it('uses the vertical footprint for a quarter-turned service counter', () => {
  expect(getPlacementRect('serviceTable', 600, 120, 1)).toEqual({
    x: 600, y: 120, w: 40, h: 120,
  });
});

it('places a dishwasher freely and rejects overlap with every furniture/station type', () => {
  const empty = { ...state, tables: [], chairs: [], kitchenStations: [], serviceTables: [], cashierStations: [], washStations: [] };
  expect(validatePlacement(empty, { itemType: 'automaticDishwasher', x: 500, y: 300 })).toMatchObject({ valid: true });
  const occupied = [
    { tables: [{ id: 't', x: 500, y: 300 }] },
    { chairs: [{ id: 'c', x: 500, y: 300 }] },
    { kitchenStations: [{ id: 'k', x: 500, y: 300 }] },
    { serviceTables: [{ id: 's', x: 500, y: 300 }] },
    { cashierStations: [{ id: 'cash', x: 500, y: 300, w: 80, h: 40 }] },
    { washStations: [{ id: 'wash', x: 500, y: 300, w: 40, h: 40 }] },
  ];
  for (const furniture of occupied) {
    expect(validatePlacement({ ...empty, ...furniture }, { itemType: 'automaticDishwasher', x: 500, y: 300 }).reason)
      .toBe('overlap');
  }
});

it('snaps chairs to the ten-pixel grid and doors to the right wall', () => {
  expect(snapPlacement('chair', { x: 137, y: 83 }, state)).toMatchObject({ x: 140, y: 80 });
  const door = snapPlacement('door', { x: 1, y: 361 }, state);
  expect(door.x).toBeGreaterThan(800);
  expect(door.y % 20).toBe(0);
});

it('rejects collisions and accepts a free cashier-table footprint', () => {
  expect(validatePlacement(state, { itemType: 'table', x: 200, y: 200, rotation: 0 }).valid).toBe(false);
  expect(validatePlacement(state, { itemType: 'cashierTable', x: 600, y: 300, rotation: 0 }).valid).toBe(true);
});

it('rejects a cashier table whose work cell is beyond the top edge', () => {
  expect(validatePlacement(state, {
    itemType: 'cashierTable', x: 600, y: 50, rotation: 0,
  })).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
});

it('rejects a cashier table whose work cell is blocked by adjacent furniture', () => {
  const blocked = {
    ...state,
    chairs: [
      ...state.chairs,
      { id: 'work-blocker', tableId: 't1', x: 620, y: 280, rotation: 0 },
    ],
  };

  expect(validatePlacement(blocked, {
    itemType: 'cashierTable', x: 600, y: 300, rotation: 0,
  })).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
});

it('rejects a cashier table whose open work cell is unreachable', () => {
  const enclosed = {
    ...state,
    chairs: [
      ...state.chairs,
      { id: 'work-top', tableId: 't1', x: 640, y: 260, rotation: 0 },
      { id: 'work-left', tableId: 't1', x: 620, y: 280, rotation: 0 },
      { id: 'work-right', tableId: 't1', x: 660, y: 280, rotation: 0 },
    ],
  };

  expect(validatePlacement(enclosed, {
    itemType: 'cashierTable', x: 600, y: 300, rotation: 0,
  })).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
});

it('requires a purchasable chair to be adjacent to a table with an open seat', () => {
  expect(validatePlacement(state, { itemType: 'chair', x: 210, y: 240, rotation: 0 })).toMatchObject({ valid: true, tableId: 't1' });
  expect(validatePlacement(state, { itemType: 'chair', x: 600, y: 300, rotation: 0 }).valid).toBe(false);
});

describe('fixture movement validation', () => {
  it('validates related moves against the proposed final layout without mutating state', () => {
    const before = structuredClone(state);

    expect(validateFixtureMoves(state, [
      { type: 'table', id: 't1', x: 400, y: 300 },
      { type: 'chair', id: 'ch1', x: 410, y: 280, rotation: 2 },
    ])).toMatchObject({ valid: true });
    expect(state).toEqual(before);
  });

  it('allows a fixture to occupy space vacated in the same atomic move', () => {
    expect(validateFixtureMoves(state, [
      { type: 'table', id: 't1', x: 400, y: 300 },
      { type: 'chair', id: 'ch1', x: 410, y: 280, rotation: 2 },
      { type: 'kitchenStation', id: 'k1', x: 200, y: 200 },
    ])).toMatchObject({ valid: true });
  });

  it('rejects overlap with an unmoved fixture', () => {
    expect(validateFixtureMoves(state, [
      { type: 'kitchenStation', id: 'k1', x: 200, y: 200 },
    ])).toMatchObject({ valid: false, reason: 'overlap' });
  });

  it('rejects a door submitted away from its wall', () => {
    expect(validateFixtureMoves(state, [
      { type: 'door', id: 'door1', x: 500, y: 440 },
    ])).toMatchObject({ valid: false, reason: 'door-wall' });
  });

  it('returns the validated wall coordinate for a valid door move', () => {
    expect(validateFixtureMoves(state, [
      { type: 'door', id: 'door1', x: 907, y: 440 },
    ])).toMatchObject({
      valid: true,
      moves: [{ type: 'door', id: 'door1', x: 907, y: 440 }],
    });
  });

  it('rejects a moved chair that is no longer adjacent to its one linked table', () => {
    expect(validateFixtureMoves(state, [
      { type: 'chair', id: 'ch1', x: 500, y: 300, rotation: 2 },
    ])).toMatchObject({ valid: false, reason: 'chair-table' });
  });

  it('rejects two moved candidates that overlap in the final layout', () => {
    expect(validateFixtureMoves(state, [
      { type: 'table', id: 't1', x: 400, y: 300 },
      { type: 'chair', id: 'ch1', x: 410, y: 280, rotation: 2 },
      { type: 'kitchenStation', id: 'k1', x: 400, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'overlap' });
  });

  it('rejects a candidate outside the restaurant floor', () => {
    expect(validateFixtureMoves(state, [
      { type: 'table', id: 't1', x: 40, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'outside-floor' });
  });

  it('rejects a cashier whose final work cell is blocked', () => {
    const blocked = {
      ...state,
      tables: [
        ...state.tables,
        { id: 'work-table', x: 620, y: 240, status: 'empty', seats: 1 },
      ],
      chairs: [
        ...state.chairs,
        { id: 'work-blocker', tableId: 'work-table', x: 620, y: 280, rotation: 0 },
      ],
    };

    expect(validateFixtureMoves(blocked, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
  });

  it('rejects a cashier whose open final work cell is unreachable', () => {
    const enclosed = {
      ...state,
      chairs: [
        ...state.chairs,
        { id: 'work-top', tableId: 't1', x: 640, y: 260, rotation: 0 },
        { id: 'work-left', tableId: 't1', x: 620, y: 280, rotation: 0 },
        { id: 'work-right', tableId: 't1', x: 660, y: 280, rotation: 0 },
      ],
    };

    expect(validateFixtureMoves(enclosed, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
  });

  it('rejects malformed, duplicate, and missing fixture moves', () => {
    expect(validateFixtureMoves(state, [
      { type: 'table', id: 't1', x: 400, y: 300 },
      { type: 'table', id: 't1', x: 500, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'duplicate-move' });
    expect(validateFixtureMoves(state, [
      { type: 'table', id: 'missing', x: 400, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'missing-fixture' });
    expect(validateFixtureMoves(state, [
      { type: 'table', id: 't1', x: Number.NaN, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'non-finite-coordinate' });
    expect(validateFixtureMoves(state, [
      { type: 'chair', id: 'ch1', x: 210, y: 180, rotation: 1.5 },
    ])).toMatchObject({ valid: false, reason: 'malformed-rotation' });
  });
});

describe('fixture copy validation', () => {
  it('canonicalises runtime-rich dining candidates before validating them', () => {
    const runtimeRichState = {
      ...state,
      tables: [{
        id: 't1', x: 200, y: 200, status: 'occupied', seats: undefined,
        diningPartyId: 'party-1',
        diningCustomerIds: ['customer-1'],
        seatingAssignments: [{ customerId: 'customer-1', chairId: 'ch1' }],
        reservationOwnerStaffId: 'host',
      }],
      chairs: [{
        id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2,
        reservedBy: 'party-1', occupiedBy: 'customer-1',
      }],
    };

    expect(validateFixtureCopies(runtimeRichState, [
      { type: 'table', id: 't1', x: 600, y: 300 },
    ])).toMatchObject({ valid: true, reason: null });
  });

  it('validates copied candidates against the originals and preserves table-chair links', () => {
    const result = validateFixtureCopies(state, [
      { type: 'table', id: 't1', x: 600, y: 300 },
      { type: 'chair', id: 'ch1', x: 610, y: 280 },
    ]);

    expect(result).toMatchObject({ valid: true, reason: null });
    expect(result.copies).toEqual([
      { type: 'table', id: 't1', x: 600, y: 300 },
      { type: 'chair', id: 'ch1', x: 610, y: 280 },
    ]);
  });

  it('keeps the original fixtures as obstacles for a copy', () => {
    expect(validateFixtureCopies(state, [
      { type: 'table', id: 't1', x: 200, y: 200 },
    ])).toMatchObject({ valid: false, reason: 'overlap' });
  });

  it('rejects a copied door submitted away from its wall', () => {
    expect(validateFixtureCopies(state, [
      { type: 'door', id: 'door1', x: 100, y: 80 },
    ])).toMatchObject({ valid: false, reason: 'door-wall' });
  });

  it('applies door and cashier layout rules to copied candidates', () => {
    expect(validateFixtureCopies(state, [
      { type: 'door', id: 'door1', x: 907, y: 340 },
    ])).toMatchObject({ valid: false, reason: 'door-overlap' });

    const blockedCashier = {
      ...state,
      chairs: [
        ...state.chairs,
        { id: 'blocker', tableId: 't1', x: 620, y: 280 },
      ],
    };
    expect(validateFixtureCopies(blockedCashier, [
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'cashier-work-cell' });
  });

  it('rejects malformed, duplicate, and stale copy sources atomically', () => {
    expect(validateFixtureCopies(state, [{ type: 'table', id: 'gone', x: 600, y: 300 }]))
      .toMatchObject({ valid: false, reason: 'missing-fixture' });
    expect(validateFixtureCopies(state, [
      { type: 'table', id: 't1', x: 600, y: 300 },
      { type: 'table', id: 't1', x: 700, y: 300 },
    ])).toMatchObject({ valid: false, reason: 'duplicate-copy' });
    expect(validateFixtureCopies(state, [{ type: 'table', id: 't1', x: Number.NaN, y: 300 }]))
      .toMatchObject({ valid: false, reason: 'non-finite-coordinate' });
  });
});

describe('staff amenity placement', () => {
  function amenityState(overrides = {}) {
    return {
      restaurant: { expansionLevel: 1 },
      tables: [],
      chairs: [],
      kitchenStations: [],
      serviceTables: [],
      cashierStations: [],
      washStations: [],
      staffAmenities: [],
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
      ...overrides,
    };
  }

  it('exposes 20-pixel snapping and accepts every rotated amenity footprint', () => {
    expect(snapPlacement('couch', { x: 137, y: 283 }, amenityState()))
      .toEqual({ x: 140, y: 280 });

    for (const [itemType, x, y] of [['couch', 500, 300], ['arcade', 600, 300], ['bed', 700, 300]]) {
      for (const rotation of [0, 1, 2, 3]) {
        expect(validatePlacement(amenityState(), {
          itemType, x, y, rotation,
        })).toMatchObject({ valid: true, reason: null });
      }
    }
  });

  it('rejects amenity footprint and required access-cell collisions', () => {
    expect(validatePlacement(amenityState({
      staffAmenities: [{ id: 'existing', type: 'couch', x: 500, y: 300, rotation: 0 }],
    }), {
      itemType: 'arcade', x: 500, y: 300, rotation: 0,
    })).toMatchObject({ valid: false, reason: 'overlap' });

    expect(validatePlacement(amenityState({
      tables: [{ id: 'blocker', x: 500, y: 320 }],
    }), {
      itemType: 'couch', x: 500, y: 300, rotation: 0,
    })).toMatchObject({ valid: false, reason: 'amenity-access' });
  });

  it('rejects an amenity outside the floor or without reachable access cells', () => {
    expect(validatePlacement(amenityState(), {
      itemType: 'bed', x: 40, y: 300, rotation: 0,
    })).toMatchObject({ valid: false, reason: 'outside-floor' });

    expect(validatePlacement(amenityState({
      tables: [
        { id: 'left', x: 460, y: 300 },
        { id: 'right', x: 520, y: 300 },
        { id: 'top', x: 500, y: 260 },
        { id: 'bottom', x: 500, y: 320 },
      ],
    }), {
      itemType: 'arcade', x: 500, y: 300, rotation: 0,
    })).toMatchObject({ valid: false, reason: 'amenity-access' });
  });

  it('protects occupied amenities from atomic moves', () => {
    const state = amenityState({
      staffAmenities: [{
        id: 'couch-1', type: 'couch', x: 500, y: 300, rotation: 0,
        slots: [{ index: 0, reservedBy: 'staff-1', occupiedBy: null }, { index: 1, reservedBy: null, occupiedBy: null }],
      }],
    });

    expect(validateFixtureMoves(state, [{
      type: 'staffAmenity', id: 'couch-1', x: 600, y: 300, rotation: 0,
    }])).toMatchObject({ valid: false, reason: 'amenity-in-use' });
  });

  it('validates free amenity moves and copy destinations without carrying occupancy', () => {
    const state = amenityState({
      restaurant: { expansionLevel: 1, funds: 10_000 },
      staffAmenities: [{
        id: 'couch-1', type: 'couch', x: 500, y: 300, rotation: 0,
        slots: [{ index: 0, reservedBy: 'old-staff', occupiedBy: 'old-staff' }, { index: 1, reservedBy: null, occupiedBy: null }],
      }],
    });
    const movable = {
      ...state,
      staffAmenities: [{ ...state.staffAmenities[0], slots: [
        { index: 0, reservedBy: null, occupiedBy: null },
        { index: 1, reservedBy: null, occupiedBy: null },
      ] }],
    };

    expect(validateFixtureMoves(movable, [{
      type: 'staffAmenity', id: 'couch-1', x: 600, y: 300, rotation: 1,
    }])).toMatchObject({ valid: true, reason: null });
    expect(validateFixtureCopies(state, [{
      type: 'staffAmenity', id: 'couch-1', x: 700, y: 300, rotation: 2,
    }])).toMatchObject({ valid: true, reason: null });
  });
});
