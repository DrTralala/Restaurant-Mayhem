import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { advanceCharacterMovementBatch } from './movement';
import { recordSeatResidency } from './movement/seatedDeparture';
import {
  clearDiningOwnership,
  occupyTableForParty,
  releaseVacatedTables,
  reserveTableForParty,
} from './tableLifecycle';

const assignment = {
  customerId: 'new', chairId: 'ch1',
  approachCell: { x: 10, y: 8 }, approachPoint: { x: 200, y: 160 },
};

describe('party-owned table reservation', () => {
  it('will not reserve an occupied table or overwrite another party', () => {
    const table = { id: 't1', status: 'empty', x: 200, y: 200 };
    const reserved = reserveTableForParty(table, 'new-party', [assignment]);
    expect(reserved).toMatchObject({ status: 'reserved', diningPartyId: 'new-party' });
    expect(reserveTableForParty(reserved, 'other', [assignment])).toBeNull();
    expect(occupyTableForParty(reserved, 'old-party')).toBe(reserved);
  });

  it('does not mutate the input table when reserving or occupying', () => {
    const table = { id: 't1', status: 'empty', reservationOwnerStaffId: 'guide', x: 200, y: 200 };
    const reserved = reserveTableForParty(table, 'new-party', [assignment]);
    const occupied = occupyTableForParty(reserved, 'new-party');
    expect(table).toEqual({ id: 't1', status: 'empty', reservationOwnerStaffId: 'guide', x: 200, y: 200 });
    expect(reserved).toMatchObject({
      status: 'reserved', diningPartyId: 'new-party', diningCustomerIds: ['new'],
      seatingAssignments: [assignment], reservationOwnerStaffId: 'guide',
    });
    expect(occupied).toMatchObject({ status: 'occupied', diningPartyId: 'new-party' });
    expect(occupied).not.toHaveProperty('seatingAssignments');
    expect(occupied).not.toHaveProperty('reservationOwnerStaffId');
  });

  it('rejects reservations without a party or usable assignments', () => {
    const table = { id: 't1', status: 'empty', x: 200, y: 200 };
    expect(reserveTableForParty(table, null, [assignment])).toBeNull();
    expect(reserveTableForParty(table, 'new-party', [])).toBeNull();
    expect(reserveTableForParty(table, 'new-party', undefined)).toBeNull();
    expect(reserveTableForParty(table, 'new-party', [
      { customerId: 'dup', chairId: 'ch1' }, { customerId: 'dup', chairId: 'ch2' },
    ])).toBeNull();
    expect(reserveTableForParty(table, 'new-party', [
      { customerId: 'a', chairId: 'ch1' }, { customerId: 'b', chairId: 'ch1' },
    ])).toBeNull();
    expect(reserveTableForParty(table, 'new-party', [{ customerId: null, chairId: 'ch1' }])).toBeNull();
  });

  it('clears every dining field and transitional guide ownership', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'new-party',
      diningCustomerIds: ['new'], seatingAssignments: [assignment],
      reservationOwnerStaffId: 'guide', x: 200, y: 200,
    };
    expect(clearDiningOwnership(table, 'dirty')).toEqual({ id: 't1', status: 'dirty', x: 200, y: 200 });
    expect(table).toMatchObject({ diningPartyId: 'new-party', status: 'occupied' });
  });
});

