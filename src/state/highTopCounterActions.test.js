import { describe, it, expect } from 'vitest';
import { gameReducer } from './GameContext';
import { createEmptyCounterTestState, createCounterTestState } from './highTopCounter.testSupport';
import { getFixtureSaleExpectation, getSaleSelection } from './fixtureSales';
import { getFixtureCopyEligibility } from './fixtureCopies';
import { snapPlacement, validateFixtureMoves, validateFixtureCopies, validatePlacement } from '../simulation/placement';
import { validateSavedNavigationGeometry } from './movementPersistence';

const purchase = { type: 'PLACE_ITEM', itemType: 'highTopCounter', x: 300, y: 300, rotation: 0 };
const item = { type: 'highTopCounter', id: 'htc1' };
describe('atomic high top counter actions', () => {
  it.each([0, 1, 2, 3])('snaps floor edges to a saveable counter grid, rotation %i', rotation => {
    for (const point of [{ x: 0, y: 300 }, { x: 500, y: 0 }, { x: 10000, y: 300 }, { x: 500, y: 10000 }]) {
      const before = createEmptyCounterTestState();
      const position = snapPlacement('highTopCounter', point, before, rotation);
      expect(position.x % 20).toBe(0);
      expect(position.y % 20).toBe(0);
      const after = gameReducer(before, { ...purchase, ...position, rotation });
      expect(after.highTopCounters).toHaveLength(1);
      expect(() => validateSavedNavigationGeometry(after)).not.toThrow();
    }
  });

  it('rejects off-grid purchase, move and copy requests without mutating the restaurant', () => {
    const empty = createEmptyCounterTestState();
    expect(gameReducer(empty, { ...purchase, x: 50 })).toBe(empty);
    const state = createCounterTestState();
    for (const type of ['MOVE_FIXTURES', 'COPY_FIXTURES']) {
      expect(gameReducer(state, { type, items: [{ ...item, x: 50, y: 300 }] })).toBe(state);
    }
  });
  it.each([0, 1, 2, 3])('purchases four places and included chairs once, rotation %i', rotation => {
    const before = createEmptyCounterTestState();
    const after = gameReducer(before, { ...purchase, rotation });
    expect(after.restaurant.funds).toBe(700);
    expect(after.highTopCounters).toEqual([{ id: 'htc1', x: 300, y: 300, rotation }]);
    expect(after.tables).toHaveLength(4);
    expect(after.chairs).toHaveLength(4);
    expect(before.highTopCounters).toEqual([]);
  });

  it('rejects unaffordable purchases, invalid bounds, chair-row overlap and actors without mutation', () => {
    const poor = createEmptyCounterTestState();
    poor.restaurant.funds = 299;
    expect(gameReducer(poor, purchase)).toBe(poor);
    const state = createEmptyCounterTestState();
    expect(gameReducer(state, { ...purchase, x: -20 })).toBe(state);
    state.tables = [{ id: 't1', x: 320, y: 320, seats: 4, status: 'empty' }];
    expect(gameReducer(state, purchase)).toBe(state);
    state.tables = [];
    state.staff = [{ id: 'worker', x: 330, y: 330 }];
    expect(gameReducer(state, purchase)).toBe(state);
  });

  it('moves and rotates parent and all children with stable IDs', () => {
    const before = createCounterTestState();
    const after = gameReducer(before, { type: 'MOVE_FIXTURES', items: [{ ...item, x: 400, y: 400, rotation: 1 }] });
    expect(after.highTopCounters[0]).toMatchObject({ x: 400, y: 400, rotation: 1 });
    expect(after.tables[0]).toMatchObject({ id: 'htc1-seat-0', x: 420, y: 400 });
    expect(after.chairs[3]).toMatchObject({ id: 'htc1-chair-3', x: 400, y: 460, rotation: 1 });
    expect(before.chairs[3].x).toBe(360);
  });

  it.each(['reserved', 'occupied', 'dirty', 'customer', 'task', 'item'])('rejects move and sale when a place is in use: %s', usage => {
    const state = createCounterTestState();
    if (usage === 'customer') state.customers = [{ id: 'guest', tableId: 'htc1-seat-0' }];
    else if (usage === 'task') state.staff = [{ task: { tableId: 'htc1-seat-0' } }];
    else if (usage === 'item') state.serviceItems = [{ tableId: 'htc1-seat-0', state: 'dirty_at_table' }];
    else state.tables[0].status = usage;
    expect(gameReducer(state, { type: 'MOVE_FIXTURES', items: [{ ...item, x: 400, y: 400 }] })).toBe(state);
    expect(gameReducer(state, { type: 'SELL_ITEMS', items: [item] })).toBe(state);
  });

  it('rejects direct child mutations and standalone chair attachment', () => {
    const state = createCounterTestState();
    for (const [type, id] of [['table', 'htc1-seat-0'], ['chair', 'htc1-chair-0']]) {
      const child = { type, id, x: 500, y: 400 };
      expect(validateFixtureMoves(state, [child])).toMatchObject({ valid: false, reason: 'built-in-fixture' });
      expect(validateFixtureCopies(state, [child])).toMatchObject({ valid: false, reason: 'built-in-fixture' });
      expect(getFixtureCopyEligibility(state, [child]).valid).toBe(false);
      for (const action of ['MOVE_FIXTURES', 'COPY_FIXTURES', 'SELL_ITEMS']) {
        expect(gameReducer(state, { type: action, items: [child] })).toBe(state);
      }
    }
    expect(gameReducer(state, { type: 'ROTATE_CHAIR', id: 'htc1-chair-0' })).toBe(state);
    expect(validatePlacement(state, { itemType: 'chair', x: 300, y: 280, rotation: 2 }).valid).toBe(false);
  });

  it('sells the whole asset for one refund and includes children in stale-sale protection', () => {
    const state = createCounterTestState();
    const expectation = getFixtureSaleExpectation(getSaleSelection(state, [item]));
    expect(expectation).toMatchObject({ refund: 150 });
    expect(expectation.items).toHaveLength(9);
    const after = gameReducer(state, { type: 'SELL_ITEMS', items: [item], expectedSale: expectation });
    expect(after.restaurant.funds).toBe(1150);
    expect(after.highTopCounters).toEqual([]);
    expect(after.tables).toEqual([]);
    expect(after.chairs).toEqual([]);
    expect(gameReducer(state, { type: 'SELL_ITEMS', items: [item], expectedSale: { ...expectation, refund: 999 } })).toBe(state);
  });

  it('copies with fresh empty places, charges only $300 and rejects actor collisions', () => {
    const state = createCounterTestState(1);
    state.tables[0].status = 'dirty';
    const items = [{ ...item, x: 500, y: 300 }];
    const after = gameReducer(state, { type: 'COPY_FIXTURES', items });
    expect(after.restaurant.funds).toBe(700);
    expect(after.highTopCounters[1]).toEqual({ id: 'htc2', x: 500, y: 300, rotation: 1 });
    expect(after.tables).toHaveLength(8);
    expect(after.chairs).toHaveLength(8);
    expect(after.tables[4]).toMatchObject({ id: 'htc2-seat-0', status: 'empty', x: 520, y: 300 });
    state.staff = [{ id: 'worker', x: 510, y: 310 }];
    expect(gameReducer(state, { type: 'COPY_FIXTURES', items })).toBe(state);
    expect(gameReducer(state, { type: 'MOVE_FIXTURES', items })).toBe(state);
  });
});
