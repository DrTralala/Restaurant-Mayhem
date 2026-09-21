import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAmenitySlots } from '../../data/staffAmenities';
import { createInitialState } from '../../state/initialState';
import { hydrateState, loadState, saveState } from '../../state/persistence';
import { prepareCustomersForMovement } from '../customers';
import { runTick } from '../gameLoop';
import {
  advanceStaffWellbeing,
  STAFF_WELLBEING_RETRY_SECONDS,
} from '../staffWellbeing';
import * as preflight from './preflight';
import { queryReachability, runPreflightFrame } from './preflight';

const line = (signature = 'line') => ({
  signature,
  isOpen: point => point?.y === 0 && point.x >= 0 && point.x <= 200 && point.x % 20 === 0,
  segmentClear: (a, b) => a.y === 0 && b.y === 0 && a.x >= 0 && b.x >= 0 && a.x <= 200 && b.x <= 200,
  neighbours: point => [point.x - 20, point.x + 20].filter(x => x >= 0 && x <= 200)
    .map(x => ({ x, y: 0 })),
  connectors: () => [],
});

const start = { x: 0, y: 0 };
const goal = { x: 200, y: 0 };

function entryFor(runtime, channel) {
  return [...runtime.entries].find(([key]) => JSON.parse(key)[0] === channel)?.[1];
}

function entriesFor(runtime, prefix) {
  return [...(runtime?.entries || [])]
    .filter(([key]) => JSON.parse(key)[0].startsWith(prefix))
    .map(([key, entry]) => ({ key, entry }));
}

function queryKey({ channel, grid, start: startPoint, goal: goalPoint }) {
  return JSON.stringify([
    channel, grid.signature, startPoint?.x, startPoint?.y, goalPoint?.x, goalPoint?.y,
  ]);
}

