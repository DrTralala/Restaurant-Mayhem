import { describe, expect, it, vi } from 'vitest';
import * as schedules from './staffSchedules';
import { advanceStaffWellbeing } from './staffWellbeing';
import wellbeingSource from './staffWellbeing.js?raw';
import { getStaffAmenityDefinition } from '../data/staffAmenities';
import { createInitialState } from '../state/initialState';
import { runTick } from './gameLoop';
import * as wellbeing from './staffWellbeing';

const work = () => Array.from({ length: 48 }, () => 'work');
const within = run => {
  expect(schedules.withStaffScheduleContext).toBeTypeOf('function');
  return schedules.withStaffScheduleContext(run);
};
const owned = slots => {
  expect(schedules.getOwnedStaffSchedule).toBeTypeOf('function');
  return schedules.getOwnedStaffSchedule(slots);
};
const outcome = run => {
  try { return { value: run() }; } catch (error) { return { error: [error.name, error.message] }; }
};

describe('tick-owned schedule snapshots', () => {
  it('validates and snapshots once per array identity without repeating descriptor probes', () => {
    const slots = work();
    const originalHas = Set.prototype.has;
    const has = vi.spyOn(Set.prototype, 'has').mockImplementation(function (value) {
      return originalHas.call(this, value);
    });
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    try {
      within(() => {
        const first = owned(slots);
        expect(first.validation).toEqual({ valid: true, reason: null });
        expect(first.slots).toEqual(slots);
        expect(first.slots).not.toBe(slots);
        expect(Object.isFrozen(first.slots)).toBe(true);
        for (let index = 0; index < 12; index += 1) {
          expect(owned(slots)).toBe(first);
          expect(schedules.validateStaffSchedule(slots)).toEqual({ valid: true, reason: null });
        }
      });
      expect(descriptors.mock.calls.filter(([value, key]) => value === slots && key === '0')).toHaveLength(1);
      expect(has.mock.calls.filter(([value]) => value === 'work')).toHaveLength(48);
    } finally { has.mockRestore(); descriptors.mockRestore(); }
  });

  it('keeps timestamps independent and observes new identities and edits between scopes', () => {
    const slots = work();
    slots[1] = 'rest';
    within(() => {
      const first = owned(slots);
      expect(schedules.getScheduledDuty(first.slots, 0)).toBe('work');
      expect(schedules.getScheduledDuty(first.slots, 1800)).toBe('rest');
      const other = [...slots];
      other[0] = 'rest';
      expect(owned(other)).not.toBe(first);
      expect(owned(other).slots[0]).toBe('rest');
    });
    slots[0] = 'rest';
    within(() => expect(owned(slots).slots[0]).toBe('rest'));
    expect(owned(slots)).toBeNull();
    expect(schedules.validateStaffSchedule(slots).valid).toBe(true);
    slots[0] = 'invalid';
    expect(schedules.validateStaffSchedule(slots)).toEqual({ valid: false, reason: 'invalid-mode' });
  });

  it('does not expose cached validation objects or publish frozen snapshots on workers', () => {
    const slots = work();
    const worker = { id: 'worker', role: 'waiter', morale: 80, ...schedules.createStaffDutyDefaults(), schedule: slots };
    const state = { staff: [worker], staffAmenities: [], restaurant: { gameTime: 0 } };
    within(() => {
      const first = schedules.validateStaffSchedule(slots);
      first.valid = false;
      expect(schedules.validateStaffSchedule(slots).valid).toBe(true);
      const result = advanceStaffWellbeing(state, 0, 2);
      expect(result.staff[0].schedule).toBe(slots);
      expect(result.staff[0]).not.toBe(worker);
      expect(Object.isFrozen(result.staff[0].schedule)).toBe(false);
    });
  });

  it('preserves invalid lengths, modes, cyclic PTO rules and sparse-array behaviour', () => {
    const shortPto = work(); shortPto[0] = 'pto';
    const wrappedPto = work();
    for (const index of [0, 1, 2, 3, 4, 5, 6, 41, 42, 43, 44, 45, 46, 47]) wrappedPto[index] = 'pto';
    const invalidMode = work(); invalidMode[10] = null;
    for (const slots of [undefined, null, [], work().slice(1), shortPto, wrappedPto, invalidMode, new Array(48)]) {
      const expected = outcome(() => schedules.validateStaffSchedule(slots));
      expect(within(() => outcome(() => schedules.validateStaffSchedule(slots)))).toEqual(expected);
    }
  });

  it.each(['index', 'some', 'reduce', 'iterator', 'early-invalid'])(
    'retains the original fallback reads for %s customisation', kind => {
      const run = scoped => {
        const reads = [];
        const slots = work();
        if (kind === 'index' || kind === 'early-invalid') {
          if (kind === 'early-invalid') slots[0] = 'invalid';
          Object.defineProperty(slots, '20', { get() { reads.push('index'); throw new Error('index read'); } });
        } else if (kind === 'iterator') {
          Object.defineProperty(slots, Symbol.iterator, { get() { reads.push('iterator'); throw new Error('iterator read'); } });
        } else {
          const original = Array.prototype[kind];
          Object.defineProperty(slots, kind, { get() { reads.push(kind); return original; } });
        }
        const execute = () => outcome(() => schedules.validateStaffSchedule(slots));
        const result = scoped ? within(execute) : execute();
        return { result, reads };
      };
      expect(run(true)).toEqual(run(false));
    });

  it('restores nested scopes, exceptions and rejected asynchronous ownership', () => {
    const slots = work();
    within(() => {
      const first = owned(slots);
      expect(() => within(() => {
        expect(owned(slots)).not.toBe(first);
        throw new Error('nested');
      })).toThrow('nested');
      expect(owned(slots)).toBe(first);
    });
    expect(() => within(() => { owned(slots); throw new Error('outer'); })).toThrow('outer');
    let invoked = false;
    expect(() => within(async () => { invoked = true; })).toThrow(/synchronous/i);
    expect(invoked).toBe(false);
    expect(() => within(() => { owned(slots); return Promise.resolve(); })).toThrow(/synchronous/i);
    expect(owned(slots)).toBeNull();
  });

  it('does not publish an incomplete snapshot during re-entrant inspection', () => {
    const slots = work();
    const original = Object.getOwnPropertyDescriptor;
    let nested;
    let entered = false;
    const descriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((object, key) => {
      if (object === slots && key === '0' && !entered) {
        entered = true;
        nested = schedules.validateStaffSchedule(slots);
      }
      return original(object, key);
    });
    try {
      within(() => {
        expect(owned(slots).validation.valid).toBe(true);
        expect(nested).toEqual({ valid: true, reason: null });
        expect(owned(slots).slots).toEqual(slots);
      });
    } finally { descriptor.mockRestore(); }
  });
});

