const MAX_FRAME_DELTA_MS = 250;
const TRANSITION_DURATION_MS = 450;

const CLEAN_PICKUP_TASKS = new Set([
  'pickup_service_item',
  'prepare_dish',
  'prepare_drink',
]);
const CLEAN_DELIVERY_TASKS = new Set([
  'deliver_service_item',
  'place_dish_on_service',
]);
const DIRTY_PICKUP_TASKS = new Set([
  'collect_dirty_item',
  'transfer_dirty_item',
]);
const DIRTY_DELIVERY_TASKS = new Set(['deliver_dirty_item']);

function isScalarId(value) {
  return typeof value === 'string' || Number.isFinite(value);
}

function idKey(value) {
  if (typeof value === 'string') return value;
  return Number.isFinite(value) ? String(value) : null;
}

function copyGeneration(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || Number.isFinite(value)) return value;
  return undefined;
}

function copiedIds(value) {
  const ids = Array.isArray(value) ? value : value == null ? [] : [value];
  return new Set(ids.map(idKey).filter(id => id !== null));
}

function copiedCarriedIds(staff) {
  const ids = Array.isArray(staff?.carryingServiceItemIds)
    ? staff.carryingServiceItemIds
    : staff?.carryingServiceItemId == null ? [] : [staff.carryingServiceItemId];
  return copiedIds(ids);
}

function copiedTask(staff) {
  const task = staff?.task && typeof staff.task === 'object' ? staff.task : {};
  return {
    type: typeof task.type === 'string' ? task.type : null,
    serviceItemId: idKey(task.serviceItemId),
    serviceItemIds: copiedIds(task.serviceItemIds),
    batchId: idKey(task.batchId),
    serviceTableId: idKey(task.serviceTableId),
    serviceSlotIndex: Number.isFinite(task.serviceSlotIndex) ? task.serviceSlotIndex : null,
    tableId: idKey(task.tableId),
    customerId: idKey(task.customerId),
    washStationId: idKey(task.washStationId),
    sourceWashStationId: idKey(task.sourceWashStationId),
  };
}

function copyServiceItemIndex(serviceItems) {
  const itemsById = new Map();
  if (!Array.isArray(serviceItems)) return itemsById;

  for (const item of serviceItems) {
    const id = idKey(item?.id);
    if (id === null) continue;
    if (itemsById.has(id)) {
      itemsById.set(id, null);
      continue;
    }
    itemsById.set(id, {
      state: typeof item.state === 'string' ? item.state : null,
      kind: typeof item.kind === 'string' ? item.kind : null,
      assignedStaffId: idKey(item.assignedStaffId),
      batchId: idKey(item.batchId),
      serviceTableId: idKey(item.serviceTableId),
      serviceSlotIndex: Number.isFinite(item.serviceSlotIndex) ? item.serviceSlotIndex : null,
      tableId: idKey(item.tableId),
      customerId: idKey(item.customerId),
      washStationId: idKey(item.washStationId),
      reservedWashStationId: idKey(item.reservedWashStationId),
      foodCancelled: item.foodCancelled === true,
      deliveryProhibited: item.deliveryProhibited === true,
    });
  }

  return itemsById;
}

function isCookBatchTask(task) {
  return task.batchId !== null
    && ['prepare_dish', 'place_dish_on_service'].includes(task.type);
}

function taskReferencesItem(task, itemId) {
  if (isCookBatchTask(task)) {
    return task.serviceItemId !== null
      && task.serviceItemIds.has(task.serviceItemId)
      && task.serviceItemIds.has(itemId);
  }
  return task.serviceItemId === itemId;
}

