function interpolateCollection(previous = [], current = [], alpha = 1) {
  const priorById = new Map(previous.map(entity => [entity.id, entity]));
  const ratio = Math.min(1, Math.max(0, Number(alpha) || 0));
  return current.map(entity => {
    const prior = priorById.get(entity.id);
    if (![prior?.x, prior?.y, entity.x, entity.y].every(Number.isFinite)) return entity;
    // The wellbeing controller commits couch/bed residency at an interior
    // geometry anchor. Interpolating the approach point to that anchor would
    // visibly walk a worker through the solid furniture for one render frame.
    // Pose transitions are discrete presentation changes, not movement paths.
    const residencyTransition = prior?.movementResidency?.kind === 'staff_amenity'
      || entity?.movementResidency?.kind === 'staff_amenity';
    const amenityPhaseTransition = Boolean(
      prior?.amenityUse?.phase !== entity?.amenityUse?.phase
      && (prior?.amenityUse || entity?.amenityUse),
    );
    if (residencyTransition || amenityPhaseTransition) return entity;
    return {
      ...entity,
      x: prior.x + (entity.x - prior.x) * ratio,
      y: prior.y + (entity.y - prior.y) * ratio,
    };
  });
}

export function interpolateSimulationState(previous, current, alpha) {
  if (!current) return previous;
  if (!previous) return current;
  return {
    ...current,
    staff: interpolateCollection(previous.staff, current.staff, alpha),
    customers: interpolateCollection(previous.customers, current.customers, alpha),
    queue: current.queue,
  };
}
