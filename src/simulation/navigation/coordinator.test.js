import { describe, expect, it } from 'vitest';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { minimumTrajectoryDistance } from '../movement/trajectory';

const actor = (id, x, y, goal, extra = {}) => ({ id, x, y, ...(goal ? { navigationGoal: goal } : {}), ...extra });
const world = staff => ({ restaurant: { expansionLevel: 1 }, tables: [], chairs: [], kitchenStations: [],
  serviceTables: [], customers: [], queueSlots: [], staff, movementCoordinator: createMovementCoordinator() });
const entries = state => state.staff.map(character => ({ character, speed: character.navigationGoal ? 60 : 0 }));

function tick(state, descriptors = entries(state)) {
  const result = advanceCharacterMovementBatch(state, descriptors, 1 / 30);
  expect(result.diagnostics.expansionsThisTick).toBeLessThanOrEqual(2048);
  const staff = state.staff.map(worker => result.moved.get(worker.id) || worker);
  for (let index = 0; index < staff.length; index += 1) {
    for (let other = index + 1; other < staff.length; other += 1) {
      expect(Math.hypot(staff[index].x - staff[other].x, staff[index].y - staff[other].y)).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(minimumTrajectoryDistance(result.trajectories.get(staff[index].id),
        result.trajectories.get(staff[other].id))).toBeGreaterThanOrEqual(16 - 1e-9);
    }
  }
  return { ...state, staff, movementCoordinator: result.coordinator };
}

