function validate(action, snapshot = false) {
  if (!action) throw new Error('Invalid movement reservation');
  const fromX = action.from?.x;
  const fromY = action.from?.y;
  const toX = action.to?.x;
  const toY = action.to?.y;
  const start = action.start;
  const end = action.end;
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX)
    || !Number.isFinite(toY) || !Number.isFinite(start) || !Number.isFinite(end)
    || action.end < action.start
    || (action.end === action.start && (action.from.x !== action.to.x || action.from.y !== action.to.y))) {
    throw new Error('Invalid movement reservation');
  }
  if (snapshot) return { from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, start, end };
}

function prepareAction(action) {
  const snapshot = validate(action, true);
  const broadPhaseEligible = actionWithinBroadPhaseLimit(snapshot);
  return {
    identity: action,
    action: snapshot,
    broadPhaseEligible,
    bounds: broadPhaseEligible ? actionBounds(snapshot) : null,
    coordinateMagnitude: broadPhaseEligible ? coordinateMagnitude(snapshot) : null,
  };
}

const reservationPreparationContexts = new WeakMap();

/** Internal coordinator batch brand; its lazy action cache is private to this module. */
export function createReservationPreparationContext() {
  const context = Object.create(null);
  reservationPreparationContexts.set(context, new WeakMap());
  return context;
}

function sharedPreparedActions(context) {
  if (context === null || (typeof context !== 'object' && typeof context !== 'function')) return null;
  return reservationPreparationContexts.get(context) || null;
}

function compileOwnedReservations(reservations) {
  const groups = [];
  for (const reservation of reservations) {
    const actions = reservation.actions;
    groups.push({ reservation, actions, actionCount: actions.length, prepared: new Array(actions.length) });
  }
  return groups;
}

function prepareSharedAction(action, preparedActions) {
  if (action === null || (typeof action !== 'object' && typeof action !== 'function')) {
    return prepareAction(action);
  }
  let prepared = preparedActions.get(action);
  if (!prepared) {
    prepared = prepareAction(action);
    preparedActions.set(action, prepared);
  }
  return prepared;
}

function interpolate(action, time) {
  if (time <= action.start) return { ...action.from };
  if (time >= action.end) return { ...action.to };
  const fraction = (time - action.start) / (action.end - action.start);
  return { x: action.from.x + (action.to.x - action.from.x) * fraction,
    y: action.from.y + (action.to.y - action.from.y) * fraction };
}

const BROAD_PHASE_SAFE_LIMIT = Number.MAX_SAFE_INTEGER;

function broadPhaseEligible(left, right, clearance) {
  return Math.abs(left.from.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.from.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.to.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.to.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.from.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.from.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.to.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.to.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.start) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(left.end) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.start) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(right.end) <= BROAD_PHASE_SAFE_LIMIT
    && clearance <= BROAD_PHASE_SAFE_LIMIT;
}

