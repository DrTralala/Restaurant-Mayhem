import { describe, expect, it, vi } from 'vitest';
import { createEmptyAmenitySlots, getAmenityGeometry } from '../data/staffAmenities';
import { advanceCharacterMovementBatch } from './movement';
import * as navigationWorkspaceModule from './movement/navigationWorkspace';
import * as staffScheduleModule from './staffSchedules';
import { createStaffDutyDefaults } from './staffSchedules';
import wellbeingSource from './staffWellbeing.js?raw';
import * as amenityModule from '../data/staffAmenities';
import * as activityModule from './staffActivity';
import * as statusModule from './movement/status';
import * as goalModule from './movement/navigationGoal';
import * as gridModule from './navigation/grid';
import * as routerModule from './navigation/router';
import * as preflightModule from './navigation/preflight';
import * as occupancyModule from './navigation/occupancy';
import * as queueModule from './customerQueue';
import * as exitModule from './movement/staffAmenityExit';
import * as lifecycleModule from './staffTaskLifecycle';
import {
  advanceStaffWellbeing,
  getNextStaffWellbeingBoundary,
  getStaffWellbeingMovementEntries,
  releaseAmenitySlot,
  reserveAmenitySlot,
  resolveStaffWellbeingAfterMovement,
  selectStaffWellbeingExit,
} from './staffWellbeing';

const allWork = () => Array.from({ length: 48 }, () => 'work');

function worker(overrides = {}) {
  return {
    id: 'staff-1', role: 'waiter', x: 610, y: 530, morale: 50, salary: 150,
    ...createStaffDutyDefaults(),
    ...overrides,
  };
}

function state({ staff = [worker()], staffAmenities = [], ...overrides } = {}) {
  return {
    restaurant: { expansionLevel: 1, gameTime: 0 },
    staff,
    staffAmenities,
    tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    cashierStations: [], washStations: [], customers: [], queueSlots: [],
    doors: [],
    ...overrides,
  };
}

function couch(id = 'couch-1', x = 600, y = 500) {
  return { id, type: 'couch', x, y, rotation: 0, slots: createEmptyAmenitySlots('couch') };
}

function bed(id = 'bed-1', x = 600, y = 500) {
  return { id, type: 'bed', x, y, rotation: 0, slots: createEmptyAmenitySlots('bed') };
}

function arcade(id = 'arcade-1', x = 600, y = 500) {
  return { id, type: 'arcade', x, y, rotation: 0, slots: createEmptyAmenitySlots('arcade') };
}

function restWorker(overrides = {}) {
  const schedule = allWork();
  schedule[0] = 'rest';
  return worker({ schedule, effectiveDuty: 'rest', ...overrides });
}

function ptoWorker(overrides = {}) {
  return worker({ schedule: Array.from({ length: 48 }, () => 'pto'), effectiveDuty: 'pto', ...overrides });
}

function reserveAndArrive(currentState, amenity, staffId = 'staff-1', now = 0) {
  const reserved = reserveAmenitySlot(
    { ...currentState, staffAmenities: [amenity] }, staffId, amenity.id, 0, now,
  );
  const arrived = resolveStaffWellbeingAfterMovement(
    reserved,
    new Map([[staffId, { plan: 'arrived', motion: 'holding' }]]),
    now,
  );
  return arrived;
}