it('retains the already-owned settled worker when availability needs no change', () => {
  const settled = [];
  const source = wellbeingSource.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
    .replace(/\bexport /g, '')
    .replace('let next = { ...state, staff };', 'capture(staff); let next = { ...state, staff };');
  const advance = new Function('createStaffDutyDefaults', 'getScheduledDuty', 'validateStaffSchedule',
    'getOwnedStaffSchedule', 'getStaffAmenityDefinition', 'capture', '"use strict";\n' + source + '\nreturn advanceStaffWellbeing;')(
    schedules.createStaffDutyDefaults, schedules.getScheduledDuty, schedules.validateStaffSchedule,
    schedules.getOwnedStaffSchedule, getStaffAmenityDefinition, staff => settled.push(...staff),
  );
  const worker = Object.freeze({ id: 'owned-worker', role: 'waiter', morale: 80, ...schedules.createStaffDutyDefaults() });
  const state = { staff: [worker], staffAmenities: [], restaurant: { gameTime: 0 } };
  const result = advance(state, 0, 0);
  expect(result.staff[0]).not.toBe(worker);
  expect(result.staff[0]).toBe(settled[0]);
  expect(result.staff[0]).toEqual(worker);
});

const simulationWithin = run => {
  expect(schedules.withSimulationStaffScheduleContext).toBeTypeOf('function');
  return schedules.withSimulationStaffScheduleContext(run);
};

function scheduleGuardCounts(slots, run) {
  const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptor');
  const prototypes = vi.spyOn(Object, 'getPrototypeOf');
  const own = vi.spyOn(Object, 'hasOwn');
  try {
    const value = run();
    return { value, descriptors: descriptors.mock.calls.filter(([object]) => object === slots || object === Array.prototype).length,
      prototypes: prototypes.mock.calls.filter(([object]) => object === slots).length,
      descriptorValueChecks: own.mock.calls.filter(([, key]) => key === 'value').length };
  } finally { descriptors.mockRestore(); prototypes.mockRestore(); own.mockRestore(); }
}

