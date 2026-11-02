import { describe, it, expect } from 'vitest';
import { createCounterTestState, counterParty } from '../state/highTopCounter.testSupport';
import { getPlaceSettingPositions } from '../canvas/tableGeometry';
import { getTableLocatePoint } from '../canvas/tableLocatePoint';
import { reserveTableForParty, occupyTableForParty, releaseVacatedTables } from './tableLifecycle';
import { prepareSelfSeating } from './selfSeating';
import { updateStaff } from './staff';
import { buildChairApproachAssignments, validateChairApproachAssignments } from './seating';
import { createActorGrid } from './navigation/domainGrid';
import { recordSeatResidency, hydrateSeatResidency } from './movement/seatedDeparture';
import { createNavigationWorkspace } from './movement/navigationWorkspace';

function counterAndOrdinaryTables() {
  const state = createCounterTestState();
  state.tables.unshift({ id: 'ordinary', x: 500, y: 300, seats: 2, status: 'empty' });
  state.chairs.push(
    { id: 'ordinary-chair-1', tableId: 'ordinary', x: 500, y: 280, rotation: 2 },
    { id: 'ordinary-chair-2', tableId: 'ordinary', x: 500, y: 340, rotation: 0 },
  );
  state.queue = [counterParty('solo')];
  return state;
}