// Frozen pre-optimisation functions. The reference uses real unchanged helpers
// and dependencies, but cannot silently inherit a new shortcut in these bodies.
const originalZeroDurationFunctions = String.raw`
function settleWorker(state, rawWorker, fromTime, toTime, getFingerprint) {
  let worker = normaliseWorkerForController(rawWorker);
  const useTransitionAt = occupiedUseTransitionTime(state, worker, fromTime, toTime);
  const recoveryTo = useTransitionAt == null ? toTime : Math.min(toTime, useTransitionAt);
  worker = drainMorale(worker, state, fromTime, toTime);
  worker = applyOccupiedRecovery(worker, state, fromTime, recoveryTo);
  const decisionTime = useTransitionAt == null ? toTime : useTransitionAt;
  const desiredDuty = scheduledDuty(worker, decisionTime);
  const requestedAt = firstDutyBoundary(worker, fromTime, decisionTime);
  worker = beginDutyTransition(state, worker, desiredDuty, requestedAt, decisionTime);
  if (worker.dutyPhase === 'blocked_handoff' && progressSinceHandoff(state, worker)) {
    const snapshot = taskProgressSnapshot(state, worker);
    worker = {
      ...worker, dutyPhase: 'finishing_task',
      dutyHandoffProgressAt: snapshot.lastProgressAt,
      dutyHandoffAccumulatedWork: snapshot.accumulatedWork,
      dutyHandoffLastProgressAt: finite(snapshot.lastProgressAt)
        ? snapshot.lastProgressAt : worker.dutyHandoffLastProgressAt,
      dutyBlockReason: null,
    };
  }
  const current = currentAmenity(state, worker);
  if (current) worker = transitionActiveUse(state, worker, desiredDuty, decisionTime, getFingerprint);
  return worker;
}
function advanceStaffWellbeing(state, fromTime, toTime) {
  if (!state || !Array.isArray(state.staff) || !finite(fromTime) || !finite(toTime)
    || toTime < fromTime) return state;
  let initialFingerprint;
  let initialFingerprintReady = false;
  const getInitialFingerprint = () => {
    if (!initialFingerprintReady) {
      initialFingerprint = wellbeingFingerprint(state);
      initialFingerprintReady = true;
    }
    return initialFingerprint;
  };
  let staff = state.staff.map(worker => settleWorker(
    state, worker, fromTime, toTime, getInitialFingerprint,
  ));
  let next = { ...state, staff };
  for (let index = 0; index < state.staff.length; index += 1) {
    const previousUse = state.staff[index]?.amenityUse;
    if (previousUse?.phase !== 'reserved' || next.staff[index]?.amenityUse) continue;
    next = clearUseState(next, state.staff[index].id, {
      phase: next.staff[index].effectiveDuty === 'work' ? 'available' : 'seeking_amenity',
    });
  }
  next = releaseDutyHandoffs(next, state.staff, toTime);
  const ordered = orderForAmenityDispatch(staff, toTime);
  for (const { index } of ordered) {
    const current = next.staff[index];
    if (current.amenityUse) continue;
    if (current.effectiveDuty === 'work') {
      const dutyPhase = HANDOFF_PHASES.has(current.dutyPhase) ? current.dutyPhase : 'available';
      if (current.dutyPhase !== dutyPhase) next.staff[index] = { ...current, dutyPhase };
      continue;
    }
    if (current.dutyPhase === 'exiting' || current.task || workerHasCarriedLoad(current)) continue;
    let fingerprint;
    let fingerprintReady = false;
    const getFingerprint = () => {
      if (!fingerprintReady) {
        fingerprint = wellbeingFingerprint(next);
        fingerprintReady = true;
      }
      return fingerprint;
    };
    const dispatched = dispatchAmenity(next, current, toTime, getFingerprint);
    next = dispatched.state;
    next.staff[index] = dispatched.worker;
  }
  return next;
}
`;

function zeroDurationImplementation(original = false) {
  const dependencies = { ...amenityModule, ...staffScheduleModule, ...activityModule,
    ...statusModule, ...goalModule, ...navigationWorkspaceModule, ...gridModule, ...routerModule,
    ...preflightModule, ...occupancyModule, ...queueModule, ...exitModule, ...lifecycleModule };
  const names = [...wellbeingSource.matchAll(/^import\s*\{([^}]+)\}\s*from/gm)]
    .flatMap(([, list]) => list.split(',').map(name => name.trim()).filter(Boolean));
  let source = wellbeingSource.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
    .replace(/\bexport /g, '');
  if (original) source += originalZeroDurationFunctions;
  return new Function(...names, '"use strict";\n' + source
    + '\nreturn { advanceStaffWellbeing, resolveStaffWellbeingAfterMovement };')(
    ...names.map(name => dependencies[name]),
  );
}

