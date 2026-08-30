import { describe, expect, it } from 'vitest';
import { getNextDirtId, isRestaurantFloorPoint, updateDirt } from './dirt';
import { buildBlockedCells, worldToCell } from './pathfinding';

const baseState = {
  floorDirt: [],
  customers: [{ id: 'c1', state: 'seated', chairId: 'ch1', tableId: 't1', x: 200, y: 200, dirtFactor: 9, happiness: 80 }],
  tables: [{ id: 't1', x: 220, y: 180 }],
  chairs: [{ id: 'ch1', tableId: 't1', x: 200, y: 200 }],
  kitchenStations: [], serviceTables: [], cashierStations: [],
  restaurant: { gameTime: 1000, reputation: 3 },
};

describe('updateDirt', () => {
  it('generates the next dirt id after existing ids', () => {
    expect(getNextDirtId([{ id: 'dirt-2' }, { id: 'dirt-9' }, { id: 'other' }])).toBe('dirt-10');
  });

  it('never creates customer dirt in the exterior queue area', () => {
    const result = updateDirt({
      ...baseState,
      customers: [{ id: 'c1', state: 'seated', chairId: 'ch1', tableId: 't1', x: 999, y: 360, dirtFactor: 10 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 200, y: 200 }],
      tables: [{ id: 't1', x: 220, y: 180 }],
    }, 0);
    expect(result.floorDirt).toHaveLength(1);
    expect(isRestaurantFloorPoint(result, result.floorDirt[0])).toBe(true);
  });

  it('uses the assigned chair rather than stale walking coordinates for seated dirt', () => {
    const result = updateDirt({
      ...baseState,
      customers: [{ id: 'c1', state: 'seated', chairId: 'ch1', tableId: 't1', x: 999, y: 360, dirtFactor: 10 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 200, y: 200 }],
      tables: [{ id: 't1', x: 220, y: 180 }],
    }, 0, () => 0);
    expect(Math.hypot(result.floorDirt[0].x - 210, result.floorDirt[0].y - 210)).toBeLessThanOrEqual(40);
  });

  it('retains the threshold when every adjacent interior dirt cell is blocked', () => {
    const result = updateDirt({
      ...baseState,
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dirtFactor: 10 }],
      tables: [{ id: 't1', x: 50, y: 50 }],
      chairs: [
        { id: 'east-top', x: 90, y: 50 }, { id: 'east-bottom', x: 90, y: 70 },
        { id: 'south-left', x: 50, y: 90 }, { id: 'south-right', x: 70, y: 90 },
      ],
    }, 0, () => 0);
    expect(result.floorDirt).toEqual([]);
    expect(result.customers[0].dirtFactor).toBe(10);
  });

  it.each([
    ['top', { x: 200, y: 50 }, () => 0],
    ['bottom', { x: 200, y: 670 }, () => 0.999999],
    ['left', { x: 50, y: 350 }, () => 0],
    ['right', { x: 890, y: 350 }, () => 0.5],
  ])('keeps generated dirt inside the restaurant at the %s edge', (_edge, position, random) => {
    const result = updateDirt({
      ...baseState,
      customers: [{ id: 'c1', state: 'moving', ...position, dirtFactor: 10 }],
      tables: [],
      chairs: [],
    }, 0, random);

    expect(result.floorDirt).toHaveLength(1);
    for (const dirt of result.floorDirt) {
      expect(isRestaurantFloorPoint(result, dirt)).toBe(true);
      const dirtCell = worldToCell(dirt);
      expect(buildBlockedCells(result).has(`${dirtCell.x},${dirtCell.y}`)).toBe(false);
    }
  });

  it('creates deterministic floor dirt when a customer reaches the threshold', () => {
    const result = updateDirt({ ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 9.5 }] }, 60, () => 0.5);
    expect(result.floorDirt).toHaveLength(1);
    expect(result.floorDirt[0]).toMatchObject({ id: 'dirt-1', createdAt: 1000 });
    expect(result.customers[0].dirtFactor).toBeCloseTo(0);
  });

  it('adds half a dirt-factor unit per minute in an active non-eating state', () => {
    const state = { ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 0 }] };
    expect(updateDirt(state, 60).customers[0].dirtFactor).toBe(0.5);
  });

  it('adds one dirt-factor unit per minute while eating', () => {
    const state = { ...baseState, customers: [{ ...baseState.customers[0], state: 'eating', dirtFactor: 0 }] };
    expect(updateDirt(state, 60).customers[0].dirtFactor).toBe(1);
  });

  it('does not accumulate dirt factor for queued or leaving customers', () => {
    const customers = [
      { ...baseState.customers[0], id: 'queued', state: 'queued', dirtFactor: 4 },
      { ...baseState.customers[0], id: 'leaving', state: 'leaving', dirtFactor: 4 },
    ];
    expect(updateDirt({ ...baseState, customers }, 60).customers.map(customer => customer.dirtFactor))
      .toEqual([4, 4]);
  });

  it('places generated dirt outside blocked cells', () => {
    const result = updateDirt({ ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 9.5 }] }, 60, () => 0.5);
    const dirtCell = worldToCell(result.floorDirt[0]);
    expect(buildBlockedCells(result).has(`${dirtCell.x},${dirtCell.y}`)).toBe(false);
  });

  it('reduces nearby customer happiness by 0.2 per minute', () => {
    const state = { ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 0 }], floorDirt: [{ id: 'dirt-1', x: 210, y: 200 }] };
    expect(updateDirt(state, 60).customers[0].happiness).toBeCloseTo(79.8);
  });

  it('uses a 120-unit radius and adds the happiness loss for multiple nearby messes', () => {
    const state = {
      ...baseState,
      customers: [{ ...baseState.customers[0], dirtFactor: 0 }],
      floorDirt: [
        { id: 'dirt-1', x: 319, y: 200 },
        { id: 'dirt-2', x: 200, y: 319 },
        { id: 'dirt-3', x: 321, y: 200 },
      ],
    };
    expect(updateDirt(state, 60).customers[0].happiness).toBeCloseTo(79.4);
  });

  it('caps happiness loss at one point per minute', () => {
    const floorDirt = Array.from({ length: 8 }, (_, index) => ({ id: `dirt-${index + 1}`, x: 200 + index, y: 200 }));
    expect(updateDirt({ ...baseState, floorDirt }, 60).customers[0].happiness).toBeCloseTo(79);
  });

  it('reduces reputation by 0.001 per minute per dirt spot', () => {
    const floorDirt = [1, 2, 3, 4].map(index => ({ id: `dirt-${index}`, x: 700 + index * 20, y: 700 }));
    expect(updateDirt({ ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 0 }], floorDirt }, 60).restaurant.reputation).toBeCloseTo(2.999);
  });

  it('exempts the first three messes from reputation loss', () => {
    const floorDirt = [1, 2, 3].map(index => ({ id: `dirt-${index}`, x: 700 + index * 20, y: 700 }));
    expect(updateDirt({ ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 0 }], floorDirt }, 60).restaurant.reputation).toBe(3);
  });

  it('charges reputation only for excess messes and caps the loss at 0.01 per minute', () => {
    const floorDirt = Array.from({ length: 20 }, (_, index) => ({ id: `dirt-${index + 1}`, x: 700 + index * 20, y: 700 }));
    expect(updateDirt({ ...baseState, floorDirt }, 60).restaurant.reputation).toBeCloseTo(2.99);
  });

  it('caps accumulation and recurring penalties at one minute for large game time', () => {
    const floorDirt = Array.from({ length: 20 }, (_, index) => ({ id: `dirt-${index + 1}`, x: 210 + index, y: 200 }));
    const state = {
      ...baseState,
      floorDirt,
      customers: [{ ...baseState.customers[0], dirtFactor: 0 }],
    };
    const result = updateDirt(state, 600);
    expect(result.customers[0].dirtFactor).toBe(0.5);
    expect(result.customers[0].happiness).toBeCloseTo(79);
    expect(result.restaurant.reputation).toBeCloseTo(2.99);
  });

  it('keeps the unchanged dirt threshold at ten units', () => {
    const result = updateDirt(baseState, 60, () => 0.5);
    expect(result.floorDirt).toHaveLength(0);
    expect(result.customers[0].dirtFactor).toBeCloseTo(9.5);
  });

  it('creates exactly one mess at a 9.5 start and resets the factor to zero', () => {
    const state = { ...baseState, customers: [{ ...baseState.customers[0], dirtFactor: 9.5 }] };
    const result = updateDirt(state, 60, () => 0.5);
    expect(result.floorDirt).toHaveLength(1);
    expect(result.customers[0].dirtFactor).toBeCloseTo(0);
  });

  it('applies nearby happiness penalties using a table position when customer coordinates are absent', () => {
    const state = {
      ...baseState,
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', dirtFactor: 0, happiness: 80 }],
      tables: [{ id: 't1', x: 200, y: 200, status: 'occupied' }],
      floorDirt: [{ id: 'dirt-1', x: 220, y: 220 }],
    };
    expect(updateDirt(state, 60).customers[0].happiness).toBeCloseTo(79.8);
  });

  it('uses assigned seated geometry rather than stale live coordinates for nearby happiness', () => {
    const state = {
      ...baseState,
      customers: [{ ...baseState.customers[0], x: 800, y: 600, dirtFactor: 0 }],
      floorDirt: [{ id: 'dirt-1', x: 210, y: 210 }],
    };

    expect(updateDirt(state, 60).customers[0].happiness).toBeCloseTo(79.8);
  });

  it('rejects a foreign chair and falls back to the assigned table for seated dirt effects', () => {
    const state = {
      ...baseState,
      customers: [{ ...baseState.customers[0], chairId: 'foreign', x: 800, y: 600, dirtFactor: 0 }],
      chairs: [{ id: 'foreign', tableId: 'other-table', x: 600, y: 600 }],
      floorDirt: [{ id: 'dirt-1', x: 240, y: 200 }],
    };

    expect(updateDirt(state, 60).customers[0].happiness).toBeCloseTo(79.8);
  });

  it('rejects a foreign chair and generates dirt from the assigned table origin', () => {
    const state = {
      ...baseState,
      customers: [{ ...baseState.customers[0], chairId: 'foreign', x: 800, y: 600, dirtFactor: 10 }],
      chairs: [{ id: 'foreign', tableId: 'other-table', x: 600, y: 600 }],
    };

    const dirt = updateDirt(state, 0, () => 0).floorDirt[0];
    expect(Math.hypot(dirt.x - 240, dirt.y - 200)).toBeLessThanOrEqual(50);
    expect(Math.hypot(dirt.x - 610, dirt.y - 610)).toBeGreaterThan(120);
  });
});
