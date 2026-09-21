import { expect, it } from 'vitest';
import { advanceCharacterMovementBatch, createMovementCoordinator } from './coordinator';
import { createActorGrid } from './domainGrid';
import { chooseRecoveries } from './recovery';
import { createGrid } from './grid';
import { minimumTrajectoryDistance } from '../movement/trajectory';

const world = { restaurant: { expansionLevel: 1 }, tables: [], chairs: [], customers: [] };

it('does not inherit ordinary fractional connectors into the restricted exit graph', () => {
  const actor = { id: 'exit', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
    x: 993, y: 360, navigationGoal: { x: 1113, y: 360 } };
  const state = { ...world, doors: [{ id: 'door', y: 340, role: 'exit' }], staff: [], customers: [actor] };
  expect(createActorGrid(state, actor).connectors(actor)).toEqual([]);
});

it('discards an exit commitment that is not an edge of its current actor graph', () => {
  const actor = { id: 'exit', state: 'leaving', exitPhase: 'fading', exitDoorId: 'door',
    x: 997, y: 360, navigationGoal: { x: 1113, y: 360 } };
  const state = { ...world, doors: [{ id: 'door', y: 340, role: 'exit' }], staff: [], customers: [actor], movementCoordinator: createMovementCoordinator() };
  state.movementCoordinator.records.set(actor.id, { goal: actor.navigationGoal, routeGoal: actor.navigationGoal,
    topology: createActorGrid(state, actor).signature, avoidanceKey: '[]', route: [actor.navigationGoal],
    commitment: { x: 1000, y: 360 }, waitingTicks: 1000, bestDistance: 116 });
  const result = advanceCharacterMovementBatch(state, [{ character: actor, speed: 30 }], 4 / 30);
  expect(result.moved.get(actor.id)).toMatchObject({ x: 1001, y: 360 });
  expect(state.movementCoordinator.records.get(actor.id).commitment).toEqual({ x: 1000, y: 360 });
});

it('can leave a fractional start between stationary queue members without cutting their clearance', () => {
  let state = { ...world, staff: [{ id: 'a', x: 980, y: 405, navigationGoal: { x: 993, y: 360 } },
    { id: 'upper', x: 973, y: 390 }, { id: 'lower', x: 973, y: 420 }] };
  for (let tick = 0; tick < 200; tick += 1) {
    const result = advanceCharacterMovementBatch(state, [{ character: state.staff[0], speed: 55 }], 4 / 30);
    for (const id of ['upper', 'lower']) {
      expect(minimumTrajectoryDistance(result.trajectories.get('a'), result.trajectories.get(id))).toBeGreaterThanOrEqual(16);
    }
    state = { ...state, staff: state.staff.map(actor => result.moved.get(actor.id)), movementCoordinator: result.coordinator };
  }
  expect(state.staff[0]).toMatchObject({ x: 993, y: 360 });
});

it.each([1, 0.1])('does not commit a horizon-clipped exit position as a route waypoint at dt=%s', dt => {
  let state = { ...world, doors: [{ id: 'door', y: 340, role: 'exit' }], staff: [], customers: [{ id: 'exit',
    state: 'leaving', exitPhase: 'fading', exitDoorId: 'door', x: 993, y: 360,
    navigationGoal: { x: 1113, y: 360 } }] };
  for (let index = 0; index < 4 / dt; index += 1) {
    const batch = advanceCharacterMovementBatch(state, [{ character: state.customers[0], speed: 30 }], dt);
    state = { ...state, customers: [batch.moved.get('exit')], movementCoordinator: batch.coordinator };
    expect(state.customers[0].x).toBe(993 + (index + 1) * 30 * dt);
  }
});

it('retains the next movement waypoint until arrival without mutating previous frame intent', () => {
  let state = { ...world, staff: [{ id: 'a', x: 400, y: 300, navigationGoal: { x: 480, y: 340 } }] };
  const first = advanceCharacterMovementBatch(state, [{ character: state.staff[0], speed: 60 }], 1 / 30);
  const commitment = first.coordinator.records.get('a').commitment;
  expect(commitment).toEqual(first.coordinator.plans.get('a').find(action => action.from.x !== action.to.x || action.from.y !== action.to.y).to);
  state = { ...state, staff: [first.moved.get('a')], movementCoordinator: first.coordinator };
  const next = advanceCharacterMovementBatch(state, [{ character: state.staff[0], speed: 60 }], 1 / 30);
  expect(next.coordinator.records.get('a').commitment).toEqual(commitment);
  expect(first.coordinator.records.get('a').commitment).toEqual(commitment);
});

