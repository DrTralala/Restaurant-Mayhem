import { SERVICE_CONTRACTS, SERVICE_CONTRACT_PREP_SECONDS, SERVICE_CONTRACT_RESULT_LIMIT,
  SERVICE_CONTRACT_RULES_VERSION, getServiceContractTemplate } from '../data/serviceContracts';
import { isRestaurantOpen } from './clock';
import { normaliseCustomerQueue, QUEUE_PARTY_CAPACITY } from './customerQueue';

const nonnegative = value => Number.isFinite(value) && value >= 0;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.length > 0;
const pendingDecision = state => state.careerRun?.needsDecision === true;
const unresolved = guest => guest.status === 'scheduled' || guest.status === 'pending';
const fulfilledCount = guests => guests.filter(guest => guest.status === 'fulfilled_paid').length;
const missedReasons = ['missed_closed', 'missed_queue_full', 'missed_identity_conflict', 'missed_resume'];
const failedReasons = ['food_cancelled', 'menu_unaffordable', 'abandoned', 'closed', 'left_unpaid', 'missing_guest'];
const nonfulfilledReasons = ['drink_only', 'food_cancelled', 'unverified_food'];

export function createServiceContractsState() {
  return { version: 1, nextInstanceSerial: 1, lastAcceptedDayByTemplate: {}, active: null, results: [] };
}

function previewFor(template, acceptedAt) {
  const serviceStartAt = acceptedAt + SERVICE_CONTRACT_PREP_SECONDS;
  return { acceptedAt, serviceStartAt, deadlineAt: serviceStartAt + template.serviceDuration,
    partyArrivals: template.parties.map(party => serviceStartAt + party.arrivalOffset) };
}

function readinessWarnings(state, template, preview) {
  const warnings = [];
  if (preview.partyArrivals.some(gameTime => !isRestaurantOpen({ ...state,
    restaurant: { ...state.restaurant, gameTime } }))) warnings.push('closed_at_arrival');
  if (normaliseCustomerQueue(state.queue).length >= QUEUE_PARTY_CAPACITY) warnings.push('queue_full');
  if (!(state.dishes || []).some(dish => nonnegative(dish.price)
    && dish.price <= template.profile.spendingBudget)) warnings.push('no_affordable_dish');
  const largestParty = Math.max(...template.parties.map(party => party.size));
  if (!(state.tables || []).some(table => Number.isFinite(table.x) && Number.isFinite(table.y)
    && (state.chairs || []).filter(chair => chair.tableId === table.id
      && Number.isFinite(chair.x) && Number.isFinite(chair.y)).length >= largestParty)) {
    warnings.push('no_suitable_table');
  }
  const staff = state.staff || [];
  if (!staff.some(person => person.role === 'cook')) warnings.push('no_cook');
  if (!staff.some(person => person.role === 'waiter')) warnings.push('no_waiter');
  if (!(state.cashierStations || []).some(station => staff.some(person =>
    person.id === station.assignedStaffId && person.role === 'waiter'))) warnings.push('no_staffed_checkout');
  return warnings;
}

export function getServiceContractOffer(state, templateId) {
  const template = getServiceContractTemplate(templateId);
  const branch = state.serviceContracts || createServiceContractsState();
  const { gameTime, day } = state.restaurant || {};
  const preview = template && nonnegative(gameTime) ? previewFor(template, gameTime) : null;
  let blockedReason = null;
  if (!template) blockedReason = 'unknown_template';
  else if (pendingDecision(state)) blockedReason = 'career_decision';
  else if (state.navigationFault) blockedReason = 'navigation_fault';
  else if (!nonnegative(gameTime) || !positiveInteger(day) || !nonnegative(preview.deadlineAt)
    || preview.serviceStartAt <= gameTime || preview.deadlineAt <= preview.serviceStartAt) blockedReason = 'invalid_clock';
  else if (!positiveInteger(branch.nextInstanceSerial)
    || branch.nextInstanceSerial >= Number.MAX_SAFE_INTEGER) blockedReason = 'serial_exhausted';
  else if (branch.active) blockedReason = 'active_contract';
  else if (branch.lastAcceptedDayByTemplate[templateId] === day) blockedReason = 'used_today';
  return { template, canAccept: blockedReason === null, blockedReason,
    warnings: preview ? readinessWarnings(state, template, preview) : [], preview };
}

