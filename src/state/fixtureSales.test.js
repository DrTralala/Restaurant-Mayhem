import { describe, expect, it } from 'vitest';
import {
  FIXTURE_SALE_REASONS,
  getFixtureSaleEligibility,
  getSaleSelection,
  sellFixtures,
} from './fixtureSales';

function makeState(overrides = {}) {
  return {
    restaurant: { funds: 600, ...(overrides.restaurant || {}) },
    tables: [],
    chairs: [],
    doors: [],
    serviceTables: [],
    cashierStations: [],
    washStations: [],
    staffAmenities: [],
    staff: [],
    customers: [],
    queue: [],
    queueAdmissionGate: null,
    doorAdmissions: { requests: {} },
    serviceItems: [],
    ...overrides,
  };
}

describe('fixture sale eligibility', () => {
  it('accepts an empty table and refunds linked chairs once', () => {
    const state = makeState({
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 100, y: 100 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 100, y: 80 },
        { id: 'ch2', tableId: 't1', x: 100, y: 140 },
      ],
    });

    const selection = getSaleSelection(state, [{ type: 'table', id: 't1' }]);
    expect(selection).toMatchObject({ refund: 200 });
    expect([...selection.removedChairs]).toEqual(['ch1', 'ch2']);

    const next = sellFixtures(state, [{ type: 'table', id: 't1' }]);
    expect(next.restaurant.funds).toBe(800);
    expect(next.tables).toEqual([]);
    expect(next.chairs).toEqual([]);
  });

  it.each([
    ['table only', [{ type: 'table', id: 't1' }]],
    ['table plus some linked chairs', [
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
    ]],
    ['table plus all linked chairs', [
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
      { type: 'chair', id: 'ch2' },
      { type: 'chair', id: 'ch3' },
    ]],
  ])('refunds every linked chair exactly once for %s', (_label, requestedItems) => {
    const state = makeState({
      restaurant: { funds: 1000 },
      tables: [{ id: 't1', seats: 4, status: 'empty', x: 100, y: 100 }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 100, y: 80 },
        { id: 'ch2', tableId: 't1', x: 100, y: 140 },
        { id: 'ch3', tableId: 't1', x: 80, y: 100 },
      ],
    });

    const next = sellFixtures(state, requestedItems);

    expect(next.restaurant.funds).toBe(1225);
    expect(next.tables).toEqual([]);
    expect(next.chairs).toEqual([]);
  });

  it('rejects occupied tables and chairs', () => {
    const occupiedTable = makeState({
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 100, y: 100 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 80 }],
    });
    expect(getFixtureSaleEligibility(occupiedTable, { type: 'table', id: 't1' })).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });

    const occupiedChair = makeState({
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 100, y: 100 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 80 }],
      customers: [{ id: 'c1', chairId: 'ch1', state: 'eating' }],
    });
    expect(getFixtureSaleEligibility(occupiedChair, { type: 'chair', id: 'ch1' })).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });
  });

  it('uses canonical fixture data rather than forged caller data', () => {
    const occupied = makeState({
      restaurant: { funds: 600 },
      tables: [{ id: 't1', seats: 2, status: 'occupied', x: 100, y: 100 }],
    });
    const forgedEmpty = { type: 'table', id: 't1', data: { status: 'empty' } };

    expect(getFixtureSaleEligibility(occupied, forgedEmpty)).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });
    expect(sellFixtures(occupied, [forgedEmpty])).toBe(occupied);

    const missing = { type: 'table', id: 'gone', data: { status: 'empty' } };
    expect(getFixtureSaleEligibility(occupied, missing)).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.MISSING_FIXTURE,
    });
    expect(sellFixtures(occupied, [missing])).toBe(occupied);

    const empty = makeState({
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 100, y: 100 }],
    });
    expect(getFixtureSaleEligibility(empty, {
      type: 'table', id: 't1', data: { status: 'occupied' },
    }).valid).toBe(true);
  });

  it('rejects malformed, duplicate, and mixed stale selections atomically', () => {
    const state = makeState({
      tables: [{ id: 't1', seats: 2, status: 'empty', x: 100, y: 100 }],
    });
    const invalidSelections = [
      null,
      [],
      [{ type: 'table', id: 't1' }, { type: 'table', id: 't1' }],
      [{ type: 'table', id: 't1' }, { type: 'table', id: 'gone' }],
      [{ type: 'table' }],
    ];

    for (const requestedItems of invalidSelections) {
      expect(getSaleSelection(state, requestedItems)).toBeNull();
      expect(sellFixtures(state, requestedItems)).toBe(state);
    }
  });

  it('allows an idle automatic dishwasher but reserves every canonical occupancy source', () => {
    const station = { id: 'auto', type: 'automatic', level: 1, x: 300, y: 120 };
    const item = { type: 'washStation', id: 'auto' };
    const idle = makeState({ washStations: [station] });
    expect(getFixtureSaleEligibility(idle, item).valid).toBe(true);

    const occupiedCases = [
      [{ id: 'dirty', state: 'queued_for_wash', washStationId: 'auto' }],
      [{ id: 'dirty', state: 'washing', washStationId: 'auto' }],
      [{ id: 'dirty', state: 'carried_dirty', reservedWashStationId: 'auto' }],
    ];
    for (const serviceItems of occupiedCases) {
      const state = makeState({ washStations: [station], serviceItems });
      expect(getFixtureSaleEligibility(state, item)).toMatchObject({
        valid: false,
        reason: FIXTURE_SALE_REASONS.IN_USE,
      });
    }

    const taskReserved = makeState({
      washStations: [station],
      serviceItems: [{ id: 'dirty', state: 'carried_dirty' }],
      staff: [{ id: 'janitor', task: {
        type: 'deliver_dirty_item', serviceItemId: 'dirty', washStationId: 'auto',
      } }],
    });
    expect(getFixtureSaleEligibility(taskReserved, item)).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });
  });

  it('marks a manual sink as not sellable', () => {
    const result = getFixtureSaleEligibility(makeState({
      washStations: [{ id: 'sink', type: 'manual', x: 300, y: 120 }],
    }), { type: 'washStation', id: 'sink' });

    expect(result).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.NOT_SELLABLE,
      price: null,
    });
  });

  it('protects occupied service slots but allows an empty service counter', () => {
    const item = { type: 'serviceTable', id: 'st1' };
    const occupied = makeState({
      serviceTables: [{ id: 'st1', x: 140, y: 120 }],
      serviceItems: [{ id: 'food', serviceTableId: 'st1', state: 'on_service' }],
    });
    expect(getFixtureSaleEligibility(occupied, item)).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });

    const empty = makeState({ serviceTables: [{ id: 'st1', x: 140, y: 120 }] });
    expect(getFixtureSaleEligibility(empty, item)).toMatchObject({ valid: true, price: 300 });
  });

  it('protects active cashier payment and checkout dependencies', () => {
    const station = { id: 'cashier1', x: 800, y: 120, w: 40, h: 40 };
    const activePayment = makeState({
      cashierStations: [station],
      staff: [{ id: 'cashier', task: { type: 'take_payment', stationId: 'cashier1' } }],
    });
    expect(getFixtureSaleEligibility(activePayment, {
      type: 'cashierTable', id: 'cashier1',
    })).toMatchObject({ valid: false, reason: FIXTURE_SALE_REASONS.IN_USE });

    const activeCheckout = makeState({
      cashierStations: [station],
      customers: [{ id: 'customer', cashierStationId: 'cashier1', state: 'checkout_processing' }],
    });
    expect(getFixtureSaleEligibility(activeCheckout, {
      type: 'cashierTable', id: 'cashier1',
    })).toMatchObject({ valid: false, reason: FIXTURE_SALE_REASONS.IN_USE });

    const idle = makeState({ cashierStations: [station] });
    expect(getFixtureSaleEligibility(idle, {
      type: 'cashierTable', id: 'cashier1',
    })).toMatchObject({ valid: true, price: 300 });
  });

  it.each([
    ['entering customer', {
      customers: [{ id: 'entering', state: 'entering', entryDoorId: 'door1' }],
    }],
    ['leaving customer', {
      customers: [{ id: 'leaving', state: 'leaving', exitDoorId: 'door1', exitPhase: 'walking' }],
    }],
    ['queue admission gate', { queueAdmissionGate: { doorId: 'door1' } }],
    ['admission request', { doorAdmissions: { requests: { request: { doorId: 'door1' } } } }],
  ])('protects a door with an %s dependency', (_label, overrides) => {
    const state = makeState({
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
      ...overrides,
    });

    expect(getFixtureSaleEligibility(state, { type: 'door', id: 'door1' })).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });
  });

  it('allows an idle additional door', () => {
    const state = makeState({
      doors: [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 440, role: 'exit' },
      ],
    });

    expect(getFixtureSaleEligibility(state, { type: 'door', id: 'door2' })).toMatchObject({
      valid: true,
      price: 400,
    });
  });

  it.each([
    [{ reservedBy: 'worker', occupiedBy: null }],
    [{ reservedBy: null, occupiedBy: 'worker' }],
  ])('protects an amenity with a %s slot', slot => {
    const state = makeState({
      staffAmenities: [{
        id: 'amenity1', type: 'arcade', x: 500, y: 300,
        slots: [{ index: 0, ...slot }],
      }],
    });

    expect(getFixtureSaleEligibility(state, { type: 'staffAmenity', id: 'amenity1' })).toMatchObject({
      valid: false,
      reason: FIXTURE_SALE_REASONS.IN_USE,
    });
  });
});
