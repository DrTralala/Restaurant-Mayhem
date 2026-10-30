// Checkout and departure residency are separate policies, not seated states.
export const PHYSICALLY_SEATED_CUSTOMER_STATES = Object.freeze([
  'seated', 'ordering', 'waiting_for_items', 'waiting_for_party', 'eating',
]);

const physicallySeatedStates = new Set(PHYSICALLY_SEATED_CUSTOMER_STATES);

export function isPhysicallySeatedCustomerState(state) {
  return physicallySeatedStates.has(state);
}