describe('bounded traffic coordinator', () => {
  it('diagnoses unsafe starting overlap without teleporting it or stopping independent actors', () => {
    const state = world([actor('a', 400, 300), actor('b', 410, 300), actor('independent', 600, 300, { x: 660, y: 300 })]);
    const result = advanceCharacterMovementBatch(state, entries(state), 1 / 30);
    expect(result.diagnostics.invariantFailure).toBe('unsafeInitialState');
    expect(result.diagnostics.unsafeActors).toEqual(['a', 'b']);
    expect(result.moved.get('a')).toMatchObject({ x: 400, y: 300 });
    expect(result.moved.get('b')).toMatchObject({ x: 410, y: 300 });
    expect(result.moved.get('independent').x).toBeGreaterThan(600);
  });
  it('moves a character to its exact goal through the public batch interface', () => {
    let state = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    for (let index = 0; index < 45; index += 1) state = tick(state);
    expect(state.staff[0]).toMatchObject({ x: 460, y: 300 });
    expect(state.movementCoordinator.statuses.get('worker').plan).toBe('arrived');
  });

  it('does not freeze an independent actor when two destinations conflict', () => {
    let state = world([actor('a', 400, 300, { x: 460, y: 300 }),
      actor('b', 400, 340, { x: 460, y: 300 }), actor('independent', 600, 400, { x: 660, y: 400 })]);
    for (let index = 0; index < 60; index += 1) state = tick(state);
    expect(state.staff.find(worker => worker.id === 'independent')).toMatchObject({ x: 660, y: 400 });
    expect(state.movementCoordinator.claims.size).toBe(2);
  });

  it('preserves stationary occupancy when an actor has no movement descriptor', () => {
    let state = world([actor('mover', 400, 300, { x: 460, y: 300 }), actor('stationary', 420, 300)]);
    for (let index = 0; index < 90; index += 1) state = tick(state, entries(state).filter(entry => entry.character.id === 'mover'));
    expect(state.staff[0]).toMatchObject({ x: 460, y: 300 });
    expect(state.staff[1]).toMatchObject({ x: 420, y: 300 });
  });

  it('keeps the previous coordinator and actors unchanged', () => {
    const state = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    const snapshot = structuredClone(state);
    tick(state);
    expect(state).toEqual(snapshot);
  });

  it('is invariant to input actor ordering', () => {
    const staff = [actor('a', 400, 300, { x: 460, y: 300 }), actor('b', 400, 360, { x: 460, y: 360 })];
    let forward = world(staff);
    let reverse = world([...staff].reverse());
    for (let index = 0; index < 40; index += 1) { forward = tick(forward); reverse = tick(reverse); }
    expect([...forward.staff].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...reverse.staff].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('reports unreachable static geometry without treating it as arrival', () => {
    const state = world([actor('worker', 400, 300, { x: 460, y: 300 })]);
    state.chairs = [{ id: 'blocked', x: 460, y: 300 }];
    const next = tick(state);
    expect(next.staff[0]).toMatchObject({ x: 400, y: 300 });
    expect(next.movementCoordinator.statuses.get('worker').plan).toBe('unreachable');
  });

  it('does not allow ignoredIds to bypass ordinary character collision checks', () => {
    const state = world([actor('mover', 400, 300, { x: 460, y: 300 }), actor('blocker', 416, 300)]);
    const next = tick(state, entries(state).map(entry => ({ ...entry, ignoredIds: ['blocker', 'mover'] })));
    expect(Math.hypot(next.staff[0].x - 416, next.staff[0].y - 300)).toBeGreaterThanOrEqual(16);
  });

  it('resolves opposing corridor traffic through a passing bay without teleporting', () => {
    let state = world([actor('a', 400, 300, { x: 580, y: 300 }), actor('b', 580, 300, { x: 400, y: 300 })]);
    state.chairs = [];
    for (let x = 60; x <= 1020; x += 20) {
      for (const y of [260, 280, 320]) {
        if (x === 420 && y === 280) continue;
        state.chairs.push({ id: `${x}:${y}`, x, y });
      }
    }
    state.chairs.push({ id: 'left-end', x: 380, y: 300 }, { id: 'right-end', x: 600, y: 300 });
    let sawBay = false;
    for (let index = 0; index < 450; index += 1) {
      const previous = state.staff;
      state = tick(state);
      state.staff.forEach((worker, i) => {
        expect(Math.hypot(worker.x - previous[i].x, worker.y - previous[i].y)).toBeLessThanOrEqual(2 + 1e-9);
        if (worker.y < 300) sawBay = true;
      });
      if (state.staff.every(worker => worker.x === worker.navigationGoal.x && worker.y === worker.navigationGoal.y)) break;
    }
    expect(sawBay, JSON.stringify({ staff: state.staff, statuses: [...state.movementCoordinator.statuses],
      waiting: [...state.movementCoordinator.records].map(([id, record]) => [id, record.waitingTicks]),
      recoveries: [...state.movementCoordinator.diagnostics.recoveries] })).toBe(true);
    expect(state.staff[0]).toMatchObject({ x: 580, y: 300 });
    expect(state.staff[1]).toMatchObject({ x: 400, y: 300 });
  });

  it('follows a long static detour even when it initially increases distance to the goal', () => {
    let state = world([actor('worker', 400, 300, { x: 500, y: 300 })]);
    state.tables = Array.from({ length: 11 }, (_, index) => ({ id: `wall-${index}`, x: 440, y: 100 + index * 40 }));
    for (let index = 0; index < 450; index += 1) {
      state = tick(state);
      if (state.movementCoordinator.statuses.get('worker').plan === 'arrived') break;
    }
    expect(state.staff[0]).toMatchObject({ x: 500, y: 300 });
  });

  it('continues a budget-limited static search instead of restarting it forever', () => {
    let state = world([actor('worker', 80, 80, { x: 880, y: 600 })]);
    for (let index = 0; index < 30; index += 1) state = tick(state);
    expect(Math.hypot(state.staff[0].x - 80, state.staff[0].y - 80)).toBeGreaterThan(0);
  });

  it('does not mistake an invalid requested destination for arrival', () => {
    const next = tick(world([actor('worker', 400, 300, { x: NaN, y: 300 })]));
    expect(next.staff[0]).toMatchObject({ x: 400, y: 300 });
    expect(next.movementCoordinator.statuses.get('worker')).toMatchObject({ plan: 'unreachable', reason: 'invalid-goal' });
  });

  it('replans safely when a leading actor cancels its departure and the follower changes speed', () => {
    let state = world([actor('leader', 440, 300, { x: 600, y: 300 }), actor('follower', 400, 300, { x: 560, y: 300 })]);
    for (let index = 0; index < 10; index += 1) state = tick(state);
    state = { ...state, staff: state.staff.map(worker => worker.id === 'leader'
      ? { ...worker, navigationGoal: null } : worker) };
    const stopped = { ...state.staff[0] };
    for (let index = 0; index < 150; index += 1) {
      state = tick(state, entries(state).map(entry => ({ ...entry, speed: entry.character.id === 'follower' ? 120 : 0 })));
    }
    expect(state.staff[0]).toEqual(stopped);
    expect(state.staff[1]).toMatchObject({ x: 560, y: 300 });
  });

  it('invalidates a route when a new fixture blocks its next segment', () => {
    let state = tick(world([actor('worker', 400, 300, { x: 480, y: 300 })]));
    state = { ...state, chairs: [{ id: 'new-chair', x: 420, y: 300 }] };
    for (let index = 0; index < 100; index += 1) {
      state = tick(state);
      const worker = state.staff[0];
      expect(worker.x >= 420 && worker.x < 440 && worker.y >= 300 && worker.y < 320).toBe(false);
    }
    expect(state.staff[0]).toMatchObject({ x: 480, y: 300 });
  });

  it('rotates bounded planning work so all 24 independent movers finish', () => {
    let state = world(Array.from({ length: 24 }, (_, index) => actor(`worker-${index}`, 300, 80 + index * 20,
      { x: 540, y: 80 + index * 20 })));
    for (let index = 0; index < 900; index += 1) {
      state = tick(state);
      if (state.staff.every(worker => worker.x === 540)) break;
    }
    expect(state.staff.every(worker => worker.x === 540)).toBe(true);
  }, 20000);
});