describe('independent counter dining places', () => {
  it('prefers the first usable counter place even when ordinary tables precede it', () => {
    const state = counterAndOrdinaryTables();
    state.tables[1].status = 'dirty';
    const before = structuredClone(state.tables);
    const next = prepareSelfSeating(state);
    expect(next.customers[0].tableId).toBe('htc1-seat-1');
    expect(next.tables[0]).toEqual(before[0]);
    expect(state.tables).toEqual(before);
    expect(next.tables.map(table => table.id)).toEqual(before.map(table => table.id));
  });

  it.each(['occupied', 'dirty', 'dirty dishes', 'unreachable'])('falls back to an ordinary table when counter places are %s', reason => {
    const state = counterAndOrdinaryTables();
    if (reason === 'occupied' || reason === 'dirty') {
      state.tables = state.tables.map(table => table.highTopCounterId
        ? { ...table, status: reason } : table);
      if (reason === 'occupied') state.customers = state.tables.slice(1).map((table, index) => ({
        id: `seated-${index}`, tableId: table.id, chairId: `htc1-chair-${index}`, state: 'eating',
      }));
    }
    if (reason === 'dirty dishes') state.serviceItems = state.tables.slice(1).map(table => ({
      id: `dirty-${table.id}`, tableId: table.id, state: 'dirty_at_table',
    }));
    if (reason === 'unreachable') state.chairs.push(
      ...[[280, 320], [380, 320], [300, 340], [320, 340], [340, 340], [360, 340]]
        .map(([x, y], i) => ({ id: `blocker-${i}`, x, y, tableId: null })),
    );
    const next = prepareSelfSeating(state);
    expect(next.customers.find(customer => customer.partyId === 'solo').tableId).toBe('ordinary');
  });

  it('preserves queue priority and ordinary-table seating for a group ahead of a solo diner', () => {
    const state = counterAndOrdinaryTables();
    state.queue = [counterParty('group', 2), counterParty('solo')];
    const next = prepareSelfSeating(state);
    expect(next.customers.map(customer => [customer.partyId, customer.tableId]))
      .toEqual([['group', 'ordinary'], ['group', 'ordinary']]);
    expect(next.queue.map(party => party.partyId)).toEqual(['solo']);
    expect(next.tables.slice(1).every(table => table.status === 'empty')).toBe(true);
  });

  it('does not admit a diner through a blocked chair-side aisle', () => {
    const state = createCounterTestState();
    state.chairs.push(...[[280, 320], [380, 320], [300, 340], [320, 340], [340, 340], [360, 340]]
      .map(([x, y], i) => ({ id: `blocker-${i}`, x, y, tableId: null })));
    state.queue = [counterParty('solo')];
    expect(prepareSelfSeating(state).customers).toHaveLength(0);
    state.chairs = state.chairs.filter(chair => chair.id !== 'blocker-4');
    expect(prepareSelfSeating(state).customers[0].tableId).toBe('htc1-seat-2');
  });
  it('provides a straight departure from an inner chair and accepts its saved connector', () => {
    const state = createCounterTestState();
    const chair = state.chairs[1], table = state.tables[1];
    const customer = { id: 'departing', partyId: 'solo', state: 'checkout_moving',
      chairId: chair.id, tableId: table.id, x: 330, y: 330 };
    Object.assign(customer, recordSeatResidency(customer, chair, table));
    state.customers = [customer];
    expect(createActorGrid(state, customer).departure.ports).toEqual([{ x: 330, y: 350 }]);
    const departing = { ...customer, y: 335, seatResidency: { ...customer.seatResidency,
      phase: 'departing', position: { x: 330, y: 335 },
      connector: { from: { x: 330, y: 330 }, to: { x: 330, y: 350 }, fraction: 0.25 },
    } };
    expect(hydrateSeatResidency({ ...state, customers: [departing] }, departing,
      createNavigationWorkspace(state)).seatResidency.phase).toBe('departing');
  });
  it('approaches the centre of the aisle cell, clear of an adjacent seated diner', () => {
    const state = createCounterTestState();
    state.customers = [{ id: 'new', x: 330, y: 400 }];
    const ids = ['new'], chairs = ['htc1-chair-1'];
    const assignments = buildChairApproachAssignments(state, ids, chairs);
    expect(assignments[0].approachPoint).toEqual({ x: 330, y: 350 });
    expect(validateChairApproachAssignments(state, ids, chairs, assignments, 'htc1-seat-1')).toBe(true);
  });
  it('routes cleaning staff to the edge of the 20-unit surface, not a neighbouring place', () => {
    const state = createCounterTestState(1);
    state.tables[0].status = 'dirty';
    state.staff = [{ id: 'janitor', role: 'janitor', skill: 1, morale: 50, x: 400, y: 300, task: null }];
    expect(updateStaff(state, 0).staff[0].navigationGoal).toMatchObject({ x: 340, y: 300 });
  });
  it('cleans a place from its real edge and reuses it without clearing neighbours', () => {
    const state = createCounterTestState(1);
    state.tables = state.tables.map((table, i) => ({ ...table, status: i ? 'occupied' : 'dirty' }));
    state.restaurant.gameTime = 100;
    state.staff = [{ id: 'janitor', role: 'janitor', skill: 1, morale: 50, x: 340, y: 300,
      task: { type: 'clean_table', tableId: 'htc1-seat-0' } }];
    const started = updateStaff(state, 0);
    expect(started.staff[0].task).toMatchObject({ cleaningStartedAt: 100 });
    const cleaned = updateStaff({ ...started, restaurant: { ...started.restaurant, gameTime: 220 } }, 0);
    expect(cleaned.tables.map(t => t.status)).toEqual(['empty', 'occupied', 'occupied', 'occupied']);
    const reused = prepareSelfSeating({ ...cleaned, queue: [counterParty('new')] });
    expect(reused.customers[0].tableId).toBe('htc1-seat-0');
    expect(reused.tables.slice(1).map(t => t.status)).toEqual(['occupied', 'occupied', 'occupied']);
  });
  it.each([0, 1, 2, 3])('keeps meal anchors and camera centre within each surface: rotation %i', rotation => {
    const state = createCounterTestState(rotation);
    const anchors = new Set();
    state.tables.forEach((table, i) => {
      expect(getTableLocatePoint(state.tables, table.id)).toEqual({ x: table.x + 10, y: table.y + 10 });
      const positions = getPlaceSettingPositions(table, state.chairs[i], ['dish', 'drink']);
      expect(Object.keys(positions)).toHaveLength(2);
      Object.values(positions).forEach(point => {
        expect(point.x).toBeGreaterThan(table.x);
        expect(point.x).toBeLessThan(table.x + 20);
        expect(point.y).toBeGreaterThan(table.y);
        expect(point.y).toBeLessThan(table.y + 20);
        anchors.add(`${point.x},${point.y}`);
      });
    });
    expect(anchors.size).toBe(8);
  });

  it('releases only the vacated place', () => {
    const state = createCounterTestState();
    state.tables = state.tables.map((table, i) => occupyTableForParty(
      reserveTableForParty(table, `party${i}`, [{ customerId: `guest${i}`, chairId: state.chairs[i].id }]), `party${i}`));
    state.customers = state.tables.map((table, i) => ({ id: `guest${i}`, partyId: `party${i}`,
      tableId: table.id, chairId: state.chairs[i].id, state: i === 0 ? 'leaving' : 'eating',
      x: i === 0 ? 500 : state.chairs[i].x + 10, y: i === 0 ? 500 : state.chairs[i].y + 10,
      seatResidency: { phase: i === 0 ? 'clear' : 'seated' } }));
    expect(releaseVacatedTables(state).tables.map(table => table.status))
      .toEqual(['dirty', 'occupied', 'occupied', 'occupied']);
  });

  it('admits a solo party past a larger party without combining counter seats', () => {
    const state = createCounterTestState();
    state.queue = [counterParty('group', 2), counterParty('solo')];
    const next = prepareSelfSeating(state);
    expect(next.customers.map(customer => customer.partyId)).toEqual(['solo']);
    expect(next.queue.map(party => party.partyId)).toEqual(['group']);
    expect(next.tables.filter(table => table.status === 'reserved')).toHaveLength(1);
  });

  it('skips only a dirty place and preserves the doorway admission gate', () => {
    const state = createCounterTestState();
    state.serviceItems = [{ id: 'dirty', tableId: 'htc1-seat-0', state: 'dirty_at_table' }];
    state.queue = [counterParty('first'), counterParty('second')];
    const next = prepareSelfSeating(state);
    expect(next.customers[0].tableId).not.toBe('htc1-seat-0');
    expect(next.tables[0].status).toBe('empty');
    expect(prepareSelfSeating(next).customers).toHaveLength(1);
    expect(next.queueAdmissionGate).not.toBeNull();
  });
});