function createRoster(template, instanceId, serviceStartAt) {
  const guests = [];
  const parties = template.parties.map((party, index) => {
    const partyId = `${instanceId}-p${index + 1}`;
    const guestIds = [];
    for (let member = 0; member < party.size; member++) {
      const guestIndex = guests.length;
      const guestId = `${instanceId}-g${guestIndex + 1}`;
      guestIds.push(guestId);
      guests.push({ guestId, partyId, label: `${template.guestLabel} ${guestIndex + 1}`,
        ...template.profile, gender: guestIndex % 2 ? 'male' : 'female',
        status: 'scheduled', reason: null, paidVisitSequence: null, resolvedAt: null });
    }
    return { partyId, ...party, arrivalAt: serviceStartAt + party.arrivalOffset, guestIds,
      status: 'scheduled', admittedAt: null, missedReason: null };
  });
  return { parties, guests };
}

export function acceptServiceContract(state, { templateId } = {}) {
  const offer = getServiceContractOffer(state, templateId);
  if (!offer.canAccept) return state;
  const branch = state.serviceContracts || createServiceContractsState();
  const { template, preview } = offer;
  const instanceId = `sc-${branch.nextInstanceSerial}`;
  const active = { instanceId, templateId, rulesVersion: SERVICE_CONTRACT_RULES_VERSION,
    acceptedDay: state.restaurant.day, acceptedAt: preview.acceptedAt,
    serviceStartAt: preview.serviceStartAt, deadlineAt: preview.deadlineAt,
    phase: 'preparing', target: template.target, reward: template.reward,
    ...createRoster(template, instanceId, preview.serviceStartAt) };
  return { ...state, serviceContracts: { ...branch, active,
    nextInstanceSerial: branch.nextInstanceSerial + 1,
    lastAcceptedDayByTemplate: { ...branch.lastAcceptedDayByTemplate, [templateId]: state.restaurant.day } } };
}

function withActive(state, active) {
  return active === state.serviceContracts.active ? state
    : { ...state, serviceContracts: { ...state.serviceContracts, active } };
}

function finishContract(state, active, status, now) {
  const count = fulfilledCount(active.guests);
  const bonusPaid = status === 'succeeded' ? active.reward : 0;
  const result = { instanceId: active.instanceId, templateId: active.templateId,
    acceptedDay: active.acceptedDay, acceptedAt: active.acceptedAt, serviceStartAt: active.serviceStartAt,
    deadlineAt: active.deadlineAt, settledAt: now, status, target: active.target, reward: active.reward,
    bonusPaid, fulfilledCount: count,
    guestResults: active.guests.map(({ guestId, partyId, status: guestStatus, reason, paidVisitSequence, resolvedAt }) =>
      ({ guestId, partyId, status: guestStatus, reason, paidVisitSequence, resolvedAt })) };
  const title = getServiceContractTemplate(active.templateId).title;
  return { ...state,
    restaurant: bonusPaid ? { ...state.restaurant, funds: state.restaurant.funds + bonusPaid,
      dailyRevenue: state.restaurant.dailyRevenue + bonusPaid } : state.restaurant,
    serviceContracts: { ...state.serviceContracts, active: null,
      results: [...state.serviceContracts.results, result].slice(-SERVICE_CONTRACT_RESULT_LIMIT) },
    notifications: [...(state.notifications || []).filter(notification =>
      !String(notification.id).startsWith('service-contract-result:')),
    { id: `service-contract-result:${active.instanceId}`,
      message: `${title}: ${status}. ${count}/${active.target} fulfilled meals. ${bonusPaid ? `Bonus $${bonusPaid}.` : 'No contract bonus.'}`,
      time: now }] };
}

export function withdrawServiceContract(state, { instanceId } = {}) {
  const active = state.serviceContracts?.active;
  if (!active || active.instanceId !== instanceId || pendingDecision(state)) return state;
  const now = state.restaurant.gameTime;
  // An expired saved contract belongs to guarded tick-entry settlement. A
  // stale UI action must neither overwrite its result nor bypass pause/faults.
  if (now >= active.deadlineAt) return state;
  return finishContract(state, { ...active, guests: active.guests.map(guest => unresolved(guest)
    ? { ...guest, status: 'withdrawn', reason: 'withdrawn', resolvedAt: now } : guest) }, 'withdrawn', now);
}

