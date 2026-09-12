function finitePoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(left, right) {
  return finitePoint(left) && finitePoint(right)
    && left.x === right.x && left.y === right.y;
}

function currentActor(state, id) {
  const expected = String(id);
  return [...(state?.staff || []), ...(state?.customers || [])]
    .find(actor => String(actor?.id) === expected) || null;
}

// Shared supplied-status lookup used by both the staff and self-seating phases.
export function getMovementStatus(state, statuses, id) {
  if (statuses instanceof Map) {
    return statuses.get(id) ?? statuses.get(String(id)) ?? getCharacterMovementStatus(state, id);
  }
  return getCharacterMovementStatus(state, id);
}

export function getCharacterMovementStatus(state, id) {
  const actor = currentActor(state, id);
  if (!actor) return { plan: 'unreachable', motion: 'holding', reason: 'missing-actor' };
  if (actor.navigationGoal != null && !finitePoint(actor.navigationGoal)) {
    return { plan: 'unreachable', motion: 'holding', reason: 'invalid-goal' };
  }
  const goal = finitePoint(actor.navigationGoal) ? actor.navigationGoal : null;
  const coordinator = state?.movementCoordinator;
  const request = coordinator?.requests instanceof Map
    ? coordinator.requests.get(String(id)) ?? coordinator.requests.get(id)
    : null;
  const stored = coordinator?.statuses instanceof Map
    ? coordinator.statuses.get(String(id)) ?? coordinator.statuses.get(id)
    : null;
  if (stored && goal && samePoint(request?.goal, goal)) {
    if (coordinator.version === 1) {
      // Keep the domain-facing scheduling contract; expose traffic diagnostics
      // without asking existing task producers to interpret a new enum.
      const plan = stored.plan === 'moving' ? 'scheduled' : stored.plan === 'waiting' ? 'planning' : stored.plan;
      if (plan === 'arrived' && !samePoint(actor, goal)) return { plan: 'planning', motion: 'holding' };
      return { ...stored, plan };
    }
    return stored;
  }
  if (!goal || (finitePoint(actor) && Math.hypot(actor.x - goal.x, actor.y - goal.y) <= 2)) {
    return { plan: 'arrived', motion: 'holding' };
  }
  return { plan: 'planning', motion: 'holding' };
}
