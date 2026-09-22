import { getResolvedDrink } from '../data/drinks';
import { getOrderSnapshotSubtotal } from './menuEconomy';
import { getPartyKey } from './partyReviews';
import { applyCookbookPaidVisit, reconcileCookbookDiscoveries, validateDishOrderSnapshots } from './cookbook';
import { applyCareerPaidVisit, isCareerDecisionPending } from './careerRun';
import { recordServiceContractPaidVisit } from './serviceContracts';

const isId = value => typeof value === 'string' && value.trim().length > 0;
const isAmount = value => Number.isFinite(value) && value >= 0;
const isSequence = value => Number.isSafeInteger(value) && value >= 0;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function requireFact(condition, message) {
  if (!condition) throw new Error(`Invalid paid visit: ${message}`);
}

/** The existing monetary tuple is authoritative; live prices are legacy-only. */
export function getCheckoutBill(state, customer) {
  const hasSnapshot = has(customer, 'dishOrderSnapshot');
  if (hasSnapshot) {
    try {
      validateDishOrderSnapshots(state);
    } catch (error) {
      throw new Error(`Invalid paid visit: ${error.message}`);
    }
    requireFact(customer.menuOutcome === 'ordered', 'snapshotted food was not ordered');
    requireFact(customer.foodOutcome == null
      || ['delivered', 'cancelled', 'pending', 'unknown'].includes(customer.foodOutcome), 'food outcome');
    const snapshot = customer.dishOrderSnapshot;
    if (has(customer, 'orderedServiceItemIds')) {
      requireFact(Array.isArray(customer.orderedServiceItemIds)
        && customer.orderedServiceItemIds.includes(snapshot.serviceItemId), 'snapshot is not part of the committed order');
    }
    const item = (state.serviceItems || []).find(candidate => candidate.id === snapshot.serviceItemId);
    const cancelled = (customer.cancelledServiceItemIds || []).includes(snapshot.serviceItemId)
      || Number.isFinite(customer.foodCancelledAt) || item?.foodCancelled === true;
    requireFact(!cancelled || customer.foodOutcome === 'cancelled', 'cancelled food cannot be fulfilled');
  } else {
    requireFact(!(state.serviceItems || []).some(item => item.customerId === customer.id
      && item.kind === 'dish' && has(item, 'dishOrderSnapshot')), 'missing customer snapshot copy');
  }
  const snapshottedSubtotal = getOrderSnapshotSubtotal(customer);
  requireFact(!hasSnapshot || snapshottedSubtotal !== null, 'inconsistent committed bill');
  const dishAmount = snapshottedSubtotal !== null ? customer.dishPriceAtOrder ?? 0
    : (state.dishes || []).find(dish => dish.id === customer.dishId)?.price || 0;
  const drinkAmount = snapshottedSubtotal !== null ? customer.drinkPriceAtOrder ?? 0
    : getResolvedDrink(state, customer.drinkId)?.price || 0;
  requireFact(isAmount(dishAmount) && isAmount(drinkAmount), 'negative or non-finite bill line');
  return { subtotal: snapshottedSubtotal ?? dishAmount + drinkAmount, dishAmount,
    priceAtOrder: snapshottedSubtotal !== null ? customer.dishPriceAtOrder : null };
}

/**
 * One synchronous, pure boundary. Caller appends the original monetary receipt
 * and review/served/leaving effects in the same returned transition. No outbox.
 * Throwing reaches the existing SimulationRuntime diagnostic stop before commit.
 */