function actionWithinBroadPhaseLimit(action) {
  return Math.abs(action.from.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(action.from.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(action.to.x) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(action.to.y) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(action.start) <= BROAD_PHASE_SAFE_LIMIT
    && Math.abs(action.end) <= BROAD_PHASE_SAFE_LIMIT;
}

function actionBounds(action) {
  return {
    minX: Math.min(action.from.x, action.to.x),
    maxX: Math.max(action.from.x, action.to.x),
    minY: Math.min(action.from.y, action.to.y),
    maxY: Math.max(action.from.y, action.to.y),
  };
}

function coordinateMagnitude(action) {
  let magnitude = Math.abs(action.from.x);
  const fromY = Math.abs(action.from.y);
  const toX = Math.abs(action.to.x);
  const toY = Math.abs(action.to.y);
  if (fromY > magnitude) magnitude = fromY;
  if (toX > magnitude) magnitude = toX;
  if (toY > magnitude) magnitude = toY;
  return magnitude;
}

function cachedSpatialScale(leftPrepared, rightPrepared, clearance) {
  let scale = 1;
  if (clearance > scale) scale = clearance;
  const leftMagnitude = leftPrepared.coordinateMagnitude;
  if (leftMagnitude > scale) scale = leftMagnitude;
  const rightMagnitude = rightPrepared.coordinateMagnitude;
  if (rightMagnitude > scale) scale = rightMagnitude;
  return scale;
}

function isSpatiallySeparated(left, right, clearance, leftPrepared, rightPrepared) {
  const preparedPair = leftPrepared && rightPrepared;
  if (preparedPair) {
    if (!leftPrepared.broadPhaseEligible) return false;
    if (!rightPrepared.broadPhaseEligible || clearance > BROAD_PHASE_SAFE_LIMIT) return false;
  } else if (!broadPhaseEligible(left, right, clearance)) return false;
  const leftBounds = leftPrepared ? leftPrepared.bounds : actionBounds(left);
  const rightBounds = rightPrepared ? rightPrepared.bounds : actionBounds(right);
  const gapX = leftBounds.minX > rightBounds.maxX ? leftBounds.minX - rightBounds.maxX
    : rightBounds.minX > leftBounds.maxX ? rightBounds.minX - leftBounds.maxX : 0;
  const gapY = leftBounds.minY > rightBounds.maxY ? leftBounds.minY - rightBounds.maxY
    : rightBounds.minY > leftBounds.maxY ? rightBounds.minY - leftBounds.maxY : 0;
  if (!preparedPair && (!Number.isFinite(gapX) || !Number.isFinite(gapY))) return false;
  if (gapX <= clearance && gapY <= clearance) return false;

  const scale = leftPrepared && rightPrepared
    ? cachedSpatialScale(leftPrepared, rightPrepared, clearance)
    : Math.max(1, clearance,
      Math.abs(left.from.x), Math.abs(left.from.y), Math.abs(left.to.x), Math.abs(left.to.y),
      Math.abs(right.from.x), Math.abs(right.from.y), Math.abs(right.to.x), Math.abs(right.to.y));
  const margin = Number.EPSILON * scale * 8;
  const threshold = clearance + margin;
  if (!preparedPair && !Number.isFinite(threshold)) return false;
  return gapX > threshold || gapY > threshold;
}

function validateClearance(clearance) {
  if (!Number.isFinite(clearance) || clearance < 0) {
    throw new Error('Invalid movement reservation clearance');
  }
}

function actionsConflictValidated(left, right, clearance, leftPrepared, rightPrepared) {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  if (end < start) return false;
  if (isSpatiallySeparated(left, right, clearance, leftPrepared, rightPrepared)) return false;
  const a = interpolate(left, start);
  const b = interpolate(right, start);
  const aEnd = interpolate(left, end);
  const bEnd = interpolate(right, end);
  const x = a.x - b.x;
  const y = a.y - b.y;
  const dx = (aEnd.x - bEnd.x) - x;
  const dy = (aEnd.y - bEnd.y) - y;
  const squared = dx * dx + dy * dy;
  const fraction = squared === 0 ? 0 : Math.max(0, Math.min(1, -(x * dx + y * dy) / squared));
  const separation = Math.hypot(x + dx * fraction, y + dy * fraction);
  if (!Number.isFinite(separation)) throw new Error('Invalid movement reservation arithmetic');
  return separation < clearance;
}

export function positionAt(action, time) {
  validate(action);
  if (!Number.isFinite(time)) throw new Error('Invalid movement reservation time');
  return interpolate(action, time);
}

export function actionsConflict(left, right, clearance = 16) {
  validate(left);
  validate(right);
  validateClearance(clearance);
  return actionsConflictValidated(left, right, clearance);
}

/**
 * Plan-scoped checker: action geometry is snapshotted lazily on first observation and remains fixed
 * for this instance. In-place mutation is not detected or frozen; use a new checker for changed geometry.
 */
export function createConflictChecker() {
  const preparedActions = new WeakMap();
  const prepare = action => {
    if (action === null || (typeof action !== 'object' && typeof action !== 'function')) {
      return prepareAction(action);
    }
    let prepared = preparedActions.get(action);
    if (!prepared) {
      prepared = prepareAction(action);
      preparedActions.set(action, prepared);
    }
    return prepared;
  };

  return (left, right, clearance = 16) => {
    const leftPrepared = prepare(left);
    const rightPrepared = prepare(right);
    validateClearance(clearance);
    return actionsConflictValidated(leftPrepared.action, rightPrepared.action, clearance,
      leftPrepared, rightPrepared);
  };
}

/**
 * Without a context, rereads mutable reservation/action positions per query. The branded coordinator
 * context selects indexed stable-array records; action geometry is still prepared only when reached.
 * Same-object mutation requires a fresh context.
 */
export function createReservationSafetyChecker(reservations, blockers, preparationContext = null) {
  const preparedByIdentity = sharedPreparedActions(preparationContext);
  if (preparedByIdentity) {
    const groups = compileOwnedReservations(reservations);
    return candidate => {
      let candidatePrepared;
      let clear = true;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex];
        for (let actionIndex = 0; actionIndex < group.actionCount; actionIndex += 1) {
          const other = group.actions[actionIndex];
          if (!candidatePrepared) candidatePrepared = prepareAction(candidate);
          let otherPrepared = group.prepared[actionIndex];
          if (!otherPrepared) {
            otherPrepared = prepareSharedAction(other, preparedByIdentity);
            group.prepared[actionIndex] = otherPrepared;
          }
          if (!actionsConflictValidated(candidatePrepared.action, otherPrepared.action, 16,
            candidatePrepared, otherPrepared)) continue;
          blockers.add(group.reservation.actorId);
          clear = false;
          break;
        }
      }
      return clear;
    };
  }

  const localPreparedActions = new WeakMap();
  const preparedAtPositions = [];

  const prepareAtPosition = (reservationIndex, actionIndex, action) => {
    let records = preparedAtPositions[reservationIndex];
    if (!records) preparedAtPositions[reservationIndex] = records = [];
    let prepared = records[actionIndex];
    if (prepared?.identity === action) return prepared;

    if (action !== null && (typeof action === 'object' || typeof action === 'function')) {
      prepared = localPreparedActions.get(action);
      if (!prepared) {
        prepared = prepareAction(action);
        localPreparedActions.set(action, prepared);
      }
    } else {
      prepared = prepareAction(action);
    }
    records[actionIndex] = prepared;
    return prepared;
  };

  return candidate => {
    let candidatePrepared;
    let clear = true;
    let reservationIndex = 0;
    for (const reservation of reservations) {
      const currentReservationIndex = reservationIndex;
      reservationIndex += 1;
      let actionIndex = 0;
      for (const other of reservation.actions) {
        const currentActionIndex = actionIndex;
        actionIndex += 1;
        if (!candidatePrepared) candidatePrepared = prepareAction(candidate);
        const otherPrepared = prepareAtPosition(currentReservationIndex, currentActionIndex, other);
        if (!actionsConflictValidated(candidatePrepared.action, otherPrepared.action, 16,
          candidatePrepared, otherPrepared)) continue;
        blockers.add(reservation.actorId);
        clear = false;
        break;
      }
    }
    return clear;
  };
}