export function getNextServiceContractBoundary(state, fromTime, toTime) {
  const active = state.serviceContracts?.active;
  if (!active || !nonnegative(fromTime) || !nonnegative(toTime)) return null;
  const times = [active.serviceStartAt, active.deadlineAt,
    ...active.parties.filter(party => party.status === 'scheduled').map(party => party.arrivalAt)]
    .filter(time => time > fromTime && time <= toTime);
  return times.length ? Math.min(...times) : null;
}

function markMissed(active, partyId, reason) {
  const party = active.parties.find(row => row.partyId === partyId);
  return { ...active,
    parties: active.parties.map(row => row === party ? { ...row, status: 'missed', missedReason: reason } : row),
    guests: active.guests.map(guest => guest.partyId === partyId
      ? { ...guest, status: 'missed', reason, resolvedAt: party.arrivalAt } : guest) };
}

export function advanceServiceContractArrivals(state, now, { admitParty } = {}) {
  let active = state.serviceContracts?.active;
  if (!active || pendingDecision(state) || !nonnegative(now) || now < active.acceptedAt) return state;
  if (now > active.deadlineAt) return settleServiceContracts(state, now);
  // At an endpoint, checkout still follows this hook. Entry repair is the
  // parent's separate settle-before-arrivals call, including exact-deadline loads.
  if (now === active.deadlineAt) return state;
  let next = state;
  if (now >= active.serviceStartAt && active.phase !== 'service') active = { ...active, phase: 'service' };
  for (const party of active.parties) {
    if (party.status !== 'scheduled' || party.arrivalAt > now) continue;
    if (party.arrivalAt < now) {
      active = markMissed(active, party.partyId, 'missed_resume');
      continue;
    }
    const booking = { instanceId: active.instanceId, partyId: party.partyId,
      partyType: party.partyType, arrivalAt: party.arrivalAt,
      members: active.guests.filter(guest => guest.partyId === party.partyId).map(guest => ({
        id: guest.guestId, serviceContractGuestId: guest.guestId, archetype: guest.archetype,
        gender: guest.gender, spendingTier: guest.spendingTier, spendingBudget: guest.spendingBudget,
      })) };
    const result = admitParty(withActive(next, active), booking);
    if (result.admitted) {
      next = result.state;
      active = { ...active,
        parties: active.parties.map(row => row.partyId === party.partyId
          ? { ...row, status: 'admitted', admittedAt: now } : row),
        guests: active.guests.map(guest => guest.partyId === party.partyId ? { ...guest, status: 'pending' } : guest) };
    } else {
      if (!['closed', 'queue_full', 'identity_conflict'].includes(result.reason)) {
        throw new Error('Invalid service contract admission reason');
      }
      active = markMissed(active, party.partyId, `missed_${result.reason}`);
    }
  }
  return withActive(next, active);
}

function validOutcome(outcome) {
  if (!outcome || outcome.schemaVersion !== 1 || !positiveInteger(outcome.sequence)
    || !text(outcome.customerId) || !text(outcome.partyId) || !nonnegative(outcome.paidAt)
    || ![null, 'ordered'].includes(outcome.menuOutcome)
    || !['delivered', 'cancelled', 'pending', 'none', 'unknown'].includes(outcome.foodOutcome)
    || !(outcome.serviceContractId === null || text(outcome.serviceContractId))
    || !(outcome.serviceContractGuestId === null || text(outcome.serviceContractGuestId))
    || !nonnegative(outcome.subtotal) || !nonnegative(outcome.tip)
    || !nonnegative(outcome.totalPaid) || outcome.totalPaid !== outcome.subtotal + outcome.tip) return false;
  const dish = outcome.dish;
  if (dish === null) return outcome.foodOutcome === 'none' || outcome.foodOutcome === 'unknown';
  if (!dish || !(dish.serviceItemId === null || text(dish.serviceItemId)) || !text(dish.menuItemId)
    || !(dish.cookbookId === null || text(dish.cookbookId))
    || !(dish.priceAtOrder === null || nonnegative(dish.priceAtOrder)) || !nonnegative(dish.chargedAmount)
    || dish.chargedAmount > outcome.subtotal || typeof dish.fulfilled !== 'boolean' || typeof dish.paid !== 'boolean'
    || dish.paid !== (dish.fulfilled && dish.chargedAmount > 0)) return false;
  if (dish.fulfilled && outcome.foodOutcome !== 'delivered') return false;
  if (outcome.foodOutcome === 'cancelled' && (dish.fulfilled || dish.chargedAmount !== 0)) return false;
  return true;
}