export function commitPaidVisit(state, { customer, payment, paidAt }) {
  if (isCareerDecisionPending(state)) return { state, outcome: null };
  const sequence = state.paidVisitSequence === undefined ? 0 : state.paidVisitSequence;
  requireFact(isSequence(sequence), 'shared sequence');
  const live = (state.customers || []).find(candidate => candidate.id === customer?.id);
  requireFact(live && isId(live.id), 'missing authoritative customer');
  if (live.paidVisitSequence != null) {
    requireFact(isSequence(live.paidVisitSequence) && live.paidVisitSequence > 0
      && live.paidVisitSequence <= sequence, 'customer sequence');
    return { state, outcome: null };
  }
  // Pending pre-feature receipts already own their monetary transition, never replay features.
  if ((state.completedCustomers || []).some(receipt => receipt.customerId === live.id)) return { state, outcome: null };
  requireFact(sequence < Number.MAX_SAFE_INTEGER, 'sequence exhausted');
  requireFact(live.menuOutcome == null || live.menuOutcome === 'ordered', 'menu outcome');
  requireFact(live.foodOutcome == null
    || ['delivered', 'cancelled', 'pending', 'none', 'unknown'].includes(live.foodOutcome), 'food outcome');
  requireFact(isAmount(paidAt) && paidAt === state.restaurant?.gameTime, 'payment time');
  requireFact(payment?.customerId === live.id && isAmount(payment.tip)
    && isAmount(payment.totalPaid) && payment.revenue === payment.totalPaid, 'payment totals/owner');
  requireFact(['dishId', 'drinkId'].every(key => !has(payment, key) || payment[key] === live[key]),
    'payment line identity');
  const bill = getCheckoutBill(state, live);
  requireFact(payment.totalPaid === bill.subtotal + payment.tip, 'payment differs from committed bill');
  const partyId = getPartyKey(live);
  requireFact(isId(partyId), 'party identity');
  const serviceContractId = live.serviceContractId ?? null;
  const serviceContractGuestId = live.serviceContractGuestId ?? null;
  requireFact([serviceContractId, serviceContractGuestId].every(id => id === null || isId(id))
    && (serviceContractId === null) === (serviceContractGuestId === null)
    && (serviceContractGuestId === null || serviceContractGuestId === live.id), 'booking identity');

  let dish = null;
  let foodOutcome = 'none';
  if (has(live, 'dishOrderSnapshot')) {
    const snapshot = live.dishOrderSnapshot;
    foodOutcome = live.foodOutcome ?? 'unknown';
    const fulfilled = foodOutcome === 'delivered';
    requireFact(foodOutcome !== 'cancelled' || bill.dishAmount === 0, 'cancelled dish charged');
    dish = { serviceItemId: snapshot.serviceItemId, menuItemId: snapshot.menuItemId,
      cookbookId: snapshot.cookbookId, priceAtOrder: snapshot.price, chargedAmount: bill.dishAmount,
      fulfilled, paid: fulfilled && bill.dishAmount > 0 };
  } else if (isId(live.dishId)) {
    // Even a legacy delivered flag does not establish complete committed provenance.
    foodOutcome = 'unknown';
    const item = (state.serviceItems || []).find(candidate => candidate.kind === 'dish'
      && candidate.customerId === live.id && candidate.menuItemId === live.dishId);
    dish = { serviceItemId: isId(item?.id) ? item.id : null, menuItemId: live.dishId,
      cookbookId: null, priceAtOrder: bill.priceAtOrder, chargedAmount: bill.dishAmount,
      fulfilled: false, paid: false };
  } else if (live.foodOutcome != null && live.foodOutcome !== 'none') {
    foodOutcome = 'unknown';
  }
  const outcome = { schemaVersion: 1, sequence: sequence + 1, customerId: live.id, partyId, paidAt,
    menuOutcome: live.menuOutcome === 'ordered' ? 'ordered' : null, foodOutcome,
    serviceContractId, serviceContractGuestId, dish,
    subtotal: bill.subtotal, tip: payment.tip, totalPaid: payment.totalPaid };

  let next = { ...state, paidVisitSequence: outcome.sequence,
    customers: state.customers.map(candidate => candidate === live ? { ...candidate, paidVisitSequence: outcome.sequence } : candidate) };
  if (state.cookbook) {
    next = { ...next, cookbook: applyCookbookPaidVisit(state.cookbook, outcome) };
    next = { ...next, cookbook: reconcileCookbookDiscoveries(next) };
  }
  if (state.careerRun) next = { ...next, careerRun: applyCareerPaidVisit(state.careerRun, outcome) };
  if (state.serviceContracts) next = recordServiceContractPaidVisit(next, outcome);
  return { state: next, outcome };
}