function taskContextMatches(task, item, itemId, gesture) {
  if (!taskReferencesItem(task, itemId)) return true;
  const completedCookBatchItem = gesture === 'serving'
    && task.type === 'place_dish_on_service'
    && item.state === 'on_service'
    && item.batchId === null;
  if (isCookBatchTask(task) && task.batchId !== item.batchId && !completedCookBatchItem) {
    return false;
  }

  // In a carried cook batch, service-table/slot fields describe the singular
  // task anchor; other members are correlated by batch ID and serviceItemIds.
  if (task.serviceItemId === itemId) {
    if (task.serviceTableId !== null && task.serviceTableId !== item.serviceTableId) return false;
    if (task.serviceSlotIndex !== null && task.serviceSlotIndex !== item.serviceSlotIndex) return false;
    if (task.tableId !== null && task.tableId !== item.tableId) return false;
    if (task.customerId !== null && task.customerId !== item.customerId) return false;
  }

  if (task.type === 'transfer_dirty_item'
    && (task.washStationId === null || task.washStationId !== item.reservedWashStationId)) {
    return false;
  }
  if (gesture === 'depositing' && task.type === 'deliver_dirty_item'
    && (task.washStationId === null || task.washStationId !== item.washStationId)) {
    return false;
  }

  return true;
}

function addedIds(previous, current) {
  const added = [];
  for (const id of current) {
    if (!previous.has(id)) added.push(id);
  }
  return added;
}

function removedIds(previous, current) {
  const removed = [];
  for (const id of previous) {
    if (!current.has(id)) removed.push(id);
  }
  return removed;
}

function matchingTask(previous, current, candidates, itemId) {
  for (const task of [previous.task, current.task]) {
    if (candidates.has(task.type) && taskReferencesItem(task, itemId)) return task;
  }
  return null;
}

function hasConsistentTaskContext(previous, current, item, itemId, gesture) {
  return [previous.task, current.task].every(task =>
    taskContextMatches(task, item, itemId, gesture));
}

function hasExpectedLifecycle(gesture, task, item, itemId, previous, current) {
  if (!item || item.foodCancelled || item.deliveryProhibited
    || !hasConsistentTaskContext(previous, current, item, itemId, gesture)) return false;

  if (gesture === 'pickup') {
    if (task.type === 'pickup_service_item') {
      return current.role === 'waiter'
        && item.state === 'carried'
        && ['dish', 'drink'].includes(item.kind)
        && (item.assignedStaffId === null || item.assignedStaffId === current.actorId)
        && task.serviceTableId !== null
        && item.serviceTableId === task.serviceTableId;
    }
    if (task.type === 'prepare_dish') {
      return current.role === 'cook'
        && item.kind === 'dish'
        && item.state === 'carried'
        && item.assignedStaffId === current.actorId;
    }
    if (task.type === 'prepare_drink') {
      return current.role === 'cook'
        && item.kind === 'drink'
        && item.state === 'carried'
        && item.assignedStaffId === current.actorId
        && task.serviceTableId !== null
        && task.serviceSlotIndex !== null;
    }
  }

  if (gesture === 'collecting') {
    if (task.type === 'collect_dirty_item') {
      return current.role === 'waiter'
        && item.state === 'carried_dirty'
        && (item.assignedStaffId === null || item.assignedStaffId === current.actorId);
    }
    if (task.type === 'transfer_dirty_item') {
      return current.role === 'waiter'
        && item.state === 'carried_dirty'
        && item.assignedStaffId === current.actorId
        && task.washStationId !== null
        && task.sourceWashStationId !== null
        && item.reservedWashStationId === task.washStationId;
    }
  }

  if (gesture === 'serving') {
    if (task.type === 'deliver_service_item') {
      return current.role === 'waiter'
        && item.state === 'delivered'
        && ['dish', 'drink'].includes(item.kind)
        && task.customerId !== null
        && item.customerId === task.customerId;
    }
    if (task.type === 'place_dish_on_service') {
      return current.role === 'cook'
        && item.state === 'on_service'
        && ['dish', 'drink'].includes(item.kind)
        && item.assignedStaffId === null
        && task.serviceTableId !== null
        && task.serviceSlotIndex !== null
        && item.serviceTableId === task.serviceTableId
        && item.serviceSlotIndex === task.serviceSlotIndex;
    }
  }

  if (gesture === 'depositing' && task.type === 'deliver_dirty_item') {
    return current.role === 'waiter'
      && item.state === 'queued_for_wash'
      && task.washStationId !== null
      && item.washStationId === task.washStationId
      && item.assignedStaffId === null
      && item.reservedWashStationId === null;
  }

  return false;
}