export function recordServiceContractPaidVisit(state, outcome) {
  const active = state.serviceContracts?.active;
  if (!active || pendingDecision(state) || !validOutcome(outcome)
    || outcome.serviceContractId !== active.instanceId || outcome.paidAt > active.deadlineAt
    || outcome.paidAt > state.restaurant.gameTime || outcome.sequence > (state.paidVisitSequence ?? 0)
    || outcome.customerId !== outcome.serviceContractGuestId) return state;
  const guest = active.guests.find(row => row.guestId === outcome.customerId);
  const party = active.parties.find(row => row.partyId === outcome.partyId);
  if (!guest || guest.status !== 'pending' || guest.partyId !== outcome.partyId
    || !party || party.status !== 'admitted' || outcome.paidAt < party.admittedAt) return state;
  const retainedRows = [...active.guests, ...state.serviceContracts.results.flatMap(result => result.guestResults)];
  if (retainedRows.some(row => row.paidVisitSequence === outcome.sequence)) return state;
  const qualifies = outcome.dish?.fulfilled === true && outcome.dish.paid === true && outcome.dish.chargedAmount > 0;
  const reason = qualifies ? null : outcome.foodOutcome === 'cancelled' ? 'food_cancelled'
    : outcome.dish === null && outcome.foodOutcome === 'none' ? 'drink_only' : 'unverified_food';
  return withActive(state, { ...active, guests: active.guests.map(row => row === guest ? { ...row,
    status: qualifies ? 'fulfilled_paid' : 'not_fulfilled', reason,
    paidVisitSequence: qualifies ? outcome.sequence : null, resolvedAt: outcome.paidAt } : row) });
}

function liveGuests(state) {
  // Keep raw member identities: queue normalisation deliberately rewrites
  // partyId, which would conceal a corrupted saved membership here.
  return [...(state.queue || []).flatMap(entry => Array.isArray(entry?.members) ? entry.members : [entry]),
    ...(state.customers || []), ...(state.queueDepartures || [])];
}

function failureReason(actor) {
  if (!actor) return 'missing_guest';
  if (actor.foodOutcome === 'cancelled') return 'food_cancelled';
  if (actor.menuOutcome === 'unaffordable') return 'menu_unaffordable';
  if (actor.departureReason === 'closed' || actor.departureReason === 'abandoned') return actor.departureReason;
  if (actor.state === 'leaving') {
    if (Number.isFinite(actor.closedAt)) return 'closed';
    if (actor.reputationApplied === true && Number.isFinite(actor.queuePatience) && actor.queuePatience <= 0) return 'abandoned';
    return 'left_unpaid';
  }
  return null;
}

export function settleServiceContracts(state, now) {
  let active = state.serviceContracts?.active;
  if (!active || pendingDecision(state) || !nonnegative(now) || now < active.acceptedAt) return state;
  const due = now >= active.deadlineAt;
  if (due) {
    for (const party of active.parties) {
      if (party.status === 'scheduled') active = markMissed(active, party.partyId, 'missed_resume');
    }
  }
  // Overdue resume uses only persisted progress, not post-deadline world observations.
  const actors = now <= active.deadlineAt ? liveGuests(state) : [];
  const guests = active.guests.map(guest => {
    if (guest.status !== 'pending') return guest;
    const actor = actors.find(row => row.id === guest.guestId);
    const reason = now <= active.deadlineAt ? failureReason(actor) : null;
    if (reason) return { ...guest, status: 'failed', reason, resolvedAt: now };
    return due ? { ...guest, status: 'unfinished', reason: 'deadline', resolvedAt: active.deadlineAt } : guest;
  });
  const phase = now < active.serviceStartAt ? 'preparing' : 'service';
  if (phase !== active.phase || guests.some((guest, index) => guest !== active.guests[index])) {
    active = { ...active, guests, phase };
  }
  if (due) return finishContract(state, active, fulfilledCount(active.guests) >= active.target ? 'succeeded' : 'failed', now);
  return withActive(state, active);
}