it('retires a yield commitment crossed within the batch before committing its continuation', () => {
  const goal = { x: 600, y: 300 };
  const actor = { id: 'yielding', x: 607.8666666666666, y: 320, task: null,
    activityPhase: 'idle_roaming', navigationGoal: goal, navigationYield: { goal } };
  const state = { ...world, staff: [actor], movementCoordinator: createMovementCoordinator() };
  state.movementCoordinator.records.set(actor.id, { goal, routeGoal: goal,
    topology: createActorGrid(state, actor).signature, avoidanceKey: '[]',
    route: [{ x: 600, y: 320 }, goal], commitment: { x: 600, y: 320 }, waitingTicks: 0 });
  const batch = advanceCharacterMovementBatch(state, [{ character: actor, speed: 26 }], 0.4);
  expect(batch.moved.get(actor.id).y).toBeLessThan(320);
  expect(batch.coordinator.records.get(actor.id).commitment).toEqual(goal);
  expect(state.movementCoordinator.records.get(actor.id).commitment).toEqual({ x: 600, y: 320 });
});

it.each(['changed goal', 'assigned task', 'customer'])('does not extend ordinary commitments for %s yield metadata', kind => {
  const goal = { x: 600, y: 300 };
  const task = kind === 'assigned task' ? { type: 'deliver_service_item', serviceItemId: 'item' } : null;
  const actor = { id: 'actor', x: 606.1333333333332, y: 320, task,
    activityPhase: 'idle_roaming', navigationGoal: goal, carryingServiceItemIds: task ? ['item'] : [],
    navigationYield: { goal: kind === 'changed goal' ? { x: 620, y: 300 } : goal } };
  const state = { ...world, staff: kind === 'customer' ? [] : [actor],
    customers: kind === 'customer' ? [actor] : [], movementCoordinator: createMovementCoordinator() };
  state.movementCoordinator.records.set(actor.id, { goal, routeGoal: goal,
    topology: createActorGrid(state, actor).signature, avoidanceKey: '[]',
    route: [{ x: 600, y: 320 }, goal], commitment: { x: 600, y: 320 }, waitingTicks: 0 });
  const batch = advanceCharacterMovementBatch(state, [{ character: actor, speed: 26 }], 0.4);
  expect(batch.moved.get(actor.id)).toMatchObject({ x: 600, y: 320, navigationGoal: goal });
  expect(batch.moved.get(actor.id).task).toBe(task);
  expect(batch.moved.get(actor.id).carryingServiceItemIds).toBe(actor.carryingServiceItemIds);
  expect(actor.navigationGoal).toBe(goal);
  expect(state.movementCoordinator.records.get(actor.id).commitment).toEqual({ x: 600, y: 320 });
});

it('finishes in-transit yield manoeuvres before breaking dependencies between occupied bays', () => {
  const requests = new Map([
    ['a', { id: 'a', start: { x: 940, y: 302 }, goal: { x: 500, y: 220 }, speed: 60, waitingTicks: 400 }],
    ['b', { id: 'b', start: { x: 940, y: 322 }, goal: { x: 500, y: 540 }, speed: 60, waitingTicks: 300 }],
  ]);
  const records = new Map([...requests].map(([id, request]) => [id, { goal: request.goal,
    recovery: { goal: { x: 940, y: request.start.y - 2 }, peers: [{ id: id === 'a' ? 'b' : 'a', goal: requests.get(id === 'a' ? 'b' : 'a').goal }] } }]));
  const result = chooseRecoveries({ requests, records, statuses: new Map(), grid: createGrid(world), budget: 0 });
  expect(result.recoveries.size).toBe(2);
});

it('does not redirect actors that are already traversing safely into fresh passing bays', () => {
  const requests = new Map([
    ['a', { id: 'a', start: { x: 400, y: 300 }, goal: { x: 460, y: 300 }, speed: 60, waitingTicks: 100 }],
    ['b', { id: 'b', start: { x: 460, y: 300 }, goal: { x: 400, y: 300 }, speed: 60, waitingTicks: 100 }],
  ]);
  const statuses = new Map([['a', { motion: 'traversing', blockers: ['b'] }], ['b', { motion: 'traversing', blockers: ['a'] }]]);
  expect(chooseRecoveries({ requests, records: new Map(), statuses, grid: createGrid(world), budget: 512 }).recoveries.size).toBe(0);
});
