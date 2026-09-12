import { expect, it } from 'vitest';
import { chooseRecoveries } from './recovery';
import { createGrid } from './grid';
import { createInitialState } from '../../state/initialState';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { minimumTrajectoryDistance } from '../movement/trajectory';
import { findRoute } from './router';

it('routes past a held passing bay instead of following the stale static approach into it', () => {
  let state = { restaurant: { expansionLevel: 1 }, tables: [], chairs: [], staff: [
    { id: 'a', x: 960, y: 90, navigationGoal: { x: 500, y: 460 } },
    { id: 'b', x: 940, y: 80, navigationGoal: { x: 340, y: 540 } },
  ], customers: [], movementCoordinator: createMovementCoordinator() };
  const grid = createGrid(state);
  state.movementCoordinator.records.set('a', { goal: state.staff[0].navigationGoal, routeGoal: state.staff[0].navigationGoal,
    topology: grid.signature, route: findRoute(grid, { x: 1020, y: 60 }, state.staff[0].navigationGoal).points,
    avoidanceKey: '[]', waitingTicks: 200, bestDistance: 500 });
  state.movementCoordinator.records.set('b', { goal: state.staff[1].navigationGoal, waitingTicks: 199,
    recovery: { goal: { x: 940, y: 80 }, origin: { x: 942, y: 80 },
      peers: [{ id: 'a', start: { x: 960, y: 92 }, goal: state.staff[0].navigationGoal }] } });
  for (let tick = 0; tick < 400 && state.staff[0].x > 700; tick += 1) {
    const batch = advanceCharacterMovementBatch(state, state.staff.map(character => ({ character, speed: 60 })), 1 / 30);
    expect(minimumTrajectoryDistance(batch.trajectories.get('a'), batch.trajectories.get('b'))).toBeGreaterThanOrEqual(16);
    state = { ...state, staff: state.staff.map(a => batch.moved.get(a.id)), movementCoordinator: batch.coordinator };
  }
  expect(state.staff[0].x).toBeLessThanOrEqual(700);
});

it('breaks a dependency cycle formed by previously granted passing bays', () => {
  const requests = new Map([
    ['a', { id: 'a', start: { x: 940, y: 300 }, goal: { x: 500, y: 220 }, speed: 60, waitingTicks: 400 }],
    ['b', { id: 'b', start: { x: 940, y: 320 }, goal: { x: 500, y: 540 }, speed: 60, waitingTicks: 300 }],
  ]);
  const records = new Map([...requests].map(([id, request]) => [id, { goal: request.goal,
    recovery: { goal: request.start, peers: [{ id: id === 'a' ? 'b' : 'a', goal: requests.get(id === 'a' ? 'b' : 'a').goal }] } }]));
  const statuses = new Map([['a', { blockers: ['b'] }], ['b', { blockers: ['a'] }]]);
  const result = chooseRecoveries({ requests, records, statuses, grid: createGrid(createInitialState()), budget: 0 });
  expect(result.recoveries.size).toBe(1);
  expect(result.recoveries.has('a')).toBe(false);
  expect(records.size).toBe(2);
});

it('releases a passing bay once the peer has cleared the conflict, not only its distant destination', () => {
  const grid = createGrid({ restaurant: { expansionLevel: 1 }, tables: [], chairs: [] });
  const goal = { x: 60, y: 100 };
  const records = new Map([['yielding', { goal, recovery: { origin: { x: 200, y: 100 },
    goal: { x: 200, y: 100 }, peers: [{ id: 'passing', start: { x: 180, y: 100 }, goal: { x: 320, y: 100 } }] } }]]);
  const check = x => chooseRecoveries({ grid, records, statuses: new Map(), budget: 0,
    requests: new Map([
      ['yielding', { id: 'yielding', start: { x: 200, y: 100 }, goal, speed: 20, waitingTicks: 0 }],
      ['passing', { id: 'passing', start: { x, y: 100 }, goal: { x: 320, y: 100 }, speed: 20, waitingTicks: 0 }],
    ]) }).recoveries;
  expect(check(210).has('yielding')).toBe(true);
  expect(check(220).has('yielding')).toBe(false);
  expect(records.get('yielding').recovery.peers).toHaveLength(1);
});

it('admits another safe yield when an existing yielding actor remains part of a larger traffic cycle', () => {
  const requests = new Map([
    ['host', { id: 'host', start: { x: 320, y: 160 }, goal: { x: 340, y: 140 }, speed: 75, waitingTicks: 400 }],
    ['janitor', { id: 'janitor', start: { x: 340, y: 160 }, goal: { x: 320, y: 180 }, speed: 20, waitingTicks: 350 }],
    ['waiter', { id: 'waiter', start: { x: 340, y: 180 }, goal: { x: 340, y: 160 }, speed: 75, waitingTicks: 380 }],
  ]);
  const original = { origin: { x: 340, y: 160 }, goal: { x: 320, y: 160 },
    peers: [{ id: 'waiter', start: { x: 340, y: 180 }, goal: { x: 340, y: 160 } }] };
  const records = new Map([['host', { goal: requests.get('host').goal, recovery: original }]]);
  const statuses = new Map([
    ['host', { blockers: ['waiter'] }], ['waiter', { blockers: ['host', 'janitor'] }],
    ['janitor', { blockers: ['host', 'waiter'] }],
  ]);
  const result = chooseRecoveries({ requests, records, statuses, grid: createGrid(createInitialState()), budget: 512 });
  expect(result.recoveries.get('host')).toEqual(original);
  expect(result.recoveries.size).toBe(2);
  expect(result.expansions).toBeLessThanOrEqual(512);
  expect(records.get('host').recovery).toEqual(original);

  let state = { ...createInitialState(), customers: [], staff: [...requests.values()].map(request => ({
    id: request.id, role: request.id === 'janitor' ? 'janitor' : 'waiter', ...request.start, navigationGoal: request.goal,
  })), movementCoordinator: { ...createMovementCoordinator(), statuses,
    records: new Map([...requests].map(([id, request]) => [id, { ...records.get(id), goal: request.goal, waitingTicks: request.waitingTicks }])) } };
  for (let tick = 0; tick < 600 && state.staff.some(actor => Math.hypot(actor.x - actor.navigationGoal.x, actor.y - actor.navigationGoal.y) > 0); tick += 1) {
    const batch = advanceCharacterMovementBatch(state, state.staff.map(character => ({ character,
      speed: character.role === 'janitor' ? 20 : 75 })), 4 / 30);
    const trajectories = [...batch.trajectories.values()];
    for (let left = 0; left < trajectories.length; left += 1) for (let right = left + 1; right < trajectories.length; right += 1) {
      expect(minimumTrajectoryDistance(trajectories[left], trajectories[right])).toBeGreaterThanOrEqual(16 - 1e-9);
    }
    state = { ...state, staff: state.staff.map(actor => batch.moved.get(actor.id)), movementCoordinator: batch.coordinator };
  }
  for (const actor of state.staff) expect({ x: actor.x, y: actor.y }, JSON.stringify({ staff: state.staff,
    statuses: [...state.movementCoordinator.statuses], records: [...state.movementCoordinator.records].map(([id, record]) => [id, { recovery: record.recovery, route: record.route, avoidance: record.routeAvoidance }]) }))
    .toEqual(actor.navigationGoal);
});