export function selectServiceContractView(state) {
  const branch = state.serviceContracts || createServiceContractsState();
  const source = branch.active;
  const now = state.restaurant?.gameTime || 0;
  const active = source ? { ...source, title: getServiceContractTemplate(source.templateId).title,
    fulfilledCount: fulfilledCount(source.guests), targetMet: fulfilledCount(source.guests) >= source.target,
    admittedCount: source.parties.filter(party => party.status === 'admitted').reduce((n, party) => n + party.size, 0),
    totalGuests: source.guests.length, unresolvedCount: source.guests.filter(unresolved).length,
    failedCount: source.guests.filter(guest => ['failed', 'not_fulfilled'].includes(guest.status)).length,
    missedCount: source.guests.filter(guest => guest.status === 'missed').length,
    remainingSeconds: Math.max(0, source.deadlineAt - now),
    preparationSeconds: Math.max(0, source.serviceStartAt - now),
    nextArrivalAt: source.parties.find(party => party.status === 'scheduled')?.arrivalAt ?? null,
    decisionPending: pendingDecision(state) } : null;
  return { active, latestResult: branch.results.at(-1) || null, results: branch.results,
    offers: SERVICE_CONTRACTS.map(template => getServiceContractOffer(state, template.id)) };
}

function check(condition, detail) {
  if (!condition) throw new Error(`Invalid service contract state: ${detail}`);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, detail) {
  check(object(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)), detail);
}

function instanceSerial(instanceId) {
  const match = typeof instanceId === 'string' && /^sc-([1-9]\d*)$/.exec(instanceId);
  const serial = match ? Number(match[1]) : NaN;
  check(positiveInteger(serial), 'instance identity');
  return serial;
}

const commonKeys = ['instanceId', 'templateId', 'acceptedDay', 'acceptedAt', 'serviceStartAt', 'deadlineAt', 'target', 'reward'];
const ledgerKeys = ['guestId', 'partyId', 'status', 'reason', 'paidVisitSequence', 'resolvedAt'];