function classifyTransition(previous, current, added, removed, serviceItems) {
  const authoritative = serviceItems !== null;

  for (const itemId of added) {
    const dirtyTask = matchingTask(previous, current, DIRTY_PICKUP_TASKS, itemId);
    if (dirtyTask) {
      const item = authoritative ? serviceItems.get(itemId) : null;
      return !authoritative || hasExpectedLifecycle(
        'collecting', dirtyTask, item, itemId, previous, current,
      ) ? 'collecting' : null;
    }

    const cleanTask = matchingTask(previous, current, CLEAN_PICKUP_TASKS, itemId);
    if (cleanTask) {
      const item = authoritative ? serviceItems.get(itemId) : null;
      return !authoritative || hasExpectedLifecycle(
        'pickup', cleanTask, item, itemId, previous, current,
      ) ? 'pickup' : null;
    }
  }

  for (const itemId of removed) {
    const dirtyTask = matchingTask(previous, current, DIRTY_DELIVERY_TASKS, itemId);
    if (dirtyTask) {
      const item = authoritative ? serviceItems.get(itemId) : null;
      return !authoritative || hasExpectedLifecycle(
        'depositing', dirtyTask, item, itemId, previous, current,
      ) ? 'depositing' : null;
    }

    const cleanTask = matchingTask(previous, current, CLEAN_DELIVERY_TASKS, itemId);
    if (cleanTask) {
      const item = authoritative ? serviceItems.get(itemId) : null;
      return !authoritative || hasExpectedLifecycle(
        'serving', cleanTask, item, itemId, previous, current,
      ) ? 'serving' : null;
    }
  }

  return null;
}

export function createCharacterAnimationClock() {
  let animationTime = 0;
  let previousTimestamp = null;
  let previousPaused = null;
  let previousSpeed = null;
  let previousGeneration;
  let hasGenerationBaseline = false;
  let previousGameTime = null;

  function remember(timestamp, paused, speed, generation, gameTime) {
    previousTimestamp = timestamp;
    previousPaused = paused;
    previousSpeed = speed;
    previousGeneration = generation;
    hasGenerationBaseline = true;
    if (gameTime !== null) previousGameTime = gameTime;
  }

  function reset() {
    animationTime = 0;
    previousTimestamp = null;
    previousPaused = null;
    previousSpeed = null;
    previousGeneration = undefined;
    hasGenerationBaseline = false;
    previousGameTime = null;
  }

  function update(timestamp, options = {}) {
    const settings = options && typeof options === 'object' ? options : {};
    const paused = settings.paused === true;
    const speed = Number.isFinite(settings.speed) && settings.speed >= 0
      ? settings.speed
      : 1;
    const generation = copyGeneration(settings.generation);
    const gameTime = Number.isFinite(settings.gameTime) ? settings.gameTime : null;
    const validTimestamp = Number.isFinite(timestamp) && timestamp >= 0;
    const generationChanged = hasGenerationBaseline
      && !Object.is(generation, previousGeneration);
    const gameTimeRewound = gameTime !== null
      && previousGameTime !== null
      && gameTime < previousGameTime;
    const timestampRewound = validTimestamp
      && previousTimestamp !== null
      && timestamp < previousTimestamp;

    if (generationChanged || gameTimeRewound || timestampRewound) {
      animationTime = 0;
      remember(validTimestamp ? timestamp : null, paused, speed, generation, gameTime);
      return animationTime;
    }

    if (!validTimestamp) {
      remember(null, paused, speed, generation, gameTime);
      return animationTime;
    }

    if (previousTimestamp === null) {
      remember(timestamp, paused, speed, generation, gameTime);
      return animationTime;
    }

    const delta = timestamp - previousTimestamp;
    const stateChanged = paused !== previousPaused || speed !== previousSpeed;
    if (delta <= MAX_FRAME_DELTA_MS && !stateChanged && !paused) {
      const scaledDelta = delta * speed;
      const nextTime = animationTime + scaledDelta;
      if (Number.isFinite(nextTime)) animationTime = nextTime;
    }

    remember(timestamp, paused, speed, generation, gameTime);
    return animationTime;
  }

  return { update, reset };
}

