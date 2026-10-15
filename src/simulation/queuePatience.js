import { getCustomerPatience } from './balance';

export function getPatienceMax(customer) {
  if (Number.isFinite(customer.patienceMax) && customer.patienceMax > 0) {
    return customer.patienceMax;
  }
  const archetypePatience = getCustomerPatience(customer.archetype, customer.partySize);
  if (Number.isFinite(archetypePatience) && archetypePatience > 0) return archetypePatience;
  return Math.max(0, Number(customer.patience) || 0);
}

export function getQueuePatience(customer) {
  return Number.isFinite(customer.queuePatience) ? customer.queuePatience : customer.patience;
}

export function getQueuePatienceMax(customer) {
  if (Number.isFinite(customer.queuePatienceMax) && customer.queuePatienceMax > 0) {
    return customer.queuePatienceMax;
  }
  return getPatienceMax(customer);
}