function withReducedQuantum(quantum, seen, run) {
  const original = preflight.queryReachability;
  const spy = vi.spyOn(preflight, 'queryReachability').mockImplementation((channel, grid, startPoint, goalPoint) => {
    seen?.push({ channel, grid, start: startPoint, goal: goalPoint });
    return original(channel, grid, startPoint, goalPoint, quantum);
  });
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

function realExitState() {
  const initial = createInitialState();
  return {
    ...initial,
    tables: [...initial.tables, {
      id: 'route-detour', seats: 4, status: 'empty', x: 760, y: 180,
    }],
    customers: [{
      id: 'real-grid-exit', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
      x: 700, y: 200, patience: 100, happiness: 80,
    }],
    queue: [], queueSlots: [], queueDepartures: [],
  };
}

function realAmenityState() {
  const initial = createInitialState();
  const schedule = Array.from({ length: 48 }, () => 'rest');
  return {
    ...initial,
    staff: [{
      ...initial.staff[0], id: 'real-grid-amenity', x: 500, y: 530,
      schedule, effectiveDuty: 'rest', dutyPhase: 'available', task: null,
    }],
    staffAmenities: [{
      id: 'real-grid-couch', type: 'couch', x: 600, y: 500, rotation: 0,
      slots: createEmptyAmenitySlots('couch'),
    }],
  };
}

function realBlockedExitState() {
  const initial = createInitialState();
  const wall = Array.from({ length: 22 }, (_, index) => ({
    id: `route-wall-${index}`, seats: 4, status: 'empty', x: 50 + index * 40, y: 300,
  }));
  return {
    ...initial,
    tables: wall, chairs: [], kitchenStations: [], serviceTables: [],
    cashierStations: [], washStations: [], staffAmenities: [], staff: [],
    doors: [{ id: 'door2', y: 440, role: 'exit' }],
    customers: [{
      id: 'real-unreachable-exit', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
      x: 100, y: 200, patience: 100, happiness: 80,
    }],
    queue: [], queueSlots: [], queueDepartures: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('bounded preflight continuation', () => {
  it('finishes a stable query with one expansion per complete frame', () => {
    let runtime;
    let status;
    for (let frame = 0; frame < 20 && status !== 'found'; frame += 1) {
      const result = runPreflightFrame(runtime,
        () => queryReachability('exit:a', line(), start, goal, 1));
      runtime = result.runtime;
      status = result.value;
    }
    expect(status).toBe('found');
  });

  it('spends once per query per frame and leaves the previous cursor unchanged', () => {
    const first = runPreflightFrame(undefined,
      () => queryReachability('exit:a', line(), start, goal, 1));
    const previous = entryFor(first.runtime, 'exit:a').cursor;
    const costs = [...previous.costs];
    const frontier = [...previous.frontier];

    const single = runPreflightFrame(first.runtime,
      () => queryReachability('exit:a', line(), start, goal, 1));
    const repeated = runPreflightFrame(first.runtime, () => {
      const firstStatus = queryReachability('exit:a', line(), start, goal, 1);
      const secondStatus = queryReachability('exit:a', line(), start, goal, 1);
      expect(secondStatus).toBe(firstStatus);
      return secondStatus;
    });

    expect(repeated.value).toBe(single.value);
    expect(entryFor(repeated.runtime, 'exit:a').cursor.frontier)
      .toEqual(entryFor(single.runtime, 'exit:a').cursor.frontier);
    expect([...entryFor(repeated.runtime, 'exit:a').cursor.costs])
      .toEqual([...entryFor(single.runtime, 'exit:a').cursor.costs]);
    expect([...previous.costs]).toEqual(costs);
    expect(previous.frontier).toEqual(frontier);

    const next = runPreflightFrame(repeated.runtime,
      () => queryReachability('exit:a', line(), start, goal, 1));
    expect(next.value).toBe('pending');
    expect([...entryFor(next.runtime, 'exit:a').cursor.costs].length)
      .toBeGreaterThan(entryFor(repeated.runtime, 'exit:a').cursor.costs.size);
  });

  it('does not reuse continuation across actor, endpoint, topology, or door-flow changes', () => {
    const first = runPreflightFrame(undefined,
      () => queryReachability('exit:a', line('topology:door-a'), start, goal, 1));
    const continued = runPreflightFrame(first.runtime,
      () => queryReachability('exit:a', line('topology:door-a'), start, goal, 1));
    expect(continued.runtime.entries.size).toBe(1);
    expect(entryFor(continued.runtime, 'exit:a').cursor.costs.size)
      .toBeGreaterThan(entryFor(first.runtime, 'exit:a').cursor.costs.size);

    const changed = runPreflightFrame(continued.runtime, () => {
      queryReachability('exit:b', line('topology:door-a'), start, goal, 1);
      queryReachability('exit:a', line('topology:door-b'), start, goal, 1);
      queryReachability('exit:a', line('topology:door-a'), { x: 20, y: 0 }, goal, 1);
      return queryReachability('exit:a', line('topology:door-a'), start, { x: 180, y: 0 }, 1);
    });
    expect(changed.value).toBe('pending');
    expect(changed.runtime.entries.size).toBe(5);
  });

  it('waits at capacity without evicting pending work, then admits completed and inactive slots', () => {
    const first = runPreflightFrame(undefined, () => {
      for (let index = 0; index < 128; index += 1) {
        expect(queryReachability(`actor:${index}`, line(), start, goal, 1)).toBe('pending');
      }
      return queryReachability('actor:128', line(), start, goal, 1);
    });
    expect(first.value).toBe('capacity-wait');
    expect(first.runtime.entries.size).toBe(128);
    expect(entryFor(first.runtime, 'actor:0')).toMatchObject({ status: 'pending' });

    const completed = runPreflightFrame(first.runtime, () => {
      for (let index = 0; index < 128; index += 1) {
        expect(queryReachability(`actor:${index}`, line(), start, goal, 2048)).toBe('found');
      }
      return 'completed';
    });
    expect(completed.runtime.entries.size).toBe(128);

    const admitted = runPreflightFrame(completed.runtime,
      () => queryReachability('actor:128', line(), start, goal, 1));
    expect(admitted.value).toBe('pending');
    expect(admitted.runtime.entries.size).toBe(128);
    expect(entryFor(admitted.runtime, 'actor:128')).toMatchObject({ status: 'pending' });

    let inactive = admitted.runtime;
    for (let frame = 0; frame < 121; frame += 1) {
      inactive = runPreflightFrame(inactive, () => null).runtime;
    }
    expect(inactive.entries.size).toBe(0);
  });

  it('uses the real customer exit controller inside the exported tick frame', () => {
    const initial = createInitialState();
    let state = {
      ...initial,
      customers: [{
        id: 'real-exit', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
        x: 700, y: 200, patience: 100, happiness: 80,
      }],
      queue: [], queueSlots: [], queueDepartures: [],
    };
    let status;
    for (let tick = 0; tick < 4 && status !== 'found'; tick += 1) {
      state = runTick(state, { gameDt: 0, movementDt: 0 });
      status = entryFor(state.navigationPreflight, 'exit:real-exit:door2')?.status;
    }
    expect(status).toBe('found');
    expect(state.customers[0].navigationGoal).toBeDefined();
  });

  it('uses the real staff amenity controller and invalidates a changed amenity topology', () => {
    const initial = createInitialState();
    const schedule = Array.from({ length: 48 }, () => 'rest');
    const worker = {
      ...initial.staff[0], id: 'amenity-worker', x: 500, y: 530,
      schedule, effectiveDuty: 'rest', dutyPhase: 'available', task: null,
    };
    const amenity = {
      id: 'couch-1', type: 'couch', x: 600, y: 500, rotation: 0,
      slots: createEmptyAmenitySlots('couch'),
    };
    const state = { ...initial, staff: [worker], staffAmenities: [amenity] };
    const first = runPreflightFrame(undefined,
      () => advanceStaffWellbeing(state, 0, 0));
    expect(entryFor(first.runtime, 'amenity:amenity-worker')).toMatchObject({ status: 'found' });
    expect(first.value.staff[0].amenityUse).toMatchObject({ phase: 'reserved' });

    const changedState = { ...state, staffAmenities: [{ ...amenity, x: 640 }] };
    const changed = runPreflightFrame(first.runtime,
      () => advanceStaffWellbeing(changedState, 0, 0));
    expect(changed.runtime.entries.size).toBeGreaterThan(first.runtime.entries.size);
  });

  it('invalidates the customer exit-flow grid when amenity geometry changes', () => {
    const initial = createInitialState();
    const amenity = {
      id: 'couch-exit-topology', type: 'couch', x: 600, y: 500, rotation: 0,
      slots: createEmptyAmenitySlots('couch'),
    };
    const customer = {
      id: 'topology-exit', state: 'leaving', exitPhase: 'to_door', exitDoorId: 'door2',
      x: 700, y: 200, patience: 100, happiness: 80,
    };
    const first = runTick({
      ...initial, staffAmenities: [amenity], customers: [customer],
      queue: [], queueSlots: [], queueDepartures: [],
    }, { gameDt: 0, movementDt: 0 });
    const changed = runTick({
      ...first,
      staffAmenities: [{ ...amenity, x: 640 }],
    }, { gameDt: 0, movementDt: 0 });
    expect(changed.navigationPreflight.entries.size)
      .toBeGreaterThan(first.navigationPreflight.entries.size);
  });

  it('resumes a reduced-quantum real customer domain-grid search through the controller', () => {
    const seen = [];
    const result = withReducedQuantum(1, seen, () => {
      let state = realExitState();
      let runtime;
      let firstKey;
      let firstCosts;
      let completed;
      for (let frame = 0; frame < 200 && !completed; frame += 1) {
        const next = runPreflightFrame(runtime,
          () => prepareCustomersForMovement(state, 0));
        state = next.value;
        runtime = next.runtime;
        const exitEntries = entriesFor(runtime, 'exit:real-grid-exit');
        const pending = exitEntries.find(({ entry }) => entry.status === 'pending');
        if (!firstKey && pending) {
          firstKey = pending.key;
          firstCosts = pending.entry.cursor.costs.size;
        }
        completed = exitEntries.find(({ entry }) => entry.status === 'found')?.entry;
      }
      return {
        runtime, firstKey, firstCosts, completed,
        finalFirst: firstKey ? runtime.entries.get(firstKey) : null,
        state,
      };
    });

    expect(result.firstKey).toBeDefined();
    expect(result.firstCosts).toBeGreaterThan(1);
    expect(result.completed).toMatchObject({ status: 'found' });
    expect(result.finalFirst.cursor.costs.size).toBeGreaterThan(result.firstCosts);
    expect(result.state.customers[0].navigationGoal).toBeDefined();
    expect(seen.some(({ channel, grid }) => channel.startsWith('exit:real-grid-exit')
      && grid.signature.includes(':flow:egress:door2:'))).toBe(true);
  });

  it('resumes a reduced-quantum real amenity search through retrying wellbeing control', () => {
    const seen = [];
    const result = withReducedQuantum(1, seen, () => {
      let state = realAmenityState();
      let runtime;
      let now = 0;
      let firstKey;
      let firstCosts;
      let reserved = false;
      for (let attempt = 0; attempt < 80 && !reserved; attempt += 1) {
        const next = runPreflightFrame(runtime,
          () => advanceStaffWellbeing(state, now, now));
        state = next.value;
        runtime = next.runtime;
        const amenityEntries = entriesFor(runtime, 'amenity:real-grid-amenity');
        const pending = amenityEntries.find(({ entry }) => entry.status === 'pending');
        if (!firstKey && pending) {
          firstKey = pending.key;
          firstCosts = pending.entry.cursor.costs.size;
        }
        reserved = state.staff[0].amenityUse?.phase === 'reserved';
        now += STAFF_WELLBEING_RETRY_SECONDS;
      }
      return { runtime, firstKey, firstCosts, reserved };
    });

    expect(result.firstKey).toBeDefined();
    expect(result.firstCosts).toBeGreaterThan(1);
    expect(result.reserved).toBe(true);
    expect(result.runtime.entries.get(result.firstKey)).toMatchObject({ status: 'found' });
    expect(seen.some(({ channel, grid }) => channel === 'amenity:real-grid-amenity'
      && !grid.doorFlow)).toBe(true);
  });

  it('exhausts a real unreachable customer geometry instead of caching pending as unreachable', () => {
    const seen = [];
    const result = withReducedQuantum(256, seen, () => {
      let state = realBlockedExitState();
      let runtime;
      let sawPending = false;
      let terminal = false;
      for (let frame = 0; frame < 40 && !terminal; frame += 1) {
        const next = runPreflightFrame(runtime,
          () => prepareCustomersForMovement(state, 0));
        state = next.value;
        runtime = next.runtime;
        const entries = entriesFor(runtime, 'exit:real-unreachable-exit');
        sawPending ||= entries.some(({ entry }) => entry.status === 'pending');
        terminal = entries.length > 0 && entries.every(({ entry }) => entry.status === 'unreachable');
      }
      return { state, runtime, sawPending, terminal };
    });

    expect(result.sawPending).toBe(true);
    expect(result.terminal).toBe(true);
    expect(entriesFor(result.runtime, 'exit:real-unreachable-exit')
      .every(({ entry }) => entry.status === 'unreachable')).toBe(true);
    expect(result.state.customers[0].navigationGoal).toBeUndefined();
    expect(seen.some(({ channel, grid }) => channel.startsWith('exit:real-unreachable-exit')
      && grid.signature.includes(':flow:egress:door2:'))).toBe(true);
  });

  it('preserves missing exit and entrance policy decisions in real customer preparation', () => {
    const leaving = realExitState();
    leaving.doors = [{ id: 'door1', y: 340, role: 'entrance' }];
    const noExit = runPreflightFrame(undefined,
      () => prepareCustomersForMovement(leaving, 0));
    expect(noExit.value.customers[0].navigationGoal).toBeUndefined();
    expect(entriesFor(noExit.runtime, 'exit:real-grid-exit')).toHaveLength(0);

    const entering = realExitState();
    entering.doors = [{ id: 'door2', y: 440, role: 'exit' }];
    entering.customers = [{
      id: 'real-no-entrance', state: 'entering', entryDoorId: 'door1',
      x: 980, y: 360,
    }];
    const noEntrance = runPreflightFrame(undefined,
      () => prepareCustomersForMovement(entering, 0));
    expect(noEntrance.value.customers[0]).toMatchObject({ entryDoorId: null });
    expect(noEntrance.value.customers[0].navigationGoal).toBeUndefined();
  });

  it('uses synchronous fallback outside a frame and restores context after a thrown frame', () => {
    expect(queryReachability('standalone:found', line(), start, goal, 1)).toBe('found');
    expect(queryReachability('standalone:unreachable', {
      ...line('standalone:closed'), neighbours: () => [],
    }, start, goal, 1)).toBe('unreachable');

    const outer = runPreflightFrame(undefined, () => {
      expect(() => runPreflightFrame(undefined, () => {
        throw new Error('preflight callback failed');
      })).toThrow('preflight callback failed');
      return queryReachability('after-throw:outer', line(), start, goal, 1);
    });
    expect(outer.value).toBe('pending');
    expect(entryFor(outer.runtime, 'after-throw:outer')).toMatchObject({ status: 'pending' });
    expect(queryReachability('after-throw:standalone', line(), start, goal, 1)).toBe('found');
  });

  it('strips a valid pending version-one cache and starts a fresh post-restore query', () => {
    const pending = runPreflightFrame(undefined,
      () => queryReachability('restore-query', line(), start, goal, 1)).runtime;
    const state = { ...createInitialState(), navigationPreflight: pending };

    saveState(state);
    const saved = loadState();
    expect(saved.navigationPreflight).toBeUndefined();
    const restored = hydrateState(saved, createInitialState());
    expect(restored.navigationPreflight).toBeUndefined();

    const first = runPreflightFrame(restored.navigationPreflight,
      () => queryReachability('restore-query', line(), start, goal, 1));
    expect(first.runtime.frame).toBe(1);
    expect(first.value).toBe('pending');
    expect(first.runtime.entries.size).toBe(1);
    expect(first.runtime.entries.get(JSON.stringify([
      'restore-query', 'line', 0, 0, 200, 0,
    ])).cursor.costs.size).toBe(2);
  });

  it('advances a same-key query once across a complete multi-segment exported tick', () => {
    const seen = [];
    const initial = realExitState();
    const schedule = Array.from({ length: 48 }, () => 'work');
    schedule[1] = 'rest';
    const state = {
      ...initial,
      restaurant: { ...initial.restaurant, gameTime: 0, openHour: 0, closeHour: 0 },
      staff: [{
        ...initial.staff[0], id: 'segment-worker', x: 100, y: 200,
        schedule, effectiveDuty: 'work', dutyPhase: 'available', task: null,
      }],
    };
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const result = withReducedQuantum(1, seen, () => ({
      single: runTick(state, { gameDt: 0, movementDt: 0 }),
      multi: runTick(state, { gameDt: 3600, movementDt: 0 }),
    }));
    const singleEntry = entriesFor(result.single.navigationPreflight, 'exit:real-grid-exit')
      .find(({ entry }) => entry.status === 'pending');
    const multiEntry = singleEntry && result.multi.navigationPreflight.entries.get(singleEntry.key);

    expect(result.multi.navigationPreflight.frame).toBe(1);
    expect(singleEntry).toBeDefined();
    expect(multiEntry).toMatchObject({ status: singleEntry.entry.status });
    expect([...multiEntry.cursor.costs]).toEqual([...singleEntry.entry.cursor.costs]);
    expect(seen.filter(call => queryKey(call) === singleEntry.key).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('does not advance a retained query while the tick is paused', () => {
    const first = runPreflightFrame(undefined,
      () => queryReachability('exit:a', line(), start, goal, 1));
    const paused = { ...createInitialState(), paused: true, navigationPreflight: first.runtime };
    expect(runTick(paused, { gameDt: 1, movementDt: 1 })).toBe(paused);
    expect(entryFor(paused.navigationPreflight, 'exit:a').status).toBe('pending');
  });
});