export function createCharacterTransitionHistory() {
  let actors = new Map();
  let lastTimeMs = null;
  let previousGeneration;
  let hasObserved = false;
  let previousGameTime = null;

  function reset() {
    actors.clear();
    lastTimeMs = null;
    previousGeneration = undefined;
    hasObserved = false;
    previousGameTime = null;
  }

  /**
   * `options.serviceItems`, when present, provides authoritative current item
   * lifecycles for gesture validation. Omitting it keeps the original
   * task/inventory-only calling convention for callers without world items.
   */
  function update(staff, timeMs, options = {}) {
    const settings = options && typeof options === 'object' ? options : {};
    const generation = copyGeneration(settings.generation);
    const gameTime = Number.isFinite(settings.gameTime) ? settings.gameTime : null;
    const hasAuthoritativeItems = Object.prototype.hasOwnProperty.call(settings, 'serviceItems');
    const serviceItems = hasAuthoritativeItems
      ? copyServiceItemIndex(settings.serviceItems)
      : null;
    const validTime = Number.isFinite(timeMs) && timeMs >= 0;
    const resetForGeneration = hasObserved && !Object.is(generation, previousGeneration);
    const resetForAnimationRewind = hasObserved
      && validTime
      && lastTimeMs !== null
      && timeMs < lastTimeMs;
    const resetForGameRewind = hasObserved
      && gameTime !== null
      && previousGameTime !== null
      && gameTime < previousGameTime;
    const resetRequired = resetForGeneration || resetForAnimationRewind || resetForGameRewind;

    if (resetRequired) actors.clear();

    const nextActors = new Map();
    const gestures = new Map();
    const list = Array.isArray(staff) ? staff : [];

    for (const actor of list) {
      const id = actor?.id;
      if (!isScalarId(id) || nextActors.has(id)) continue;

      const current = {
        task: copiedTask(actor),
        role: typeof actor?.role === 'string' ? actor.role : null,
        actorId: idKey(id),
        carriedIds: copiedCarriedIds(actor),
        gesture: null,
        expiresAt: null,
      };
      const previous = actors.get(id);

      if (validTime && !resetRequired && previous) {
        const detectedGesture = classifyTransition(
          previous,
          current,
          addedIds(previous.carriedIds, current.carriedIds),
          removedIds(previous.carriedIds, current.carriedIds),
          serviceItems,
        );
        if (detectedGesture) {
          const expiresAt = timeMs + TRANSITION_DURATION_MS;
          if (Number.isFinite(expiresAt)) {
            current.gesture = detectedGesture;
            current.expiresAt = expiresAt;
          }
        } else if (previous.gesture && timeMs < previous.expiresAt) {
          current.gesture = previous.gesture;
          current.expiresAt = previous.expiresAt;
        }
      }

      if (validTime && current.gesture && timeMs < current.expiresAt) {
        gestures.set(id, current.gesture);
      } else {
        current.gesture = null;
        current.expiresAt = null;
      }
      nextActors.set(id, current);
    }

    actors = nextActors;
    if (validTime) lastTimeMs = timeMs;
    else lastTimeMs = null;
    previousGeneration = generation;
    if (gameTime !== null) previousGameTime = gameTime;
    hasObserved = true;

    return gestures;
  }

  return { update, reset };
}