describe('releaseVacatedTables', () => {
  it('ignores old checkout customers when the new party owns the table', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'new-party',
      diningCustomerIds: ['new'], x: 200, y: 200,
    };
    const state = {
      tables: [table], chairs: [], customers: [
        { id: 'old', partyId: 'old-party', tableId: 't1',
          state: 'checkout_processing', x: 840, y: 180 },
        { id: 'new', partyId: 'new-party', tableId: 't1', state: 'seated', x: 220, y: 190 },
      ],
    };
    expect(releaseVacatedTables(state).tables[0]).toBe(table);
  });

  it('keeps an owned table occupied while a departing member is still seated', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'p1', diningCustomerIds: ['payer'],
      x: 200, y: 200,
    };
    const state = {
      tables: [table], chairs: [],
      customers: [{
        id: 'payer', partyId: 'p1', tableId: 't1', state: 'checkout_moving',
        x: 220, y: 190, seatResidency: { phase: 'seated', actorId: 'payer', partyId: 'p1' },
      }],
    };
    expect(releaseVacatedTables(state).tables[0]).toBe(table);
  });

  it('does not treat a revoked residency as physical clearance', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'p1', diningCustomerIds: ['payer'],
      x: 200, y: 200,
    };
    const state = {
      tables: [table], chairs: [],
      customers: [{
        id: 'payer', partyId: 'p1', tableId: 't1', state: 'checkout_moving',
        x: 300, y: 190, seatResidency: { phase: 'revoked', actorId: 'payer', partyId: 'p1' },
      }],
    };
    expect(releaseVacatedTables(state).tables[0]).toBe(table);
  });

  it('keeps the table occupied when a replacement actor still sits at a chair centre', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'p1', diningCustomerIds: ['payer'],
      x: 200, y: 200,
    };
    const state = {
      tables: [table],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      customers: [
        {
          id: 'payer', partyId: 'p1', tableId: 't1', state: 'checkout_moving',
          x: 840, y: 180, seatResidency: { phase: 'clear', actorId: 'payer', partyId: 'p1' },
        },
        { id: 'replacement', partyId: 'p2', tableId: 't1', state: 'seated', x: 220, y: 190 },
      ],
    };
    expect(releaseVacatedTables(state).tables[0]).toBe(table);
  });

  it('does not release a remaining seated member because another member already left', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'p1',
      diningCustomerIds: ['gone', 'staying'], x: 200, y: 200,
    };
    const state = {
      tables: [table], chairs: [],
      customers: [{
        id: 'staying', partyId: 'p1', tableId: 't1', state: 'seated',
        x: 220, y: 190, seatResidency: { phase: 'seated', actorId: 'staying', partyId: 'p1' },
      }],
    };
    expect(releaseVacatedTables(state).tables[0]).toBe(table);
  });

  it('releases an owned table once every present member has physically cleared', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'p1',
      diningCustomerIds: ['payer'], x: 200, y: 200,
    };
    const state = {
      tables: [table], chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      customers: [{
        id: 'payer', partyId: 'p1', tableId: 't1', state: 'checkout_moving',
        x: 840, y: 180, seatResidency: { phase: 'clear', actorId: 'payer', partyId: 'p1' },
      }],
    };
    const released = releaseVacatedTables(state);
    expect(released.tables[0]).toMatchObject({ id: 't1', status: 'dirty' });
    expect(state.tables[0]).toBe(table);
  });

  it('releases a table when the owning member is already removed from customers', () => {
    const table = {
      id: 't1', status: 'occupied', diningPartyId: 'p1',
      diningCustomerIds: ['departed'], x: 200, y: 200,
    };
    const state = { tables: [table], chairs: [], customers: [] };
    expect(releaseVacatedTables(state).tables[0]).toMatchObject({ status: 'dirty' });
  });
});

describe('physical seat clearance drives release', () => {
  it('releases only after a real connector clears the seat, never at payment movement', () => {
    const initial = createInitialState();
    const table = initial.tables[0];
    const chair = initial.chairs[0];
    const centre = { x: chair.x + 10, y: chair.y + 10 };

    let actor = {
      id: 'payer', partyId: 'p1', partySize: 1, state: 'seated',
      tableId: table.id, chairId: chair.id, patience: 100, happiness: 80,
      x: centre.x, y: centre.y,
    };
    actor = { ...actor, ...recordSeatResidency(actor, chair, table) };

    const ownedTable = occupyTableForParty(
      reserveTableForParty({ ...table, status: 'empty' }, 'p1', [{
        customerId: 'payer', chairId: chair.id,
        approachCell: { x: 8, y: 10 }, approachPoint: { x: centre.x, y: centre.y + 20 },
      }]),
      'p1',
    );

    let state = {
      ...initial,
      queue: [], serviceItems: [], kitchenStations: [], serviceTables: [], washStations: [],
      tables: [ownedTable],
      chairs: [chair],
      customers: [{ ...actor, state: 'checkout_moving', navigationGoal: { x: 840, y: 180 } }],
    };

    // Switching to checkout without moving is not physical clearance.
    expect(releaseVacatedTables(state).tables[0]).toBe(ownedTable);

    let ticks = 0;
    for (; ticks < 40 && state.customers[0].seatResidency?.phase !== 'clear'; ticks += 1) {
      expect(releaseVacatedTables(state).tables[0]).toBe(ownedTable);
      const result = advanceCharacterMovementBatch(
        state,
        [{ character: state.customers[0], speed: 62 }],
        0.1,
      );
      state = {
        ...state,
        customers: [result.moved.get('payer')],
        movementCoordinator: result.coordinator,
      };
    }

    expect(ticks).toBeGreaterThan(0);
    expect(state.customers[0].seatResidency.phase).toBe('clear');
    expect(Math.hypot(
      state.customers[0].x - centre.x,
      state.customers[0].y - centre.y,
    )).toBeGreaterThanOrEqual(16);
    expect(releaseVacatedTables(state).tables[0]).toMatchObject({ id: table.id, status: 'dirty' });
  });
});
