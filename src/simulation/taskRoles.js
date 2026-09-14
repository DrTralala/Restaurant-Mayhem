const TASKS_BY_ROLE = Object.freeze({
  cook: new Set([
    'prepare_drink', 'prepare_dish', 'place_dish_on_service', 'handoff_cancelled_waste',
  ]),
  waiter: new Set([
    'take_order', 'take_payment', 'pickup_service_item', 'deliver_service_item',
    'handoff_cancelled_waste',
  ]),
  janitor: new Set([
    'clean_table', 'clean_floor', 'wash_item', 'collect_dirty_item',
    'clean_service_item', 'transfer_dirty_item', 'deliver_dirty_item',
  ]),
});

/**
 * Keep the task role matrix at the state and runtime boundaries in sync.
 * Missing roles remain compatible with small versionless unit fixtures; actual
 * staff records always carry one of the recognised roles.
 */
export function isStaffTaskRoleAllowed(task, role) {
  if (!task || role == null) return true;
  return TASKS_BY_ROLE[role]?.has(task.type) === true;
}

export function getStaffTaskRoles() {
  return TASKS_BY_ROLE;
}