describe('zero-duration work settlement', () => {
  it('keeps fresh owned output and all fields even when zero-duration work is value-idempotent', () => {
    const { advanceStaffWellbeing: advance } = zeroDurationImplementation();
    const input = state({ staff: [Object.freeze(worker({ unpaid: true, custom: undefined }))] });
    const result = staffScheduleModule.withStaffScheduleContext(() => advance(input, 1800, 1800));
    expect(result).toStrictEqual(input);
    expect(result).not.toBe(input);
    expect(result.staff).not.toBe(input.staff);
    expect(result.staff[0]).not.toBe(input.staff[0]);
    expect(result.staff[0].schedule).toBe(input.staff[0].schedule);
    expect(result.staffAmenities).toBe(input.staffAmenities);
  });

  it('still changes duty at a schedule boundary and repairs nonavailable work phases', () => {
    const schedule = allWork();
    schedule[1] = 'rest';
    const input = state({ staff: [worker({ schedule,
      task: { type: 'clean_floor', dirtId: 'missing', startedAt: 0, accumulatedWork: 1 },
    }), worker({ id: 'other', dutyPhase: 'active' })] });
    const result = advanceStaffWellbeing(input, 1800, 1800);
    expect(result.staff[0]).toMatchObject({ effectiveDuty: 'rest', dutyPhase: 'finishing_task',
      dutyTransitionRequestedAt: 1800 });
    expect(result.staff[1]).toMatchObject({ effectiveDuty: 'work', dutyPhase: 'available' });
  });

  it('honours protected PTO without an amenity and expires handoffs at zero duration', () => {
    const input = state({ staff: [worker({ effectiveDuty: 'rest',
      ptoSession: { sleepStartedAt: 0, minimumEndAt: 25200, startingMorale: 20 },
    }), restWorker({ id: 'handoff', dutyPhase: 'finishing_task',
      dutyTransitionRequestedAt: 0, dutyHandoffLastProgressAt: 0,
      dutyHandoffAccumulatedWork: 1,
      task: { type: 'clean_floor', dirtId: 'missing', startedAt: 0, accumulatedWork: 1 },
    })] });
    const result = advanceStaffWellbeing(input, 61, 61);
    expect(result.staff[0].effectiveDuty).toBe('pto');
    expect(result.staff[0].ptoSession).toBe(input.staff[0].ptoSession);
    expect(result.staff[1]).toMatchObject({ effectiveDuty: 'rest', dutyPhase: 'blocked_handoff',
      dutyBlockReason: 'handoff-timeout' });
  });

  it('matches all original output fields across duties, schedules, phases, sessions and normalisation', () => {
    const baseline = zeroDurationImplementation(true);
    const candidate = zeroDurationImplementation();
    const schedules = [allWork(), Array(48).fill('rest'), Array(48).fill('pto'),
      [...Array(1).fill('work'), ...Array(47).fill('rest')], [], new Array(48), undefined];
    const phases = ['available', 'finishing_task', 'blocked_handoff', 'active', 'exiting',
      'waiting_for_amenity', 'travelling', undefined, 'invalid'];
    let cases = 0;
    for (const schedule of schedules) for (const dutyPhase of phases) {
      for (const effectiveDuty of ['work', 'rest', 'pto', undefined, 'invalid']) {
        for (const now of [0, 1800, 25200]) {
          const input = state({ staff: [worker({ schedule, effectiveDuty, dutyPhase, unpaid: true,
            ptoSession: cases % 3 ? null : { sleepStartedAt: 0, minimumEndAt: 25200, startingMorale: 31 },
            task: cases % 4 ? null : { type: 'clean_floor', dirtId: 'missing', startedAt: 0, accumulatedWork: 1 },
            carryingServiceItemIds: cases % 5 ? [] : ['carried'],
            dutyTransitionRequestedAt: 0, dutyHandoffProgressAt: 0,
            unknownField: { retained: true }, absentValue: undefined,
          })] });
          const before = structuredClone(input);
          const run = implementation => staffScheduleModule.withStaffScheduleContext(() =>
            implementation.advanceStaffWellbeing(structuredClone(input), now, now));
          expect(run(candidate), `case ${cases}`).toStrictEqual(run(baseline));
          expect(input).toStrictEqual(before);
          cases += 1;
        }
      }
    }
    expect(cases).toBe(945);
  });

  it('matches occupied recovery, protected PTO, reservation cancellation and freed-slot dispatch', () => {
    const baseline = zeroDurationImplementation(true);
    const candidate = zeroDurationImplementation();
    for (const makeAmenity of [couch, bed, arcade]) {
      const amenity = makeAmenity();
      const geometry = getAmenityGeometry(amenity);
      for (const phase of ['reserved', 'occupied']) for (const now of [0, 899, 900, 1800, 25200, 25201]) {
        const input = state({ staffAmenities: [{ ...amenity, slots: amenity.slots.map((slot, index) =>
          index ? slot : { ...slot, reservedBy: phase === 'reserved' ? 'staff-1' : null,
            occupiedBy: phase === 'occupied' ? 'staff-1' : null }) }], staff: [worker({
          x: geometry.slotAnchors[0].x, y: geometry.slotAnchors[0].y,
          effectiveDuty: amenity.type === 'bed' ? 'pto' : 'rest', dutyPhase: 'active',
          amenityUse: { amenityId: amenity.id, slotIndex: 0, phase,
            activityStartedAt: 0, activityEndsAt: 900, lastRecoveryAt: 0 },
          ptoSession: amenity.type === 'bed'
            ? { sleepStartedAt: 0, minimumEndAt: 25200, startingMorale: 20 } : null,
        }), restWorker({ id: 'waiting', dutyPhase: 'waiting_for_amenity', amenityWaitingSince: -10 })] });
        for (const method of ['advanceStaffWellbeing', 'resolveStaffWellbeingAfterMovement']) {
          const run = implementation => staffScheduleModule.withStaffScheduleContext(() => method === 'advanceStaffWellbeing'
            ? implementation[method](structuredClone(input), now, now)
            : implementation[method](structuredClone(input), new Map([['staff-1', { plan: 'arrived' }]]), now));
          expect(run(candidate), `${amenity.type}/${phase}/${now}/${method}`).toStrictEqual(run(baseline));
        }
      }
    }
  });

  it.each(['schedule-getter', 'task-getter', 'id-coercion', 'custom-map', 'nonzero', 'standalone'])(
    'preserves original values, errors and observable reads for %s', kind => {
      const run = original => {
        const implementation = zeroDurationImplementation(original);
        const reads = [];
        const member = worker();
        const input = state({ staff: [member, worker({ id: 'staff-2' })] });
        if (kind === 'schedule-getter') {
          const slots = allWork();
          Object.defineProperty(member, 'schedule', { enumerable: true, get() { reads.push('schedule'); return slots; } });
        } else if (kind === 'task-getter') {
          member.task = { type: 'clean_floor', get startedAt() { reads.push('startedAt'); return 0; } };
        } else if (kind === 'id-coercion') {
          member.id = { toString() { reads.push('id'); return 'staff-1'; } };
        } else if (kind === 'custom-map') {
          input.staff.map = function (callback) { reads.push('map'); return Array.prototype.map.call(this, callback); };
        }
        const execute = () => implementation.advanceStaffWellbeing(input, 0, kind === 'nonzero' ? 2 : 0);
        let result;
        try { result = kind === 'standalone' ? execute() : staffScheduleModule.withStaffScheduleContext(execute); }
        catch (error) { return { error: [error.name, error.message], reads }; }
        // Serialisation omits intentionally different closure identities; every
        // ordinary output field is compared separately in the matrix above.
        return { output: JSON.stringify(result), reads, freshState: result !== input,
          freshStaff: result.staff !== input.staff, freshWorker: result.staff[0] !== member,
          scheduleIdentity: result.staff[0].schedule === member.schedule };
      };
      expect(run(false)).toEqual(run(true));
    },
  );
});

