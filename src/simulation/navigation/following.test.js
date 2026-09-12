import { expect, it } from 'vitest';
import { advanceCharacterMovementBatch } from '../movement';
import { canClaimDestination } from './destinations';
import { chooseFollowerGoal, validFollowerGoal } from './following';
import { createGrid } from './grid';

function baseState(overrides = {}) {
  return {
    restaurant: { expansionLevel: 1 },
    tables: [], chairs: [], kitchenStations: [], serviceTables: [],
    cashierStations: [], washStations: [],
    staff: [], customers: [],
    ...overrides,
  };
}

it('validFollowerGoal accepts an open, claimable goal', () => {
  const customer = { id: 'f', x: 300, y: 300, navigationGoal: { x: 320, y: 320 } };
  const state = baseState({ customers: [customer] });
  expect(validFollowerGoal(state, customer)).toBe(true);
});

it('validFollowerGoal rejects a goal inside furniture or claimed by another actor', () => {
  const customer = { id: 'f', x: 300, y: 300, navigationGoal: { x: 300, y: 300 } };
  const inFurniture = baseState({
    customers: [customer],
    washStations: [{ id: 'w', type: 'manual', x: 290, y: 290, w: 40, h: 40 }],
  });
  expect(validFollowerGoal(inFurniture, customer)).toBe(false);
  const claimed = baseState({ customers: [customer, { id: 'peer', x: 300, y: 300 }] });
  expect(validFollowerGoal(claimed, customer)).toBe(false);
});

it('chooseFollowerGoal returns an open, claimable goal clear of the preceding actor', () => {
  const preceding = { id: 'lead', x: 400, y: 300 };
  const customer = { id: 'follow', x: 340, y: 320 };
  const state = baseState({ staff: [preceding], customers: [customer] });

  const goal = chooseFollowerGoal(state, customer, preceding);

  expect(goal).not.toBeNull();
  expect(createGrid(state).isOpen(goal)).toBe(true);
  expect(canClaimDestination(state, customer, goal)).toBe(true);
  expect(Math.hypot(goal.x - preceding.x, goal.y - preceding.y)).toBeGreaterThanOrEqual(16);
});

it('chooseFollowerGoal returns null when every formation cell is inside furniture', () => {
  const preceding = { id: 'lead', x: 200, y: 300 };
  const customer = { id: 'follow', x: 100, y: 300 };
  const solid = { id: 'solid', type: 'manual', x: 150, y: 250, w: 200, h: 200 };
  const state = baseState({
    staff: [preceding], customers: [customer], washStations: [solid],
  });

  expect(chooseFollowerGoal(state, customer, preceding)).toBeNull();
});

it('keeps a follower physically clear of its preceding actor across a bounded traverse', () => {
  const lead = { id: 'lead', x: 200, y: 300, navigationGoal: { x: 200, y: 300 } };
  const follower = { id: 'follow', x: 80, y: 300, navigationGoal: { x: 80, y: 300 } };
  let state = baseState({ staff: [lead], customers: [follower] });
  let minimumSpacing = Infinity;
  let movedTicks = 0;

  for (let tick = 0; tick < 200; tick += 1) {
    const currentLead = state.staff[0];
    const currentFollower = state.customers[0];
    const goal = chooseFollowerGoal(state, currentFollower, currentLead);
    const character = goal ? { ...currentFollower, navigationGoal: goal } : currentFollower;
    const batch = advanceCharacterMovementBatch(
      { ...state, customers: [character] },
      [{ character, speed: 40 }],
      0.1,
    );
    const next = batch.moved.get('follow') || character;
    minimumSpacing = Math.min(minimumSpacing, Math.hypot(
      next.x - currentLead.x,
      next.y - currentLead.y,
    ));
    if (Math.hypot(next.x - currentFollower.x, next.y - currentFollower.y) > 1e-6) movedTicks += 1;
    state = { ...state, customers: [{ ...next }], movementCoordinator: batch.coordinator };
  }

  expect(movedTicks).toBeGreaterThan(0);
  expect(minimumSpacing).toBeGreaterThanOrEqual(16 - 1e-9);
});
