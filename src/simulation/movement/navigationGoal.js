export function sameNavigationGoal(left, right) {
  return Number.isFinite(left?.x) && Number.isFinite(left?.y)
    && Number.isFinite(right?.x) && Number.isFinite(right?.y)
    && left.x === right.x && left.y === right.y;
}

export function clearNavigationGoal(actor) {
  if (!Object.hasOwn(actor, 'navigationGoal')) return actor;
  const { navigationGoal: _navigationGoal, ...cleared } = actor;
  return cleared;
}

export function setNavigationGoal(actor, goal) {
  if (!Number.isFinite(goal?.x) || !Number.isFinite(goal?.y)) return clearNavigationGoal(actor);
  return sameNavigationGoal(actor.navigationGoal, goal)
    ? actor
    : { ...actor, navigationGoal: { x: goal.x, y: goal.y } };
}

export function isAtNavigationGoal(actor, tolerance = 2) {
  return Number.isFinite(actor?.x) && Number.isFinite(actor?.y)
    && Number.isFinite(actor?.navigationGoal?.x)
    && Number.isFinite(actor?.navigationGoal?.y)
    && Math.hypot(
      actor.x - actor.navigationGoal.x,
      actor.y - actor.navigationGoal.y,
    ) <= tolerance;
}