describe('staff wellbeing controller', () => {
  it.each([
    ['an orphan lease', {
      queue: [],
      queueSlots: [{ memberId: 'orphan', partyId: 'ghost', x: 610, y: 490, slot: 0 }],
    }],
    ['an ambiguous lease', {
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [
        { memberId: 'queued', partyId: 'party', x: 610, y: 490, slot: 0 },
        { memberId: 'queued', partyId: 'party', x: 650, y: 490, slot: 1 },
      ],
    }],
    ['a foreign-party lease', {
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'other-party', x: 610, y: 490, slot: 0 }],
    }],
    ['a display-overflow member', {
      queue: [{ partyId: 'overflow-party', members: [{ id: 'overflow', partyId: 'overflow-party', state: 'queued' }] }],
      queueSlots: [],
    }],
  ])('does not let %s block a legal amenity exit', (_label, overrides) => {
    const amenity = couch();
    const geometry = getAmenityGeometry(amenity);
    const current = state({
      staff: [worker({
        x: geometry.slotAnchors[0].x,
        y: geometry.slotAnchors[0].y,
        dutyPhase: 'active',
        amenityUse: { amenityId: amenity.id, slotIndex: 0, phase: 'occupied' },
      })],
      staffAmenities: [{ ...amenity, slots: [{ index: 0, reservedBy: null, occupiedBy: 'staff-1' }, { index: 1, reservedBy: null, occupiedBy: null }] }],
      ...overrides,
    });

    expect(selectStaffWellbeingExit(current, 'staff-1')).toEqual(geometry.exitCandidates[0]);
  });

  it('keeps a legitimate leased queue member and actual departing customer as exit blockers', () => {
    const amenity = couch();
    const geometry = getAmenityGeometry(amenity);
    const base = {
      staff: [worker({
        x: geometry.slotAnchors[0].x,
        y: geometry.slotAnchors[0].y,
        dutyPhase: 'active',
        amenityUse: { amenityId: amenity.id, slotIndex: 0, phase: 'occupied' },
      })],
      staffAmenities: [{ ...amenity, slots: [{ index: 0, reservedBy: null, occupiedBy: 'staff-1' }, { index: 1, reservedBy: null, occupiedBy: null }] }],
    };
    const leased = state({
      ...base,
      queue: [{ partyId: 'party', members: [{ id: 'queued', partyId: 'party', state: 'queued' }] }],
      queueSlots: [{ memberId: 'queued', partyId: 'party', x: geometry.exitCandidates[0].x, y: geometry.exitCandidates[0].y, slot: 0 }],
    });
    const departing = state({
      ...base,
      customers: [{ id: 'departing', partyId: 'party', state: 'leaving', x: geometry.exitCandidates[0].x, y: geometry.exitCandidates[0].y }],
      queueSlots: [{ memberId: 'departing', partyId: 'party', x: geometry.exitCandidates[0].x, y: geometry.exitCandidates[0].y, slot: 0 }],
    });

    expect(selectStaffWellbeingExit(leased, 'staff-1')).toEqual(geometry.exitCandidates[1]);
    expect(selectStaffWellbeingExit(departing, 'staff-1')).toEqual(geometry.exitCandidates[1]);
  });

  it('selects the earliest real cyclic duty boundary for game-loop settlement', () => {
    const first = allWork();
    first[1] = 'rest';
    const second = allWork();
    second[2] = 'rest';
    const result = getNextStaffWellbeingBoundary(state({
      staff: [worker({ id: 'b', schedule: second }), worker({ id: 'a', schedule: first })],
    }), 1, 4_000);

    expect(result).toBe(1_800);
    expect(getNextStaffWellbeingBoundary(state({ staff: [worker()] }), 0, 86_400)).toBeNull();
  });

  it('exposes rest, minimum-sleep, and waking-buff boundaries to the game loop', () => {
    const rest = worker({
      amenityUse: {
        amenityId: 'couch-1', slotIndex: 0, phase: 'occupied',
        activityStartedAt: 0, activityEndsAt: 100, lastRecoveryAt: 0,
      },
    });
    expect(getNextStaffWellbeingBoundary(state({ staff: [rest] }), 0, 200)).toBe(100);

    const sleep = worker({
      ptoSession: { sleepStartedAt: 0, minimumEndAt: 200, startingMorale: 50 },
    });
    expect(getNextStaffWellbeingBoundary(state({ staff: [sleep] }), 0, 300)).toBe(200);

    const buff = worker({ wellRestedUntil: 300 });
    expect(getNextStaffWellbeingBoundary(state({ staff: [buff] }), 0, 400)).toBe(300);
  });

  it('keeps missing-schedule workers compatible with the all-work default', () => {
    const saved = worker();
    delete saved.schedule;
    delete saved.effectiveDuty;
    delete saved.dutyPhase;

    const result = advanceStaffWellbeing(state({ staff: [saved] }), 0, 1);

    expect(result.staff[0]).toMatchObject({ effectiveDuty: 'work', dutyPhase: 'available' });
    expect(result.staff[0].morale).toBe(50);
  });

  it('does not allocate a discarded default schedule for a complete worker', () => {
    const current = state({ staff: [worker()] });
    const createDefaults = vi.spyOn(staffScheduleModule, 'createStaffDutyDefaults');

    try {
      const result = advanceStaffWellbeing(current, 0, 1);

      expect(result.staff[0]).toEqual(current.staff[0]);
      expect(Object.keys(result.staff[0])).toEqual([
        'schedule', 'effectiveDuty', 'dutyPhase', 'dutyTransitionRequestedAt',
        'amenityUse', 'ptoSession', 'wellRestedUntil', 'amenityWaitingSince',
        'lastRestActivityType', 'id', 'role', 'x', 'y', 'morale', 'salary',
      ]);
      expect(createDefaults).not.toHaveBeenCalled();
    } finally {
      createDefaults.mockRestore();
    }
  });

  it('builds a wellbeing fingerprint only when a transition or retry needs it', () => {
    const createWorkspace = vi.spyOn(navigationWorkspaceModule, 'createNavigationWorkspace');

    try {
      advanceStaffWellbeing(state({ staff: [worker()] }), 0, 1);
      expect(createWorkspace).not.toHaveBeenCalled();

      createWorkspace.mockClear();
      const waiting = advanceStaffWellbeing(state({ staff: [restWorker()] }), 0, 1);
      expect(waiting.staff[0].amenityRetryFingerprint).toEqual(expect.any(String));
      expect(createWorkspace).toHaveBeenCalledTimes(1);
    } finally {
      createWorkspace.mockRestore();
    }
  });

  it('reserves only a reachable slot and emits a separate travelling movement entry', () => {
    const amenity = couch();
    const current = state({ staff: [restWorker()], staffAmenities: [amenity] });
    const reserved = reserveAmenitySlot(current, 'staff-1', amenity.id, 0, 10);

    expect(reserved.staffAmenities[0].slots[0]).toMatchObject({ reservedBy: 'staff-1', occupiedBy: null });
    expect(reserved.staff[0]).toMatchObject({
      dutyPhase: 'travelling',
      amenityUse: {
        amenityId: amenity.id, slotIndex: 0, phase: 'reserved',
        activityStartedAt: null, activityEndsAt: null, lastRecoveryAt: null,
      },
      navigationGoal: { x: 610, y: 530 },
    });
    expect(getStaffWellbeingMovementEntries(reserved)).toEqual([
      expect.objectContaining({ character: reserved.staff[0], speed: expect.any(Number), target: { x: 610, y: 530 } }),
    ]);
  });

  it('starts a couch session only after the first actual arrival and establishes physical residency', () => {
    const amenity = couch();
    const current = state({ staff: [restWorker()], staffAmenities: [amenity] });
    const reserved = reserveAmenitySlot(current, 'staff-1', amenity.id, 0, 10);
    const notThere = resolveStaffWellbeingAfterMovement(
      { ...reserved, staff: [{ ...reserved.staff[0], x: 600, y: 530 }] },
      new Map([['staff-1', { plan: 'arrived', motion: 'holding' }]]),
      20,
    );
    expect(notThere.staff[0].amenityUse.phase).toBe('reserved');
    expect(notThere.staffAmenities[0].slots[0].occupiedBy).toBeNull();

    const arrived = resolveStaffWellbeingAfterMovement(
      { ...reserved, staff: [{ ...reserved.staff[0], x: 610, y: 530 }] },
      new Map([['staff-1', { plan: 'arrived', motion: 'holding' }]]),
      20,
    );
    expect(arrived.staff[0]).toMatchObject({
      x: 610, y: 510,
      dutyPhase: 'active',
      amenityUse: {
        phase: 'occupied', activityStartedAt: 20, activityEndsAt: 920, lastRecoveryAt: 20,
      },
      movementResidency: { kind: 'staff_amenity', amenityId: amenity.id, slotIndex: 0 },
    });
    expect(arrived.staffAmenities[0].slots[0]).toMatchObject({ reservedBy: null, occupiedBy: 'staff-1' });
    expect(arrived.staff[0].navigationGoal).toBeUndefined();
  });

  it('settles partial rest exactly once and never rewards the departure interval', () => {
    const started = reserveAndArrive(state({ staff: [restWorker()], staffAmenities: [couch()] }), couch());
    const partial = advanceStaffWellbeing(started, 0, 500);
    expect(partial.staff[0].morale).toBeCloseTo(50 + (500 * 6) / 3600);
    expect(partial.staff[0].amenityUse.lastRecoveryAt).toBe(500);

    const repeated = advanceStaffWellbeing(partial, 500, 500);
    expect(repeated.staff[0].morale).toBe(partial.staff[0].morale);

    const completed = advanceStaffWellbeing(repeated, 500, 920);
    expect(completed.staff[0].morale).toBeCloseTo(50 + (900 * 6) / 3600);
    expect(completed.staff[0].dutyPhase).toBe('exiting');
    expect(completed.staffAmenities[0].slots[0].occupiedBy).toBe('staff-1');
  });

  it('stops a rest session at a cyclic schedule boundary before the next interval', () => {
    const amenity = couch();
    const schedule = allWork();
    schedule[0] = 'rest';
    schedule[1] = 'work';
    const started = reserveAndArrive(state({
      staff: [restWorker({ schedule, x: 610, y: 530 })], staffAmenities: [amenity],
    }), amenity, 'staff-1', 1_700);
    const crossed = advanceStaffWellbeing(started, 1_700, 2_000);

    expect(crossed.staff[0].morale).toBeCloseTo(50 + (100 * 6) / 3600);
    expect(crossed.staff[0].dutyPhase).toBe('exiting');
    expect(crossed.staff[0].dutyTransitionRequestedAt).toBe(1_800);
  });

  it('does not complete an occupied session or release its slot while the legal exit is blocked', () => {
    const amenity = couch();
    const started = reserveAndArrive(state({ staff: [restWorker()], staffAmenities: [amenity] }), amenity);
    const blocked = advanceStaffWellbeing({
      ...started,
      tables: [
        { id: 'exit-top', x: 600, y: 460 },
        { id: 'exit-left', x: 560, y: 500 },
        { id: 'exit-right', x: 640, y: 500 },
        { id: 'exit-bottom', x: 600, y: 520 },
      ],
    }, 0, 920);

    expect(blocked.staff[0].dutyPhase).toBe('exiting');
    expect(blocked.staff[0].navigationGoal).toBeUndefined();
    expect(blocked.staffAmenities[0].slots[0].occupiedBy).toBe('staff-1');
    expect(releaseAmenitySlot(blocked, 'staff-1', 920)).toBe(blocked);
  });

  it('forces firing release without granting a rest reward', () => {
    const amenity = couch();
    const started = reserveAndArrive(state({ staff: [restWorker({ morale: 42 })], staffAmenities: [amenity] }), amenity);
    const fired = releaseAmenitySlot(started, 'staff-1', 100, { reason: 'fired', force: true });

    expect(fired.staff[0]).toMatchObject({ morale: 42, amenityUse: null });
    expect(fired.staff[0]).not.toHaveProperty('movementResidency');
    expect(fired.staffAmenities[0].slots[0]).toEqual({ index: 0, reservedBy: null, occupiedBy: null });
  });

  it('starts protected PTO sleep at actual bed arrival and ignores an early work boundary', () => {
    const amenity = bed();
    const started = reserveAndArrive(state({
      staff: [ptoWorker({ x: 590, y: 520 })], staffAmenities: [amenity],
    }), amenity, 'staff-1', 100);
    const beforeMinimum = advanceStaffWellbeing(started, 100, 1_000);

    expect(beforeMinimum.staff[0]).toMatchObject({
      effectiveDuty: 'pto', dutyPhase: 'active',
      ptoSession: { sleepStartedAt: 100, minimumEndAt: 25_300, startingMorale: 50 },
    });
    expect(beforeMinimum.staff[0].morale).toBeCloseTo(50 + (1000 - 100) * (50 / 25200));
    expect(beforeMinimum.staff[0].movementResidency).toMatchObject({ kind: 'staff_amenity' });

    const workSchedule = allWork();
    const earlyWork = advanceStaffWellbeing({
      ...beforeMinimum,
      staff: [{ ...beforeMinimum.staff[0], schedule: workSchedule }],
    }, 1_000, 1_001);
    expect(earlyWork.staff[0].dutyPhase).toBe('active');
    expect(earlyWork.staff[0].effectiveDuty).toBe('pto');
    expect(earlyWork.staff[0].morale).toBeGreaterThanOrEqual(beforeMinimum.staff[0].morale);
  });

  it('keeps an all-pto sleeper occupied beyond the minimum and wakes with one nonstacking buff', () => {
    const amenity = bed();
    const started = reserveAndArrive(state({
      staff: [ptoWorker({ morale: 20, x: 590, y: 520 })], staffAmenities: [amenity],
    }), amenity, 'staff-1', 100);
    const longSleep = advanceStaffWellbeing(started, 100, 60_000);
    expect(longSleep.staff[0].dutyPhase).toBe('active');
    expect(longSleep.staff[0].morale).toBe(100);
    expect(longSleep.staff[0].movementResidency).toBeTruthy();

    const work = allWork();
    const waking = advanceStaffWellbeing({
      ...longSleep,
      staff: [{ ...longSleep.staff[0], schedule: work }],
    }, 60_000, 60_000);
    expect(waking.staff[0]).toMatchObject({ effectiveDuty: 'work', dutyPhase: 'exiting', wellRestedUntil: 146_400 });
    expect(waking.staff[0].morale).toBe(100);
    expect(waking.staff[0].ptoSession).toMatchObject({ minimumEndAt: 25_300 });
  });

  it('splits the ordinary morale drain at the exact well-rested expiry boundary', () => {
    const task = {
      type: 'take_order', startedAt: 0, lastProgressAt: 0, accumulatedWork: 0,
    };
    const current = state({
      staff: [worker({ morale: 50, task, activityPhase: 'working', wellRestedUntil: 50 })],
    });
    const result = advanceStaffWellbeing(current, 0, 100);

    expect(result.staff[0].morale).toBeCloseTo(50 - ((25 + 50) * 0.01) / 60);
  });

  it('does not drain staff that are only waiting or travelling', () => {
    const current = state({
      staff: [worker({ morale: 50, task: { type: 'take_order', startedAt: 0 }, activityPhase: 'task_assigned', navigationGoal: { x: 700, y: 530 } })],
    });
    expect(advanceStaffWellbeing(current, 0, 3_600).staff[0].morale).toBe(50);
  });

  it('retains an in-flight task during handoff and reports a no-progress timeout', () => {
    const schedule = allWork();
    schedule[0] = 'rest';
    const task = { type: 'take_order', startedAt: 0, lastProgressAt: 0, accumulatedWork: 0 };
    const current = state({
      staff: [worker({ schedule, task, activityPhase: 'working' })],
    });

    const finishing = advanceStaffWellbeing(current, 0, 59);
    expect(finishing.staff[0]).toMatchObject({
      task,
      effectiveDuty: 'rest', dutyPhase: 'finishing_task', dutyTransitionRequestedAt: 0,
    });
    const blocked = advanceStaffWellbeing(finishing, 59, 60);
    expect(blocked.staff[0]).toMatchObject({
      task,
      effectiveDuty: 'rest', dutyPhase: 'blocked_handoff', dutyBlockReason: 'handoff-timeout',
    });
  });

  it('hands cooking work to the shared lifecycle helper without creating a second ledger', () => {
    const schedule = allWork();
    schedule[0] = 'rest';
    const task = {
      type: 'prepare_dish', batchId: 'batch-1', serviceItemId: 'dish-1', stationId: 'kitchen-1',
      startedAt: 0, accumulatedWork: 12, lastProgressAt: 0,
    };
    const current = state({
      staff: [worker({ schedule, task, activityPhase: 'working' })],
      cookingBatches: [{ id: 'batch-1', cookId: 'staff-1', stationId: 'kitchen-1', serviceItemIds: ['dish-1'] }],
      serviceItems: [{ id: 'dish-1', kind: 'dish', state: 'preparing', assignedStaffId: 'staff-1', batchId: 'batch-1', accumulatedWork: 12, preparationStartedAt: 0 }],
    });

    const handedOff = advanceStaffWellbeing(current, 0, 0);

    expect(handedOff.staff[0].task).toBeNull();
    expect(handedOff.staff[0].dutyPhase).toBe('waiting_for_amenity');
    expect(handedOff.serviceItems[0].accumulatedWork).toBe(12);
  });

  it('measures the handoff timeout from the latest real progress boundary', () => {
    const schedule = allWork();
    schedule[0] = 'rest';
    const current = state({
      staff: [worker({
        schedule,
        task: { type: 'take_order', startedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
        activityPhase: 'working',
      })],
    });
    const first = advanceStaffWellbeing(current, 0, 0);
    const progressed = advanceStaffWellbeing({
      ...first,
      staff: [{ ...first.staff[0], task: { ...first.staff[0].task, accumulatedWork: 2, lastProgressAt: 30 } }],
    }, 0, 30);
    expect(progressed.staff[0].dutyPhase).toBe('finishing_task');
    const stillFinishing = advanceStaffWellbeing(progressed, 30, 89);
    expect(stillFinishing.staff[0].dutyPhase).toBe('finishing_task');
    const timedOut = advanceStaffWellbeing(stillFinishing, 89, 90);
    expect(timedOut.staff[0].dutyPhase).toBe('blocked_handoff');
  });

  it('releases a cancelled reservation atomically at a duty boundary', () => {
    const amenity = couch();
    const reserved = reserveAmenitySlot(
      state({ staff: [restWorker()], staffAmenities: [amenity] }),
      'staff-1', amenity.id, 0, 0,
    );
    const work = allWork();
    const cancelled = advanceStaffWellbeing({
      ...reserved,
      staff: [{ ...reserved.staff[0], schedule: work }],
    }, 0, 0);

    expect(cancelled.staff[0].amenityUse).toBeNull();
    expect(cancelled.staffAmenities[0].slots[0]).toEqual({
      index: 0, reservedBy: null, occupiedBy: null,
    });
  });

  it('assigns two couch slots in stable worker order without cross-slot collision', () => {
    const amenity = couch();
    const first = restWorker({ id: 'a', x: 610, y: 530 });
    const second = restWorker({ id: 'b', x: 630, y: 530 });
    const result = advanceStaffWellbeing(state({
      staff: [second, first], staffAmenities: [amenity],
    }), 0, 0);

    expect(result.staff.find(candidate => candidate.id === 'a').amenityUse.slotIndex).toBe(0);
    expect(result.staff.find(candidate => candidate.id === 'b').amenityUse.slotIndex).toBe(1);
    expect(result.staffAmenities[0].slots.map(slot => slot.reservedBy)).toEqual(['a', 'b']);
  });

  it('gives a freed one-slot amenity to an older waiter before the prior occupant renews', () => {
    const amenity = arcade();
    const first = restWorker({ id: 'a', x: 610, y: 530 });
    const second = restWorker({ id: 'b', x: 700, y: 530 });
    let current = advanceStaffWellbeing(state({
      staff: [first, second], staffAmenities: [amenity],
    }), 0, 0);
    expect(current.staff.find(candidate => candidate.id === 'b').dutyPhase)
      .toBe('waiting_for_amenity');
    current = resolveStaffWellbeingAfterMovement(
      current,
      new Map([['a', { plan: 'arrived', motion: 'holding' }]]),
      0,
    );
    current = advanceStaffWellbeing(current, 0, 600);
    const exiting = current.staff.find(candidate => candidate.id === 'a');
    expect(exiting.dutyPhase).toBe('exiting');
    current = {
      ...current,
      staff: current.staff.map(candidate => candidate.id === 'a'
        ? { ...candidate, x: candidate.navigationGoal.x, y: candidate.navigationGoal.y }
        : candidate),
    };
    const released = resolveStaffWellbeingAfterMovement(
      current,
      new Map([['a', { plan: 'arrived', motion: 'holding' }]]),
      600,
    );

    expect(released.staff.find(candidate => candidate.id === 'b').amenityUse)
      .toMatchObject({ phase: 'reserved', amenityId: amenity.id });
    expect(released.staff.find(candidate => candidate.id === 'a').amenityUse).toBeNull();
  });

  it('keeps a no-bed PTO worker visible while waiting, then retries on capacity change', () => {
    const pto = ptoWorker({ x: 590, y: 520 });
    const waiting = advanceStaffWellbeing(state({ staff: [pto] }), 0, 1);
    expect(waiting.staff[0]).toMatchObject({
      effectiveDuty: 'pto', dutyPhase: 'waiting_for_amenity', amenityWaitingSince: 1,
    });

    const withBed = advanceStaffWellbeing({
      ...waiting,
      staffAmenities: [bed()],
    }, 1, 1);
    expect(withBed.staff[0]).toMatchObject({
      dutyPhase: 'travelling', amenityUse: { phase: 'reserved', amenityId: 'bed-1' },
    });
  });

  it('does not extend the waking buff when a blocked exit is retried', () => {
    const amenity = bed();
    const started = reserveAndArrive(state({
      staff: [ptoWorker({ x: 590, y: 520 })], staffAmenities: [amenity],
    }), amenity, 'staff-1', 100);
    const sleeping = advanceStaffWellbeing(started, 100, 60_000);
    const work = allWork();
    const waking = advanceStaffWellbeing({
      ...sleeping,
      staff: [{ ...sleeping.staff[0], schedule: work }],
    }, 60_000, 60_000);
    const retried = advanceStaffWellbeing(waking, 60_000, 60_030);

    expect(waking.staff[0].wellRestedUntil).toBe(146_400);
    expect(retried.staff[0].wellRestedUntil).toBe(146_400);
  });

  it('uses the real movement coordinator before granting couch residency', () => {
    const amenity = couch();
    let current = state({
      staff: [restWorker({ x: 500, y: 530 })], staffAmenities: [amenity],
    });
    current = advanceStaffWellbeing(current, 0, 0);
    let arrived = false;
    for (let tick = 0; tick < 100 && !arrived; tick += 1) {
      const movement = advanceCharacterMovementBatch(
        current,
        getStaffWellbeingMovementEntries(current),
        1 / 30,
      );
      current = {
        ...current,
        staff: current.staff.map(candidate => movement.moved.get(candidate.id) || candidate),
        movementCoordinator: movement.coordinator,
      };
      current = resolveStaffWellbeingAfterMovement(current, movement.statuses, (tick + 1) / 30);
      arrived = current.staff[0].amenityUse?.phase === 'occupied';
    }
    expect(arrived).toBe(true);
    expect(current.staff[0].movementResidency).toMatchObject({ kind: 'staff_amenity' });
  });
});