export function validateServiceContractsState(value, state) {
  if (value === undefined) return;
  exactKeys(value, ['version', 'nextInstanceSerial', 'lastAcceptedDayByTemplate', 'active', 'results'], 'branch shape');
  check(value.version === 1 && positiveInteger(value.nextInstanceSerial), 'version/serial');
  check(object(value.lastAcceptedDayByTemplate) && Object.keys(value.lastAcceptedDayByTemplate).length <= 3, 'day markers');
  const now = state.restaurant.gameTime;
  const day = state.restaurant.day;
  const maxSequence = state.paidVisitSequence ?? 0;
  const sequences = new Set();
  const instances = new Set();
  const acceptanceDays = new Set();
  let previousSerial = 0;
  let previousSettledAt = 0;
  const actors = liveGuests(state);
  for (const [templateId, acceptedDay] of Object.entries(value.lastAcceptedDayByTemplate)) {
    check(getServiceContractTemplate(templateId) && positiveInteger(acceptedDay) && acceptedDay <= day, 'acceptance day marker');
  }
  check(Array.isArray(value.results) && value.results.length <= SERVICE_CONTRACT_RESULT_LIMIT, 'result bound');

  function validateInstance(instance, isActive) {
    exactKeys(instance, [...commonKeys, ...(isActive
      ? ['rulesVersion', 'phase', 'parties', 'guests']
      : ['settledAt', 'status', 'bonusPaid', 'fulfilledCount', 'guestResults'])], 'instance shape');
    const serial = instanceSerial(instance.instanceId);
    check(serial < value.nextInstanceSerial && !instances.has(instance.instanceId), 'duplicate/exhausted instance');
    check(serial > previousSerial && instance.acceptedAt >= previousSettledAt, 'instance chronology');
    previousSerial = serial;
    previousSettledAt = isActive ? instance.acceptedAt : instance.settledAt;
    instances.add(instance.instanceId);
    const template = getServiceContractTemplate(instance.templateId);
    check(template, 'unknown template');
    check(positiveInteger(instance.acceptedDay) && instance.acceptedDay <= day
      && value.lastAcceptedDayByTemplate[instance.templateId] >= instance.acceptedDay, 'accepted day');
    const acceptanceKey = `${instance.templateId}:${instance.acceptedDay}`;
    check(!acceptanceDays.has(acceptanceKey), 'repeated daily attempt');
    acceptanceDays.add(acceptanceKey);
    if (isActive) check(value.lastAcceptedDayByTemplate[instance.templateId] === instance.acceptedDay, 'active day marker');
    check(nonnegative(instance.acceptedAt) && instance.acceptedAt <= now
      && nonnegative(instance.serviceStartAt) && nonnegative(instance.deadlineAt)
      && instance.serviceStartAt === instance.acceptedAt + SERVICE_CONTRACT_PREP_SECONDS
      && instance.deadlineAt === instance.serviceStartAt + template.serviceDuration
      && instance.serviceStartAt > instance.acceptedAt && instance.deadlineAt > instance.serviceStartAt, 'schedule');
    check(instance.target === template.target && instance.reward === template.reward, 'target/reward');
    const expected = createRoster(template, instance.instanceId, instance.serviceStartAt);
    const rows = isActive ? instance.guests : instance.guestResults;
    check(Array.isArray(rows) && rows.length === expected.guests.length, 'guest count');
    if (isActive) {
      check(instance.rulesVersion === SERVICE_CONTRACT_RULES_VERSION
        && ['preparing', 'service'].includes(instance.phase), 'rules/phase');
      check(instance.phase !== 'service' || now >= instance.serviceStartAt, 'future service phase');
      check(Array.isArray(instance.parties) && instance.parties.length === expected.parties.length, 'party count');
      instance.parties.forEach((party, index) => {
        exactKeys(party, Object.keys(expected.parties[index]), 'party shape');
        const original = expected.parties[index];
        for (const key of ['partyId', 'partyType', 'size', 'arrivalOffset', 'arrivalAt']) check(party[key] === original[key], `party ${key}`);
        check(Array.isArray(party.guestIds) && party.guestIds.length === original.guestIds.length
          && party.guestIds.every((id, i) => id === original.guestIds[i]), 'party membership');
        check(['scheduled', 'admitted', 'missed'].includes(party.status), 'party status');
        check(party.status === 'admitted' ? party.admittedAt === party.arrivalAt && party.admittedAt <= now
          : party.admittedAt === null, 'admission time');
        check(party.status === 'missed' ? missedReasons.includes(party.missedReason) && party.arrivalAt <= now
          : party.missedReason === null, 'missed reason');
      });
    } else {
      check(['succeeded', 'failed', 'withdrawn'].includes(instance.status), 'result status');
      check(nonnegative(instance.settledAt) && instance.settledAt <= now
        && instance.settledAt >= instance.acceptedAt
        && (instance.status === 'withdrawn' ? instance.settledAt < instance.deadlineAt : instance.settledAt >= instance.deadlineAt), 'settlement time');
      const count = fulfilledCount(rows);
      check(instance.fulfilledCount === count && instance.bonusPaid === (instance.status === 'succeeded' ? instance.reward : 0)
        && (instance.status === 'withdrawn' || (instance.status === 'succeeded') === (count >= instance.target)), 'result accounting');
    }
    rows.forEach((row, index) => {
      const original = expected.guests[index];
      exactKeys(row, isActive ? Object.keys(original) : ledgerKeys, 'guest shape');
      for (const key of isActive ? ['guestId', 'partyId', 'label', 'archetype', 'gender', 'spendingTier', 'spendingBudget'] : ['guestId', 'partyId']) {
        check(row[key] === original[key], `guest ${key}`);
      }
      const party = expected.parties.find(p => p.partyId === row.partyId);
      const allowedReasons = { scheduled: [null], pending: [null], fulfilled_paid: [null],
        failed: failedReasons, not_fulfilled: nonfulfilledReasons, missed: missedReasons,
        unfinished: ['deadline'], withdrawn: ['withdrawn'] };
      check(Object.hasOwn(allowedReasons, row.status) && allowedReasons[row.status].includes(row.reason), 'guest status/reason');
      if (unresolved(row)) {
        check(isActive && row.resolvedAt === null, 'unresolved guest');
      } else {
        check(nonnegative(row.resolvedAt) && row.resolvedAt <= Math.min(now, instance.deadlineAt)
          && row.resolvedAt >= (row.status === 'withdrawn' ? instance.acceptedAt : party.arrivalAt), 'guest resolution time');
        if (row.status === 'missed') check(row.resolvedAt === party.arrivalAt, 'missed time');
        if (row.status === 'unfinished') check(!isActive && row.resolvedAt === instance.deadlineAt, 'unfinished time');
        if (row.status === 'withdrawn') check(!isActive && instance.status === 'withdrawn' && row.resolvedAt === instance.settledAt, 'withdrawal time');
        if (!isActive) check(row.resolvedAt <= instance.settledAt, 'resolved after settlement');
      }
      if (row.status === 'fulfilled_paid') {
        check(positiveInteger(row.paidVisitSequence) && row.paidVisitSequence <= maxSequence
          && !sequences.has(row.paidVisitSequence), 'paid sequence');
        sequences.add(row.paidVisitSequence);
      } else check(row.paidVisitSequence === null, 'nonqualifying sequence');
      if (isActive) {
        const admitted = instance.parties.find(p => p.partyId === row.partyId);
        check(admitted.status === 'scheduled' ? row.status === 'scheduled'
          : admitted.status === 'missed' ? row.status === 'missed' && row.reason === admitted.missedReason
            : !['scheduled', 'missed', 'withdrawn', 'unfinished'].includes(row.status), 'atomic party ledger');
      }
      const matchingActors = actors.filter(actor => actor.id === row.guestId);
      check(matchingActors.length <= 1, 'duplicate live guest');
      if (row.status === 'fulfilled_paid') {
        for (const actor of matchingActors) {
          check(actor.paidVisitSequence === row.paidVisitSequence, 'live payment marker');
        }
      }
      if (isActive) for (const actor of matchingActors) {
        check(instance.parties.find(p => p.partyId === row.partyId).status === 'admitted'
          && actor.serviceContractId === instance.instanceId && actor.serviceContractGuestId === row.guestId
          && actor.partyId === row.partyId && actor.archetype === row.archetype
          && actor.gender === row.gender && actor.spendingTier === row.spendingTier
          && actor.spendingBudget === row.spendingBudget && actor.serviceContractArrivalAt === party.arrivalAt, 'live guest identity/profile');
      }
    });
  }
  value.results.forEach(result => validateInstance(result, false));
  if (value.active !== null) validateInstance(value.active, true);
  for (const entity of [...actors, ...(state.queue || []).filter(entry => Array.isArray(entry?.members))]) {
    if (entity.serviceContractId == null) continue;
    check(instanceSerial(entity.serviceContractId) < value.nextInstanceSerial, 'live instance serial');
    if (value.active && entity.serviceContractId === value.active.instanceId) {
      if (Array.isArray(entity.members)) check(value.active.parties.some(p => p.partyId === entity.partyId && p.status === 'admitted'), 'live party tag');
      else check(value.active.guests.some(g => g.guestId === entity.id), 'foreign active guest');
    }
  }
}

export function hydrateServiceContractsState(savedValue) {
  if (savedValue === undefined) return createServiceContractsState();
  // Full cross-state checks run in validateSavedState before hydration. Recheck
  // intrinsic structure here without requiring shared customer/clock state.
  validateServiceContractsState(savedValue, { restaurant: { gameTime: Number.MAX_VALUE, day: Number.MAX_SAFE_INTEGER },
    paidVisitSequence: Number.MAX_SAFE_INTEGER });
  return { ...savedValue, lastAcceptedDayByTemplate: { ...savedValue.lastAcceptedDayByTemplate },
    active: savedValue.active ? { ...savedValue.active,
      parties: savedValue.active.parties.map(party => ({ ...party, guestIds: [...party.guestIds] })),
      guests: savedValue.active.guests.map(guest => ({ ...guest })) } : null,
    results: savedValue.results.map(result => ({ ...result, guestResults: result.guestResults.map(guest => ({ ...guest })) })) };
}
