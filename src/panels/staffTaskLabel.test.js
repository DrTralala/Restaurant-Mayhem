import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStaffTaskRoles } from '../simulation/taskRoles';
import { getStaffTaskLabel } from './staffTaskLabel';

const KNOWN_TASK_LABELS = {
  clean_table: 'Cleaning table',
  take_order: 'Taking order',
  take_payment: 'Taking payment',
  prepare_dish: 'Preparing dish',
  prepare_drink: 'Preparing drink',
  place_dish_on_service: 'Placing order on service counter',
  pickup_service_item: 'Collecting order',
  deliver_service_item: 'Delivering order',
  deliver_food_item: 'Delivering order',
  clean_floor: 'Cleaning floor',
  collect_dirty_item: 'Collecting dirty item',
  deliver_dirty_item: 'Delivering dirty item',
  transfer_dirty_item: 'Transferring dirty item',
  wash_item: 'Washing item',
};

const RUNTIME_TASK_TYPES = [...new Set(
  Object.values(getStaffTaskRoles()).flatMap(tasks => [...tasks]),
)].sort();
const LEGACY_TASK_TYPES = ['deliver_food_item'];
const ALL_TASK_TYPES = [...new Set([...RUNTIME_TASK_TYPES, ...LEGACY_TASK_TYPES])];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getStaffTaskLabel', () => {
  it('covers every runtime task type plus the legacy delivery task', () => {
    expect(new Set(ALL_TASK_TYPES)).toEqual(new Set(Object.keys(KNOWN_TASK_LABELS)));
  });

  it.each(ALL_TASK_TYPES)('labels the known %s task', (type) => {
    expect(getStaffTaskLabel(
      { id: 's1', role: 'waiter', task: { type } },
      [{ id: 'cashier1', assignedStaffId: 's1' }],
    )).toBe(KNOWN_TASK_LABELS[type]);
  });

  it('retains the idle fallback with strict station identity and no identifier coercion', () => {
    const numericAssignment = [{ id: 'cashier1', assignedStaffId: 7 }];

    expect(getStaffTaskLabel(
      { id: 's1', role: 'waiter', task: null },
      [{ id: 'cashier1', assignedStaffId: 's1' }],
    )).toBe('Staffing cashier');
    expect(getStaffTaskLabel(
      { id: 's1', role: 'waiter', task: undefined },
      [{ id: 'cashier1', assignedStaffId: 's1' }],
    )).toBe('Staffing cashier');
    expect(getStaffTaskLabel(
      { id: 's1', role: 'cook', task: null },
      [{ id: 'cashier1', assignedStaffId: 's1' }],
    )).toBe('Available');
    expect(getStaffTaskLabel({ id: 's1', role: 'waiter', task: null })).toBe('Available');
    expect(getStaffTaskLabel({ id: 's1', role: 'waiter', task: null }, null)).toBe('Available');

    expect(getStaffTaskLabel({ id: 7, role: 'waiter', task: null }, numericAssignment))
      .toBe('Staffing cashier');
    expect(getStaffTaskLabel({ id: '7', role: 'waiter', task: null }, numericAssignment))
      .toBe('Available');
    expect(getStaffTaskLabel(
      { id: 7, role: 'waiter', task: null },
      [{ id: 'cashier1', assignedStaffId: '7' }],
    )).toBe('Available');
  });

  it('requires a non-null worker ID before matching an unassigned station', () => {
    expect(getStaffTaskLabel({ role: 'waiter', task: null }, [{}])).toBe('Available');
    expect(getStaffTaskLabel(
      { id: null, role: 'waiter', task: null },
      [{ assignedStaffId: null }],
    )).toBe('Available');
    expect(getStaffTaskLabel(
      { id: undefined, role: 'waiter', task: null },
      [{ assignedStaffId: undefined }],
    )).toBe('Available');
  });

  it('accepts zero as an ID and tolerates null station entries without coercion', () => {
    const stations = [null, undefined, {}, { id: 'cashier1', assignedStaffId: 0 }];

    expect(getStaffTaskLabel({ id: 0, role: 'waiter', task: null }, stations))
      .toBe('Staffing cashier');
    expect(getStaffTaskLabel({ id: '0', role: 'waiter', task: null }, stations))
      .toBe('Available');
    expect(getStaffTaskLabel(
      { id: 0, role: 'waiter', task: null },
      [null, undefined, { assignedStaffId: '0' }],
    )).toBe('Available');
  });

  it.each([
    ['unknown', { type: 'mystery' }],
    ['missing type', {}],
    ['undefined type', { type: undefined }],
    ['null type', { type: null }],
    ['non-string type', { type: 42 }],
    ['constructor key', { type: 'constructor' }],
    ['prototype key', { type: '__proto__' }],
    ['inherited key', { type: 'toString' }],
  ])('returns Task unavailable for %s tasks instead of the idle fallback', (_label, task) => {
    expect(getStaffTaskLabel(
      { id: 's1', role: 'waiter', task },
      [{ id: 'cashier1', assignedStaffId: 's1' }],
    )).toBe('Task unavailable');
  });

  it('reads frozen workers and stations without mutation or randomness', () => {
    const worker = deepFreeze({ id: 's1', role: 'waiter', task: { type: 'take_order' } });
    const cashierStations = deepFreeze([{ id: 'cashier1', assignedStaffId: 's1' }]);
    const random = vi.spyOn(Math, 'random');

    expect(getStaffTaskLabel(worker, cashierStations)).toBe('Taking order');
    expect(getStaffTaskLabel(
      deepFreeze({ ...worker, task: { type: 'mystery' } }),
      cashierStations,
    )).toBe('Task unavailable');
    expect(getStaffTaskLabel(
      deepFreeze({ ...worker, task: null }),
      cashierStations,
    )).toBe('Staffing cashier');
    expect(random).not.toHaveBeenCalled();
  });
});
