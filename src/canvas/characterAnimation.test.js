import { describe, expect, it } from 'vitest';
import {
  createCharacterAnimationClock,
  createCharacterTransitionHistory,
} from './characterAnimation';

describe('createCharacterAnimationClock', () => {
  it('starts at zero and accumulates valid frame deltas', () => {
    const clock = createCharacterAnimationClock();

    expect(clock.update(0, { speed: 1 })).toBe(0);
    expect(clock.update(100, { speed: 1 })).toBe(100);
    expect(clock.update(200, { speed: 1 })).toBe(200);
  });

  it('baselines pause and resume transitions so paused wall time is not counted', () => {
    const clock = createCharacterAnimationClock();

    expect(clock.update(0, { speed: 1 })).toBe(0);
    expect(clock.update(100, { speed: 1 })).toBe(100);
    expect(clock.update(200, { speed: 1, paused: true })).toBe(100);
    expect(clock.update(300, { speed: 1, paused: true })).toBe(100);
    expect(clock.update(400, { speed: 1, paused: false })).toBe(100);
    expect(clock.update(500, { speed: 1, paused: false })).toBe(200);
  });

  it('scales stable deltas at 1x, 2x and 4x while baselining speed changes', () => {
    const clock = createCharacterAnimationClock();

    expect(clock.update(0, { speed: 1 })).toBe(0);
    expect(clock.update(100, { speed: 1 })).toBe(100);
    expect(clock.update(200, { speed: 2 })).toBe(100);
    expect(clock.update(300, { speed: 2 })).toBe(300);
    expect(clock.update(400, { speed: 4 })).toBe(300);
    expect(clock.update(450, { speed: 4 })).toBe(500);
  });

  it('discards background gaps above 250ms and resumes from the new baseline', () => {
    const clock = createCharacterAnimationClock();

    expect(clock.update(0, { speed: 1 })).toBe(0);
    expect(clock.update(250, { speed: 1 })).toBe(250);
    expect(clock.update(501, { speed: 1 })).toBe(250);
    expect(clock.update(601, { speed: 1 })).toBe(350);
    expect(clock.update(851, { speed: 1 })).toBe(600);
  });

  it('resets on generation changes and game-time or frame-time rewinds', () => {
    const clock = createCharacterAnimationClock();

    expect(clock.update(0, { speed: 1, generation: 1, gameTime: 10 })).toBe(0);
    expect(clock.update(100, { speed: 1, generation: 1, gameTime: 20 })).toBe(100);
    expect(clock.update(200, { speed: 1, generation: 2, gameTime: 30 })).toBe(0);
    expect(clock.update(300, { speed: 1, generation: 2, gameTime: 40 })).toBe(100);
    expect(clock.update(400, { speed: 1, generation: 2, gameTime: 5 })).toBe(0);
    expect(clock.update(500, { speed: 1, generation: 2, gameTime: 6 })).toBe(100);
    expect(clock.update(450, { speed: 1, generation: 2, gameTime: 7 })).toBe(0);
    expect(clock.update(550, { speed: 1, generation: 2, gameTime: 8 })).toBe(100);
  });

  it('ignores invalid timestamps without poisoning later frame deltas', () => {
    const clock = createCharacterAnimationClock();

    expect(clock.update(0, { speed: 1 })).toBe(0);
    expect(clock.update(100, { speed: 1 })).toBe(100);
    expect(clock.update(Number.NaN, { speed: 1 })).toBe(100);
    expect(clock.update(1000, { speed: 1 })).toBe(100);
    expect(clock.update(1100, { speed: 1 })).toBe(200);
    expect(clock.update(Number.POSITIVE_INFINITY, { speed: 1 })).toBe(200);
  });

  it('clears its baseline and accumulated time on reset', () => {
    const clock = createCharacterAnimationClock();

    clock.update(0, { speed: 1 });
    expect(clock.update(100, { speed: 1 })).toBe(100);
    clock.reset();

    expect(clock.update(1000, { speed: 1 })).toBe(0);
    expect(clock.update(1100, { speed: 1 })).toBe(100);
  });
});