function ptoSchedule(...runs) {
  const slots = work();
  for (const [start, length] of runs) {
    for (let offset = 0; offset < length; offset += 1) slots[(start + offset) % 48] = 'pto';
  }
  return slots;
}

function scheduleState(schedule) {
  const initial = createInitialState();
  return { ...initial, restaurant: { ...initial.restaurant, gameTime: 0 },
    tables: [], chairs: [], doors: [], kitchenStations: [], serviceTables: [],
    cashierStations: [], washStations: [], staffAmenities: [],
    staff: [{ id: 'schedule-worker', role: 'waiter', morale: 80, x: 100, y: 100,
      task: null, ...schedules.createStaffDutyDefaults(), schedule }] };
}

describe('simulation-only plain schedule ownership', () => {
  it('skips descriptor and prototype guards while retaining the defensive public capture', () => {
    const slots = work();
    const plain = scheduleGuardCounts(slots, () => simulationWithin(() => schedules.getOwnedStaffSchedule(slots)));
    expect(plain.value.validation).toEqual({ valid: true, reason: null });
    expect(plain.descriptors).toBe(0);
    expect(plain.prototypes).toBe(0);
    expect(plain.descriptorValueChecks).toBe(0);
    const strict = scheduleGuardCounts(slots, () => within(() => schedules.getOwnedStaffSchedule(slots)));
    expect(strict.descriptors).toBe(55);
    expect(strict.prototypes).toBe(1);
    expect(strict.descriptorValueChecks).toBe(48);
    expect(owned(slots)).toBeNull();
  });

  it('validates modes once and keeps private immutable ownership without publishing it', () => {
    const slots = work();
    const has = vi.spyOn(Set.prototype, 'has');
    try {
      simulationWithin(() => {
        const first = owned(slots);
        expect(first.slots).toEqual(slots);
        expect(first.slots).not.toBe(slots);
        for (const value of [first, first.slots, first.validation]) expect(Object.isFrozen(value)).toBe(true);
        for (let index = 0; index < 12; index += 1) {
          expect(owned(slots)).toBe(first);
          const validation = schedules.validateStaffSchedule(slots);
          validation.valid = false;
          expect(schedules.validateStaffSchedule(slots)).toEqual({ valid: true, reason: null });
        }
      });
      expect(has.mock.calls.filter(([value]) => value === 'work')).toHaveLength(48);
    } finally { has.mockRestore(); }
    const wrapper = { schedule: slots };
    const input = scheduleState(wrapper);
    const result = simulationWithin(() => advanceStaffWellbeing(input, 0, 2));
    expect(result.staff[0]).not.toBe(input.staff[0]);
    expect(result.staff[0].schedule).toBe(wrapper);
    expect(result.staff[0].schedule.schedule).toBe(slots);
    expect(Object.isFrozen(slots)).toBe(false);
  });

  it('does not run separate some or reduce passes on the owned array', () => {
    const slots = work();
    const some = vi.spyOn(Array.prototype, 'some');
    const reduce = vi.spyOn(Array.prototype, 'reduce');
    let captured;
    let calls;
    try {
      captured = simulationWithin(() => schedules.getOwnedStaffSchedule(slots));
      calls = [some, reduce].map(spy => spy.mock.contexts.filter(value => value === slots || value === captured?.slots).length);
    } finally { some.mockRestore(); reduce.mockRestore(); }
    expect(captured?.validation).toEqual({ valid: true, reason: null });
    expect(calls).toEqual([0, 0]);
  });

  it.each([
    ['work', () => work(), null],
    ['rest', () => Array(48).fill('rest'), null],
    ['alternating work/rest', () => work().map((mode, index) => index % 2 ? 'rest' : mode), null],
    ['all PTO', () => Array(48).fill('pto'), null],
    ['14 leading PTO slots', () => ptoSchedule([0, 14]), null],
    ['13 leading PTO slots', () => ptoSchedule([0, 13]), 'pto-run-too-short'],
    ['14 wrapped PTO slots', () => ptoSchedule([41, 14]), null],
    ['13 wrapped PTO slots', () => ptoSchedule([42, 13]), 'pto-run-too-short'],
    ['two 14-slot runs', () => ptoSchedule([0, 14], [20, 14]), null],
    ['a separate 13-slot run', () => ptoSchedule([0, 14], [20, 13]), 'pto-run-too-short'],
    ['a wrapped run with a short interior run', () => ptoSchedule([41, 14], [20, 2]), 'pto-run-too-short'],
    ['47 cyclic PTO slots', () => ptoSchedule([3, 47]), null],
  ])('preserves the literal cyclic rule for %s', (_label, makeSlots, reason) => {
    const slots = makeSlots();
    const expected = { valid: reason === null, reason };
    expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
    simulationWithin(() => {
      expect(owned(slots).validation).toEqual(expected);
      expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
    });
  });

  it('matches the standalone cyclic oracle at every start slot for 13, 14 and 47-slot runs', () => {
    for (const [length, valid] of [[13, false], [14, true], [47, true]]) {
      for (let start = 0; start < 48; start += 1) {
        const slots = ptoSchedule([start, length]);
        const expected = { valid, reason: valid ? null : 'pto-run-too-short' };
        expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
        expect(simulationWithin(() => owned(slots).validation)).toEqual(expected);
      }
    }
  });

  it.each([undefined, null, 'holiday', 1, false, {}])(
    'declines an invalid mode %j even after a short PTO run', mode => {
      const slots = ptoSchedule([0, 13]);
      slots[47] = mode;
      const expected = { valid: false, reason: 'invalid-mode' };
      expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
      simulationWithin(() => {
        expect(owned(slots)).toBeNull();
        expect(owned(slots)).toBeNull();
        expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
      });
    },
  );

  it('declines sparse and malformed arrays without changing validation or normalisation', () => {
    const sparseRest = Array(48).fill('rest'); delete sparseRest[20];
    const undefinedRest = Array(48).fill('rest'); undefinedRest[20] = undefined;
    const cases = [
      [undefined, 'invalid-length', 'work'], [null, 'invalid-length', 'work'],
      [{}, 'invalid-length', 'work'], [[], 'invalid-length', 'work'],
      [work().slice(1), 'invalid-length', 'work'], [[...work(), 'work'], 'invalid-length', 'work'],
      [new Array(48), null, 'work'], [sparseRest, null, 'rest'], [undefinedRest, 'invalid-mode', 'work'],
    ];
    for (const [slots, reason, duty] of cases) {
      const expected = { valid: reason === null, reason };
      expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
      simulationWithin(() => {
        expect(owned(slots)).toBeNull();
        expect(schedules.validateStaffSchedule(slots)).toEqual(expected);
      });
      const input = scheduleState(slots);
      const before = structuredClone(input);
      const strict = within(() => advanceStaffWellbeing(input, 0, 0));
      const plain = simulationWithin(() => advanceStaffWellbeing(input, 0, 0));
      expect(plain).toStrictEqual(strict);
      expect(plain.staff[0].effectiveDuty).toBe(duty);
      expect(input).toStrictEqual(before);
    }
  });

  it.each(['public', 'simulation'])('restores the map and policy of a nested %s owner', kind => {
    const outer = kind === 'public' ? within : simulationWithin;
    const inner = kind === 'public' ? simulationWithin : within;
    const slots = work();
    outer(() => {
      const first = owned(slots);
      expect(() => inner(() => {
        expect(owned(slots)).not.toBe(first);
        throw new Error('nested schedule');
      })).toThrow('nested schedule');
      expect(owned(slots)).toBe(first);
      const invalidSlots = work(); invalidSlots[0] = 'invalid';
      const restored = owned(invalidSlots);
      if (kind === 'public') expect(restored.validation).toEqual({ valid: false, reason: 'invalid-mode' });
      else expect(restored).toBeNull();
    });
    expect(owned(slots)).toBeNull();
  });

  it.each(['throw', 'thenable', 'then-getter'])('cleans up simulation ownership after %s', kind => {
    const slots = work();
    expect(() => simulationWithin(() => {
      owned(slots);
      if (kind === 'throw') throw new Error('schedule failure');
      if (kind === 'then-getter') return { get then() { throw new Error('schedule failure'); } };
      return { then() {} };
    })).toThrow(kind === 'thenable' ? /synchronous/i : 'schedule failure');
    expect(owned(slots)).toBeNull();
    const strict = scheduleGuardCounts(slots, () => within(() => schedules.getOwnedStaffSchedule(slots)));
    expect(strict.descriptors).toBe(55);
  });

  it('rejects async ownership before invoking the callback and preserves an enclosing owner', () => {
    const slots = work();
    within(() => {
      const first = owned(slots);
      let invoked = false;
      expect(() => simulationWithin(async () => { invoked = true; })).toThrow(/synchronous/i);
      expect(invoked).toBe(false);
      expect(owned(slots)).toBe(first);
    });
    expect(owned(slots)).toBeNull();
  });

  it.each(['public', 'simulation'])('bounds %s ownership to 256 arrays while retaining earlier owners', kind => {
    const run = kind === 'public' ? within : simulationWithin;
    const arrays = Array.from({ length: 257 }, work);
    run(() => {
      const first = owned(arrays[0]);
      for (let index = 1; index < 256; index += 1) expect(owned(arrays[index])).not.toBeNull();
      expect(owned(arrays[256])).toBeNull();
      expect(schedules.validateStaffSchedule(arrays[256])).toEqual({ valid: true, reason: null });
      expect(owned(arrays[0])).toBe(first);
    });
    expect(run(() => owned(arrays[256]))).not.toBeNull();
  });

  it('recaptures same-identity edits and replacements between simulation scopes', () => {
    const slots = work(); slots[1] = 'rest';
    const first = simulationWithin(() => {
      const snapshot = owned(slots);
      expect(schedules.getScheduledDuty(snapshot.slots, 0)).toBe('work');
      expect(schedules.getScheduledDuty(snapshot.slots, 1800)).toBe('rest');
      const replacement = [...slots]; replacement[0] = 'rest';
      expect(owned(replacement).slots[0]).toBe('rest');
      return snapshot;
    });
    slots[0] = 'rest';
    const second = simulationWithin(() => owned(slots));
    expect(second).not.toBe(first);
    expect(second.slots[0]).toBe('rest');
    expect(first.slots[0]).toBe('work');
    expect(owned(slots)).toBeNull();
  });

  it('keeps public Proxy fallback reads strict after a simulation owner', () => {
    simulationWithin(() => owned(work()));
    const trial = scoped => {
      const reads = [];
      const slots = new Proxy(work(), {
        getPrototypeOf() { return null; },
        get(target, key, receiver) {
          if (key === '0') { reads.push('slot'); throw new Error('proxy slot read'); }
          return Reflect.get(target, key, receiver);
        },
      });
      const run = () => outcome(() => schedules.validateStaffSchedule(slots));
      return { result: scoped ? within(run) : run(), reads };
    };
    const expected = { result: { error: ['Error', 'proxy slot read'] }, reads: ['slot'] };
    expect(trial(false)).toEqual(expected);
    expect(trial(true)).toEqual(expected);
  });

  it('uses plain ownership through runTick segments and recaptures inter-tick edits', () => {
    const slots = work(); slots[1] = 'rest';
    const input = scheduleState(slots);
    const original = schedules.getOwnedStaffSchedule;
    const seen = [];
    const getOwned = vi.spyOn(schedules, 'getOwnedStaffSchedule').mockImplementation(value => {
      const captured = original(value);
      if (value === slots && captured) seen.push(captured);
      return captured;
    });
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    const advance = vi.spyOn(wellbeing, 'advanceStaffWellbeing');
    try {
      const first = runTick(input, { gameDt: 3600, movementDt: 0 });
      expect(advance.mock.calls.map(args => args.slice(1))).toContainEqual([0, 1800]);
      expect(advance.mock.calls.map(args => args.slice(1))).toContainEqual([1800, 3600]);
      expect(seen.length).toBeGreaterThan(1);
      expect(new Set(seen).size).toBe(1);
      const firstOwned = seen[0];
      seen.length = 0;
      expect(first.staff[0].schedule).toBe(slots);
      expect(first.staff[0].effectiveDuty).toBe('work');
      slots[2] = 'rest';
      const second = runTick(first, { gameDt: 0, movementDt: 0 });
      expect(second.staff[0].schedule).toBe(slots);
      expect(second.staff[0].effectiveDuty).toBe('rest');
      expect(new Set(seen).size).toBe(1);
      expect(seen[0]).not.toBe(firstOwned);
      expect(firstOwned.slots[2]).toBe('work');
      expect(owned(slots)).toBeNull();
      expect(descriptors.mock.calls.filter(([value, key]) => value === slots && key === '0')).toHaveLength(0);
    } finally { getOwned.mockRestore(); descriptors.mockRestore(); advance.mockRestore(); }
  });
});
