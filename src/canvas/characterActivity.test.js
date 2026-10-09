import { describe, expect, it } from 'vitest';
import { getCustomerVisualActivity, getStaffVisualActivity } from './characterActivity';
import { getStaffTaskRoles } from '../simulation/taskRoles';
import { getStaffWellbeingMovementEntries } from '../simulation/staffWellbeing';

const ARRIVED = Object.freeze({ motion: 'holding', plan: 'arrived' });
const TRAVERSING = Object.freeze({ motion: 'traversing', plan: 'active' });

// Expected work pose for every task type known to the simulation. prepare_dish
// has an equipment-free default; appliance-specific cases are covered below.
const EXPECTED_STAFF_TASK_ACTIVITIES = Object.freeze({
  clean_table: 'wiping',
  clean_floor: 'sweeping',
  wash_item: 'washing',
  take_order: 'taking_order',
  take_payment: 'taking_payment',
  prepare_dish: 'preparing',
  prepare_drink: 'dispensing',
  place_dish_on_service: 'serving',
  pickup_service_item: 'pickup',
  deliver_service_item: 'serving',
  collect_dirty_item: 'collecting',
  deliver_dirty_item: 'depositing',
  transfer_dirty_item: 'depositing',
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

describe('getStaffVisualActivity', () => {
  it('keeps every getStaffTaskRoles task mapped to an expected activity', () => {
    const expected = new Set(Object.keys(EXPECTED_STAFF_TASK_ACTIVITIES));
    for (const [role, tasks] of Object.entries(getStaffTaskRoles())) {
      for (const type of tasks) {
        expect(expected.has(type), `${role} task ${type} has no activity mapping`).toBe(true);
      }
    }
  });

  it.each(Object.entries(EXPECTED_STAFF_TASK_ACTIVITIES))(
    'resolves an arrived working %s as %s',
    (type, activity) => {
      const staff = { task: { type }, activityPhase: 'working' };
      expect(getStaffVisualActivity({}, staff, { movement: ARRIVED })).toBe(activity);
    },
  );

  it.each([
    ['toaster', 'toasting'],
    ['oven', 'baking'],
    ['fryer', 'frying'],
    ['blender', 'blending'],
    ['coffee_machine', 'making_coffee'],
    ['grill', 'preparing'],
  ])('tends %s equipment as %s', (type, activity) => {
    const indexes = {
      kitchenStationsById: new Map([['k1', { id: 'k1', equipmentId: 'eq1' }]]),
      equipmentById: new Map([['eq1', { id: 'eq1', type }]]),
    };
    const staff = { task: { type: 'prepare_dish', stationId: 'k1' }, activityPhase: 'working' };
    expect(getStaffVisualActivity({}, staff, { movement: ARRIVED, indexes })).toBe(activity);
  });

  it('uses the neutral preparation pose for missing stations and equipment', () => {
    const workingDish = (task, options = {}) => getStaffVisualActivity(
      options.state || {}, { task, activityPhase: 'working' }, { movement: ARRIVED, ...options },
    );

    expect(workingDish({ type: 'prepare_dish' })).toBe('preparing');
    expect(workingDish({ type: 'prepare_dish', stationId: 'missing' })).toBe('preparing');
    expect(workingDish({ type: 'prepare_dish', stationId: 'k1' }, {
      indexes: { kitchenStationsById: new Map([['k1', { id: 'k1' }]]) },
    })).toBe('preparing');
    expect(workingDish({ type: 'prepare_dish', stationId: 'k1' }, {
      indexes: {
        kitchenStationsById: new Map([['k1', { id: 'k1', equipmentId: 'eq1' }]]),
        equipmentById: new Map(),
      },
    })).toBe('preparing');
  });

  it('falls back to state arrays when render indexes are absent', () => {
    const state = {
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', type: 'fryer' }],
    };
    const staff = { task: { type: 'prepare_dish', stationId: 'k1' }, activityPhase: 'working' };
    expect(getStaffVisualActivity(state, staff, { movement: ARRIVED })).toBe('frying');
  });

  it('animates locomotion before work', () => {
    const staff = { task: { type: 'clean_floor' }, activityPhase: 'working' };
    expect(getStaffVisualActivity({}, staff, { movement: TRAVERSING })).toBe('walking');
  });

  it('does not animate work for an assignment alone', () => {
    const staff = { task: { type: 'clean_table' }, activityPhase: 'task_assigned' };
    expect(getStaffVisualActivity({}, staff, { movement: ARRIVED })).toBe('idle');
  });

  it('does not animate work while navigation is pending', () => {
    const staff = {
      x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
      task: { type: 'take_order' }, activityPhase: 'working',
    };
    const movement = { motion: 'holding', plan: 'planning' };
    expect(getStaffVisualActivity({}, staff, { movement })).toBe('idle');
  });

  it('does not stride when only a navigation goal and no coordinator status exist', () => {
    const staff = {
      id: 's1', x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
      task: { type: 'clean_floor' }, activityPhase: 'working',
    };
    const state = { staff: [staff] };
    expect(getStaffVisualActivity(state, staff)).toBe('idle');
  });

  it('treats carrying as a held load, not permission to animate blocked work', () => {
    const staff = {
      x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
      task: { type: 'deliver_service_item' }, activityPhase: 'working',
      carryingServiceItemIds: ['i1'],
    };
    const movement = { motion: 'holding', plan: 'planning' };
    expect(getStaffVisualActivity({}, staff, { movement })).toBe('carrying');
  });

  it('carries an assigned but not-yet-working load', () => {
    const staff = { activityPhase: 'task_assigned', carryingServiceItemIds: ['i1'] };
    expect(getStaffVisualActivity({}, staff, { movement: ARRIVED })).toBe('carrying');
  });

  it('walks with a carried load instead of holding it', () => {
    const staff = { carryingServiceItemId: 'i1' };
    expect(getStaffVisualActivity({}, staff, { movement: TRAVERSING })).toBe('walking');
  });

  it('prefers an arrived working task pose over the carrying overlay', () => {
    const staff = {
      task: { type: 'clean_floor' }, activityPhase: 'working',
      carryingServiceItemIds: ['i1'],
    };
    expect(getStaffVisualActivity({}, staff, { movement: ARRIVED })).toBe('sweeping');
  });

  it('falls back to idle for legacy records without a task or load', () => {
    expect(getStaffVisualActivity({}, {})).toBe('idle');
    expect(getStaffVisualActivity({}, null)).toBe('idle');
    expect(getStaffVisualActivity(null, undefined)).toBe('idle');
    expect(getStaffVisualActivity({}, { task: { type: 'unknown_task' }, activityPhase: 'working' },
      { movement: ARRIVED })).toBe('idle');
  });

  describe('amenity residency', () => {
    const bedIndexes = {
      staffAmenitiesByStringId: new Map([['bed-1', { id: 'bed-1', type: 'bed' }]]),
    };
    const couchIndexes = {
      staffAmenitiesByStringId: new Map([['couch-1', { id: 'couch-1', type: 'couch' }]]),
    };

    it('resolves occupied couch and bed anchors from indexes', () => {
      const couch = {
        amenityUse: { amenityId: 'couch-1', phase: 'occupied' },
        movementResidency: { kind: 'staff_amenity', amenityId: 'couch-1', slotIndex: 0 },
      };
      expect(getStaffVisualActivity({}, couch, { movement: ARRIVED, indexes: couchIndexes }))
        .toBe('resting');

      const sleeper = {
        amenityUse: { amenityId: 'bed-1', phase: 'occupied' },
        movementResidency: { kind: 'staff_amenity', amenityId: 'bed-1', slotIndex: 0 },
      };
      expect(getStaffVisualActivity({}, sleeper, { movement: ARRIVED, indexes: bedIndexes }))
        .toBe('sleeping');
    });

    it('resolves an occupied arcade without movement residency', () => {
      const indexes = {
        staffAmenitiesByStringId: new Map([['arcade-1', { id: 'arcade-1', type: 'arcade' }]]),
      };
      const gamer = { amenityUse: { amenityId: 'arcade-1', phase: 'occupied' } };
      expect(getStaffVisualActivity({}, gamer, { movement: ARRIVED, indexes })).toBe('gaming');
    });

    it('honours seated and lying layer overrides', () => {
      expect(getStaffVisualActivity({}, {}, { seated: true })).toBe('resting');
      expect(getStaffVisualActivity({}, {}, { lying: true })).toBe('sleeping');
    });

    it('keeps residency before locomotion and work', () => {
      const staff = {
        amenityUse: { amenityId: 'couch-1', phase: 'occupied' },
        movementResidency: { kind: 'staff_amenity', amenityId: 'couch-1', slotIndex: 0 },
        task: { type: 'clean_table' },
        activityPhase: 'working',
        navigationGoal: { x: 10, y: 10 },
        x: 0,
        y: 0,
      };
      expect(getStaffVisualActivity({}, staff, { movement: TRAVERSING, indexes: couchIndexes }))
        .toBe('resting');
    });

    it('does not sleep while travelling to a reserved bed', () => {
      const staff = {
        amenityUse: { amenityId: 'bed-1', phase: 'reserved', slotIndex: 0 },
        navigationGoal: { x: 40, y: 0 },
        x: 0,
        y: 0,
      };
      expect(getStaffVisualActivity({}, staff, { movement: TRAVERSING, indexes: bedIndexes }))
        .toBe('walking');
    });

    it('walks an exiting bed resident while actually travelling out', () => {
      const worker = {
        id: 's1', role: 'waiter', morale: 50,
        dutyPhase: 'exiting',
        x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
        amenityUse: { amenityId: 'bed-1', phase: 'occupied', slotIndex: 0 },
        movementResidency: { kind: 'staff_amenity', amenityId: 'bed-1', slotIndex: 0 },
      };
      const state = {
        staff: [worker],
        staffAmenities: [{ id: 'bed-1', type: 'bed', slots: [] }],
      };
      // staffWellbeing keeps occupied use and movement residency until the exit
      // is legally reached, but the worker is already being routed out.
      expect(getStaffWellbeingMovementEntries(state)).toHaveLength(1);
      expect(getStaffVisualActivity(state, worker, { movement: TRAVERSING, indexes: bedIndexes }))
        .toBe('walking');
    });

    it('walks an exiting couch resident while actually travelling out', () => {
      const worker = {
        dutyPhase: 'exiting',
        x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
        amenityUse: { amenityId: 'couch-1', phase: 'occupied', slotIndex: 0 },
        movementResidency: { kind: 'staff_amenity', amenityId: 'couch-1', slotIndex: 0 },
      };
      expect(getStaffVisualActivity({}, worker, { movement: TRAVERSING, indexes: couchIndexes }))
        .toBe('walking');
    });

    it('walks an exiting arcade resident while actually travelling out', () => {
      const indexes = {
        staffAmenitiesByStringId: new Map([['arcade-1', { id: 'arcade-1', type: 'arcade' }]]),
      };
      const worker = {
        dutyPhase: 'exiting',
        x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
        amenityUse: { amenityId: 'arcade-1', phase: 'occupied', slotIndex: 0 },
      };
      expect(getStaffVisualActivity({}, worker, { movement: TRAVERSING, indexes })).toBe('walking');
    });

    it('keeps the anchored pose for a blocked exiting resident', () => {
      const worker = {
        dutyPhase: 'exiting',
        x: 0, y: 0, navigationGoal: { x: 40, y: 0 },
        amenityUse: { amenityId: 'bed-1', phase: 'occupied', slotIndex: 0 },
        movementResidency: { kind: 'staff_amenity', amenityId: 'bed-1', slotIndex: 0 },
      };
      const movement = { motion: 'holding', plan: 'planning' };
      expect(getStaffVisualActivity({}, worker, { movement, indexes: bedIndexes })).toBe('sleeping');
    });

    it('keeps a legacy anchored resident pose without an amenity record', () => {
      const staff = {
        movementResidency: { kind: 'staff_amenity', amenityId: 'bed-1', slotIndex: 0 },
      };
      expect(getStaffVisualActivity({}, staff, { movement: ARRIVED })).toBe('resting');
    });
  });

  it('does not mutate state, staff or options', () => {
    const state = deepFreeze({
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', type: 'toaster' }],
    });
    const staff = deepFreeze({
      task: { type: 'prepare_dish', stationId: 'k1', serviceItemIds: ['i1'] },
      activityPhase: 'working',
      carryingServiceItemIds: ['i1'],
    });
    const options = deepFreeze({ movement: ARRIVED, indexes: undefined });
    const before = JSON.stringify({ state, staff });

    expect(getStaffVisualActivity(state, staff, options)).toBe('toasting');
    expect(JSON.stringify({ state, staff })).toBe(before);
  });
});

describe('getCustomerVisualActivity', () => {
  it.each([
    ['queued', 'waiting'],
    ['entering', 'waiting'],
    ['seated', 'reading'],
    ['ordering', 'reading'],
    ['waiting_for_items', 'waiting'],
    ['waiting_for_party', 'waiting'],
    ['checkout_queued', 'waiting'],
    ['checkout_moving', 'waiting'],
    ['checkout_processing', 'paying'],
    ['paying', 'paying'],
    ['leaving', 'waiting'],
  ])('resolves a stationary %s customer as %s', (phase, activity) => {
    const customer = { id: 'c', state: phase };
    expect(getCustomerVisualActivity({}, customer, { movement: ARRIVED })).toBe(activity);
  });

  it('falls back to idle for a legacy record without a state', () => {
    expect(getCustomerVisualActivity({}, {})).toBe('idle');
    expect(getCustomerVisualActivity({}, null)).toBe('idle');
    expect(getCustomerVisualActivity(null, undefined)).toBe('idle');
    expect(getCustomerVisualActivity({}, { id: 'c', state: 'unknown_phase' },
      { movement: ARRIVED })).toBe('idle');
  });

  it.each(['queued', 'entering', 'checkout_queued', 'checkout_moving', 'leaving'])(
    'walks a traversing %s customer',
    phase => {
      const customer = { id: 'c', state: phase };
      expect(getCustomerVisualActivity({}, customer, { movement: TRAVERSING })).toBe('walking');
    },
  );

  it('keeps a seated departure resident while checkout waits', () => {
    const customer = {
      id: 'c', state: 'checkout_queued',
      seatResidency: { phase: 'seated' },
    };
    expect(getCustomerVisualActivity({}, customer, { movement: TRAVERSING })).toBe('waiting');
  });

  it('keeps residency before reported locomotion', () => {
    const customer = { id: 'c', state: 'seated', seatResidency: { phase: 'seated' } };
    expect(getCustomerVisualActivity({}, customer, { movement: TRAVERSING })).toBe('reading');
  });

  it('walks checkout travel only when locomotion is reported', () => {
    const customer = { id: 'c', state: 'checkout_moving' };
    const state = { customers: [customer], restaurant: { gameTime: 100 } };
    expect(getCustomerVisualActivity(state, customer)).toBe('waiting');
    expect(getCustomerVisualActivity(state, customer, { movement: TRAVERSING })).toBe('walking');
  });

  describe('consumption', () => {
    const item = (kind, overrides = {}) => ({
      id: overrides.id || 'i1',
      customerId: 'c',
      kind,
      state: 'delivered',
      consumptionStartedAt: 50,
      ...overrides,
    });
    const eatingState = (customer, items, gameTime = 100) => ({
      restaurant: { gameTime }, customers: [customer], serviceItems: items,
    });

    it('eats while a delivered dish is still being consumed', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = eatingState(customer, [item('dish')]);
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('eating');
    });

    it('drinks while a delivered drink is still being consumed', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = eatingState(customer, [item('drink')]);
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('drinking');
    });

    it('does not show the menu while a meal is actively consumed', () => {
      const customer = { id: 'c', state: 'seated' };
      const state = eatingState(customer, [item('dish')]);
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('eating');
    });

    it('alternates active food and drink deterministically', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = eatingState(customer, [item('dish'), item('drink', { id: 'i2' })]);
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED, timeMs: 0 }))
        .toBe('eating');
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED, timeMs: 900 }))
        .toBe('drinking');
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED, timeMs: 1800 }))
        .toBe('eating');
    });

    it('keeps a stable choice when reduced motion suppresses alternation', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = eatingState(customer, [item('dish'), item('drink', { id: 'i2' })]);
      const options = { movement: ARRIVED, timeMs: 900, reducedMotion: true };
      expect(getCustomerVisualActivity(state, customer, options)).toBe('eating');
    });

    it('ignores cancelled delivered items', () => {
      const customer = { id: 'c', state: 'eating' };
      expect(getCustomerVisualActivity(eatingState(customer, [item('dish', { foodCancelled: true })]),
        customer, { movement: ARRIVED })).toBe('waiting');
      const cancelled = { id: 'c', state: 'eating', cancelledServiceItemIds: ['i1'] };
      expect(getCustomerVisualActivity(eatingState(cancelled, [item('dish')]),
        cancelled, { movement: ARRIVED })).toBe('waiting');
    });

    it('ignores consumed items', () => {
      const customer = { id: 'c', state: 'eating' };
      expect(getCustomerVisualActivity(eatingState(customer, [item('dish', { consumedAt: 90 })]),
        customer, { movement: ARRIVED })).toBe('waiting');
      const consumed = { id: 'c', state: 'eating', consumedServiceItemIds: ['i1'] };
      expect(getCustomerVisualActivity(eatingState(consumed, [item('dish')]),
        consumed, { movement: ARRIVED })).toBe('waiting');
    });

    it('ignores undelivered and unknown-kind items', () => {
      const customer = { id: 'c', state: 'eating' };
      expect(getCustomerVisualActivity(eatingState(customer, [item('dish', { state: 'on_service' })]),
        customer, { movement: ARRIVED })).toBe('waiting');
      expect(getCustomerVisualActivity(eatingState(customer, [item('other')]),
        customer, { movement: ARRIVED })).toBe('waiting');
    });

    it('ignores items without a finite start timer', () => {
      const customer = { id: 'c', state: 'eating' };
      expect(getCustomerVisualActivity(eatingState(customer, [item('dish', { consumptionStartedAt: null })]),
        customer, { movement: ARRIVED })).toBe('waiting');
    });

    it('ignores expired consumption', () => {
      const customer = { id: 'c', state: 'eating' };
      expect(getCustomerVisualActivity(
        eatingState(customer, [item('dish', { consumptionStartedAt: 0 })], 600),
        customer,
        { movement: ARRIVED },
      )).toBe('waiting');
    });

    it('switches to the remaining drink or dish after one is consumed', () => {
      const customer = { id: 'c', state: 'eating' };
      const drinkOnly = eatingState(customer, [
        item('dish', { consumedAt: 90 }),
        item('drink', { id: 'i2' }),
      ]);
      expect(getCustomerVisualActivity(drinkOnly, customer, { movement: ARRIVED })).toBe('drinking');

      const dishOnly = eatingState(customer, [
        item('dish'),
        item('drink', { id: 'i2', state: 'dirty_at_table' }),
      ]);
      expect(getCustomerVisualActivity(dishOnly, customer, { movement: ARRIVED })).toBe('eating');
    });

    it('waits after all items are consumed', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = eatingState(customer, [
        item('dish', { consumedAt: 90 }),
        item('drink', { id: 'i2', consumedAt: 90 }),
      ]);
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('waiting');
    });

    it('uses the customer service-item index when present', () => {
      const customer = { id: 'c', state: 'eating' };
      const indexes = { serviceItemsByCustomerId: new Map([['c', [item('dish')]]]) };
      expect(getCustomerVisualActivity({ restaurant: { gameTime: 100 } }, customer,
        { movement: ARRIVED, indexes })).toBe('eating');
    });

    it('falls back to state service items when the index misses', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = eatingState(customer, [item('dish')]);
      expect(getCustomerVisualActivity(state, customer, {
        movement: ARRIVED,
        indexes: { serviceItemsByCustomerId: new Map() },
      })).toBe('eating');
    });

    it('does not eat without a seated state even when an item is active', () => {
      const customer = { id: 'c', state: 'entering' };
      const state = eatingState(customer, [item('dish')]);
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('waiting');
    });

    it('does not consume without a finite game time', () => {
      const customer = { id: 'c', state: 'eating' };
      const state = { customers: [customer], serviceItems: [item('dish')] };
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('waiting');
    });
  });

  describe('patience', () => {
    it('shows impatience when the food timer is low', () => {
      const customer = {
        id: 'c', state: 'waiting_for_items', foodOutcome: 'pending',
        foodPatienceBudget: 100, foodDeadlineAt: 120,
      };
      const state = { restaurant: { gameTime: 100 } };
      expect(getCustomerVisualActivity(state, customer, { movement: ARRIVED })).toBe('impatient');
    });

    it('waits when patience is healthy or the timer no longer applies', () => {
      const customer = {
        id: 'c', state: 'waiting_for_party', foodOutcome: 'pending',
        foodPatienceBudget: 100, foodDeadlineAt: 120,
      };
      expect(getCustomerVisualActivity({ restaurant: { gameTime: 40 } }, customer,
        { movement: ARRIVED })).toBe('waiting');
      const delivered = { ...customer, foodOutcome: 'delivered' };
      expect(getCustomerVisualActivity({ restaurant: { gameTime: 100 } }, delivered,
        { movement: ARRIVED })).toBe('waiting');
    });
  });

  describe('menu selection', () => {
    it('stops reading once an order outcome exists', () => {
      const customer = { id: 'c', state: 'seated', menuOutcome: 'ordered' };
      expect(getCustomerVisualActivity({}, customer, { movement: ARRIVED })).toBe('waiting');
    });

    it('does not read after a cancelled food order', () => {
      const customer = { id: 'c', state: 'seated', foodOutcome: 'cancelled' };
      expect(getCustomerVisualActivity({}, customer, { movement: ARRIVED })).toBe('waiting');
    });

    it('reads a legacy seated customer without order fields', () => {
      const customer = { id: 'c', state: 'seated' };
      expect(getCustomerVisualActivity({}, customer, { movement: ARRIVED })).toBe('reading');
    });
  });

  it('does not mutate state, customer or options', () => {
    const customer = deepFreeze({ id: 'c', state: 'eating', consumedServiceItemIds: [] });
    const state = deepFreeze({
      restaurant: { gameTime: 100 },
      serviceItems: [{
        id: 'i1', customerId: 'c', kind: 'dish', state: 'delivered', consumptionStartedAt: 50,
      }],
    });
    const before = JSON.stringify({ state, customer });
    const options = deepFreeze({ movement: ARRIVED, timeMs: 0, reducedMotion: false });

    expect(getCustomerVisualActivity(state, customer, options)).toBe('eating');
    expect(JSON.stringify({ state, customer })).toBe(before);
  });
});