describe('createCharacterTransitionHistory', () => {
  it.each([
    ['clean delivery', 'deliver_service_item'],
    ['dirty delivery', 'deliver_dirty_item'],
  ])('treats numeric and string item IDs as the same ID for %s', (_label, taskType) => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'worker', task: { type: taskType, serviceItemId: 1 }, carryingServiceItemIds: [1],
    }], 0);

    expect(history.update([{
      id: 'worker', task: null, carryingServiceItemIds: ['1'],
    }], 100)).toEqual(new Map());
  });

  it('does not invent a gesture for actors already carrying on first observation', () => {
    const history = createCharacterTransitionHistory();
    const staff = [{
      id: 'waiter',
      task: { type: 'deliver_service_item' },
      carryingServiceItemIds: ['dish-1'],
    }];

    expect(history.update(staff, 0)).toEqual(new Map());
    expect(history.update(staff, 100)).toEqual(new Map());
  });

  it('detects clean pickups and service delivery from carried-ID changes', () => {
    const history = createCharacterTransitionHistory();
    const waiter = {
      id: 'waiter', task: { type: 'pickup_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    };

    expect(history.update([waiter], 0)).toEqual(new Map());
    expect(history.update([{
      ...waiter,
      task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }], 100)).toEqual(new Map([['waiter', 'pickup']]));
    expect(history.update([{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    }], 200)).toEqual(new Map([['waiter', 'serving']]));
  });

  it.each([
    ['waiter counter pickup', 'pickup_service_item', 'deliver_service_item'],
    ['cook dish completion', 'prepare_dish', 'place_dish_on_service'],
    ['cook drink completion', 'prepare_drink', 'place_dish_on_service'],
  ])('classifies %s as a clean pickup', (_label, previousTask, currentTask) => {
    const history = createCharacterTransitionHistory();
    const actor = {
      id: 'staff-1', task: { type: previousTask, serviceItemId: 'item-1' },
      carryingServiceItemIds: [],
    };
    history.update([actor], 0);

    expect(history.update([{
      id: 'staff-1', task: { type: currentTask, serviceItemId: 'item-1' },
      carryingServiceItemIds: ['item-1'],
    }], 100)).toEqual(new Map([['staff-1', 'pickup']]));
  });

  it('classifies table collection and dirty transfer as collecting, then dirty delivery as depositing', () => {
    for (const pickupTask of ['collect_dirty_item', 'transfer_dirty_item']) {
      const history = createCharacterTransitionHistory();
      history.update([{
        id: 'waiter', task: { type: pickupTask, serviceItemId: 'dirty-1' },
        carryingServiceItemIds: [],
      }], 0);

      expect(history.update([{
        id: 'waiter', task: { type: 'deliver_dirty_item', serviceItemId: 'dirty-1' },
        carryingServiceItemIds: ['dirty-1'],
      }], 100)).toEqual(new Map([['waiter', 'collecting']]));
      expect(history.update([{
        id: 'waiter', task: null, carryingServiceItemIds: [],
      }], 200)).toEqual(new Map([['waiter', 'depositing']]));
    }
  });

  it('classifies cooking-counter drop-off as serving', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'cook', task: { type: 'prepare_dish', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    }], 0);
    history.update([{
      id: 'cook', task: { type: 'place_dish_on_service', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }], 100);

    expect(history.update([{
      id: 'cook', task: null, carryingServiceItemIds: [],
    }], 200)).toEqual(new Map([['cook', 'serving']]));
  });

  it('does not gesture when a removed load is unrelated to the delivery task target', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'waiter',
      task: { type: 'deliver_service_item', serviceItemId: 'target' },
      carryingServiceItemIds: ['unrelated'],
    }], 0);

    expect(history.update([{
      id: 'waiter', task: null, carryingServiceItemIds: [],
    }], 100)).toEqual(new Map());
  });

  it.each([
    ['missing item', []],
    ['requeued item', [{
      id: 'dish-1', kind: 'dish', state: 'to_clean', customerId: 'customer',
    }]],
    ['cancelled item', [{
      id: 'dish-1', kind: 'dish', state: 'to_clean', customerId: 'customer', foodCancelled: true,
      deliveryProhibited: true,
    }]],
  ])('does not claim successful service delivery for a %s when authoritative items are supplied',
    (_label, serviceItems) => {
      const history = createCharacterTransitionHistory();
      history.update([{
        id: 'waiter', role: 'waiter',
        task: {
          type: 'deliver_service_item', serviceItemId: 'dish-1', customerId: 'customer',
        },
        carryingServiceItemIds: ['dish-1'],
      }], 0);

      expect(history.update([{
        id: 'waiter', role: 'waiter', task: null, carryingServiceItemIds: [],
      }], 100, { serviceItems })).toEqual(new Map());
    });

  it('recognises service delivery only when the correlated target reached delivered state', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'waiter', role: 'waiter',
      task: { type: 'deliver_service_item', serviceItemId: 1, customerId: 'customer' },
      carryingServiceItemIds: [1],
    }], 0);

    expect(history.update([{
      id: 'waiter', role: 'waiter', task: null, carryingServiceItemIds: [],
    }], 100, {
      serviceItems: [{
        id: '1', kind: 'dish', state: 'delivered', customerId: 'customer',
      }],
    })).toEqual(new Map([['waiter', 'serving']]));
  });

  it.each([
    ['missing item', []],
    ['not-yet-deposited item', [{ id: 'dirty-1', kind: 'dish', state: 'carried_dirty' }]],
    ['wrong destination', [{
      id: 'dirty-1', kind: 'dish', state: 'queued_for_wash', washStationId: 'other-sink',
    }]],
    ['cancelled item', [{
      id: 'dirty-1', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink',
      foodCancelled: true, deliveryProhibited: true,
    }]],
  ])('does not claim dirty deposit success for a %s when authoritative items are supplied',
    (_label, serviceItems) => {
      const history = createCharacterTransitionHistory();
      history.update([{
        id: 'waiter', role: 'waiter',
        task: { type: 'deliver_dirty_item', serviceItemId: 'dirty-1', washStationId: 'sink' },
        carryingServiceItemIds: ['dirty-1'],
      }], 0);

      expect(history.update([{
        id: 'waiter', role: 'waiter', task: null, carryingServiceItemIds: [],
      }], 100, { serviceItems })).toEqual(new Map());
    });

  it('recognises dirty deposit only when the correlated target reached its task destination', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'waiter', role: 'waiter',
      task: { type: 'deliver_dirty_item', serviceItemId: 'dirty-1', washStationId: 'sink' },
      carryingServiceItemIds: ['dirty-1'],
    }], 0);

    expect(history.update([{
      id: 'waiter', role: 'waiter', task: null, carryingServiceItemIds: [],
    }], 100, {
      serviceItems: [{ id: 'dirty-1', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink' }],
    })).toEqual(new Map([['waiter', 'depositing']]));
  });

  it('requires a matching task target and carried lifecycle for authoritative pickups', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'waiter', role: 'waiter',
      task: { type: 'pickup_service_item', serviceItemId: 'target', serviceTableId: 'counter-1' },
      carryingServiceItemIds: [],
    }], 0);

    expect(history.update([{
      id: 'waiter', role: 'waiter',
      task: { type: 'deliver_service_item', serviceItemId: 'target' },
      carryingServiceItemIds: ['other'],
    }], 100, {
      serviceItems: [
        { id: 'target', kind: 'dish', state: 'on_service', serviceTableId: 'counter-1' },
        { id: 'other', kind: 'dish', state: 'carried' },
      ],
    })).toEqual(new Map());

    const validHistory = createCharacterTransitionHistory();
    validHistory.update([{
      id: 'waiter', role: 'waiter',
      task: { type: 'pickup_service_item', serviceItemId: 'target', serviceTableId: 'counter-1' },
      carryingServiceItemIds: [],
    }], 0);
    expect(validHistory.update([{
      id: 'waiter', role: 'waiter',
      task: { type: 'deliver_service_item', serviceItemId: 'target' },
      carryingServiceItemIds: ['target'],
    }], 100, {
      serviceItems: [{ id: 'target', kind: 'dish', state: 'carried', serviceTableId: 'counter-1' }],
    })).toEqual(new Map([['waiter', 'pickup']]));
  });

  it('validates cook batch and preparation fields before showing a pickup', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'cook', role: 'cook',
      task: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'dish-1',
        serviceItemIds: ['dish-1', 'dish-2'], stationId: 'kitchen-1',
      },
      carryingServiceItemIds: [],
    }], 0);

    expect(history.update([{
      id: 'cook', role: 'cook',
      task: {
        type: 'place_dish_on_service', batchId: 'batch-2', serviceItemId: 'dish-1',
        serviceItemIds: ['dish-1'], serviceTableId: 'counter-1', serviceSlotIndex: 0,
      },
      carryingServiceItemIds: ['dish-1'],
    }], 100, {
      serviceItems: [{
        id: 'dish-1', kind: 'dish', state: 'carried', assignedStaffId: 'cook',
        batchId: 'batch-1', serviceTableId: 'counter-1', serviceSlotIndex: 0,
      }],
    })).toEqual(new Map());
  });

  it('recognises a successful cook batch drop after the simulator clears the completed batch ID', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'cook', role: 'cook',
      task: {
        type: 'place_dish_on_service', batchId: 'batch-1', serviceItemId: 'dish-1',
        serviceItemIds: ['dish-1', 'dish-2'], serviceTableId: 'counter-1', serviceSlotIndex: 0,
      },
      carryingServiceItemIds: ['dish-1', 'dish-2'],
    }], 0);

    expect(history.update([{
      id: 'cook', role: 'cook',
      task: {
        type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'dish-2',
        serviceItemIds: ['dish-2'], stationId: 'kitchen-1',
      },
      carryingServiceItemIds: ['dish-2'],
    }], 100, {
      serviceItems: [
        {
          id: 'dish-1', kind: 'dish', state: 'on_service', serviceTableId: 'counter-1',
          serviceSlotIndex: 0, assignedStaffId: null,
        },
        {
          id: 'dish-2', kind: 'dish', state: 'carried', batchId: 'batch-1',
          assignedStaffId: 'cook', serviceTableId: 'counter-1', serviceSlotIndex: 1,
        },
      ],
    })).toEqual(new Map([['cook', 'serving']]));
  });

  it('validates prepared drink counter and slot before showing a cook pickup', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'cook', role: 'cook',
      task: {
        type: 'prepare_drink', serviceItemId: 'drink-1', stationId: 'kitchen-1',
        serviceTableId: 'counter-1', serviceSlotIndex: 0,
      },
      carryingServiceItemIds: [],
    }], 0);

    expect(history.update([{
      id: 'cook', role: 'cook',
      task: {
        type: 'place_dish_on_service', serviceItemId: 'drink-1',
        serviceTableId: 'counter-1', serviceSlotIndex: 0,
      },
      carryingServiceItemIds: ['drink-1'],
    }], 100, {
      serviceItems: [{
        id: 'drink-1', kind: 'drink', state: 'carried', assignedStaffId: 'cook',
        serviceTableId: 'counter-1', serviceSlotIndex: 1,
      }],
    })).toEqual(new Map());
  });

  it('expires gestures after 450 animation milliseconds', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'waiter', task: { type: 'pickup_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    }], 0);
    expect(history.update([{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }], 10)).toEqual(new Map([['waiter', 'pickup']]));

    const stillCarrying = [{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }];
    expect(history.update(stillCarrying, 459)).toEqual(new Map([['waiter', 'pickup']]));
    expect(history.update(stillCarrying, 460)).toEqual(new Map());
  });

  it('evicts departed actors and treats their return as a first observation', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 'waiter', task: { type: 'pickup_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    }], 0);
    expect(history.update([{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }], 10)).toEqual(new Map([['waiter', 'pickup']]));

    expect(history.update([], 20)).toEqual(new Map());
    expect(history.update([{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }], 30)).toEqual(new Map());
  });

  it('resets on generation changes and game-time rewinds without phantom gestures', () => {
    const history = createCharacterTransitionHistory();
    const unladen = [{
      id: 'waiter', task: { type: 'pickup_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    }];
    const laden = [{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }];

    expect(history.update(unladen, 0, { generation: 1, gameTime: 10 })).toEqual(new Map());
    expect(history.update(laden, 100, { generation: 1, gameTime: 20 }))
      .toEqual(new Map([['waiter', 'pickup']]));
    expect(history.update(unladen, 110, { generation: 2, gameTime: 30 })).toEqual(new Map());
    expect(history.update(laden, 120, { generation: 2, gameTime: 40 }))
      .toEqual(new Map([['waiter', 'pickup']]));
    expect(history.update(unladen, 130, { generation: 2, gameTime: 5 })).toEqual(new Map());
    expect(history.update(laden, 140, { generation: 2, gameTime: 6 }))
      .toEqual(new Map([['waiter', 'pickup']]));
  });

  it('snapshots task types and carried IDs instead of retaining actor objects or arrays', () => {
    const history = createCharacterTransitionHistory();
    const actor = {
      id: 'waiter',
      task: { type: 'pickup_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    };
    history.update([actor], 0);

    actor.task = { type: 'deliver_service_item', serviceItemId: 'dish-1' };
    actor.carryingServiceItemIds.push('dish-1');
    expect(history.update([actor], 100)).toEqual(new Map([['waiter', 'pickup']]));
  });

  it('preserves scalar ID zero and ignores non-scalar actor or inventory IDs', () => {
    const history = createCharacterTransitionHistory();
    history.update([{
      id: 0, task: { type: 'pickup_service_item', serviceItemId: 0 },
      carryingServiceItemIds: [],
    }], 0);
    expect(history.update([{
      id: 0, task: { type: 'deliver_service_item', serviceItemId: '0' },
      carryingServiceItemIds: [0],
    }], 100)).toEqual(new Map([[0, 'pickup']]));

    const objectId = {};
    expect(history.update([{
      id: {}, task: { type: 'pickup_service_item' }, carryingServiceItemIds: [],
    }], 200)).toEqual(new Map());
    expect(history.update([{
      id: 0, task: { type: 'deliver_service_item' }, carryingServiceItemIds: [objectId],
    }], 300)).toEqual(new Map());
  });

  it('clears actors and active gestures on reset', () => {
    const history = createCharacterTransitionHistory();
    const unladen = [{
      id: 'waiter', task: { type: 'pickup_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: [],
    }];
    const laden = [{
      id: 'waiter', task: { type: 'deliver_service_item', serviceItemId: 'dish-1' },
      carryingServiceItemIds: ['dish-1'],
    }];

    history.update(unladen, 0);
    expect(history.update(laden, 10)).toEqual(new Map([['waiter', 'pickup']]));
    history.reset();
    expect(history.update(laden, 20)).toEqual(new Map());
  });
});
