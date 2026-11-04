import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createInitialState } from '../state/initialState';
import { SERVICE_CONTRACT_RULES_VERSION, getServiceContractTemplate } from '../data/serviceContracts';
import { acceptServiceContract, advanceServiceContractArrivals, recordServiceContractPaidVisit,
  selectServiceContractView, settleServiceContracts, withdrawServiceContract } from '../simulation/serviceContracts';
import { withOwnedAuthoredDishes } from '../simulation/menuTestFixtures';
import ServiceContractsPanel, { ServiceContractTracker } from './ServiceContractsPanel';

let state;
const dispatch = vi.fn();
vi.mock('../state/GameContext', () => ({ useGameState: () => state, useDispatch: () => dispatch }));
beforeEach(() => { state = createInitialState(); dispatch.mockClear(); });

function setGuestOutcomes(fulfilledCount, unresolvedCount, unresolvedStatus = 'pending') {
  const active = state.serviceContracts.active;
  state = { ...state, serviceContracts: { ...state.serviceContracts, active: { ...active,
    guests: active.guests.map((guest, index) => ({ ...guest,
      status: index < fulfilledCount ? 'fulfilled_paid'
        : index < fulfilledCount + unresolvedCount ? unresolvedStatus : 'not_fulfilled' })) } } };
}

function completeHistoryContract(currentState, { day, status, templateId = 'office-lunch', rulesVersion = SERVICE_CONTRACT_RULES_VERSION }) {
  const acceptedAt = 36000 + (day - 1) * 86400;
  const dailyState = { ...currentState, restaurant: { ...currentState.restaurant, day, gameTime: acceptedAt } };
  const accepted = acceptServiceContract(dailyState, { templateId });
  const activeTemplate = getServiceContractTemplate(templateId, rulesVersion);
  let active = { ...accepted.serviceContracts.active, rulesVersion,
    target: activeTemplate.target, reward: activeTemplate.reward };
  let completed = { ...accepted, serviceContracts: { ...accepted.serviceContracts, active } };
  if (rulesVersion < 3) {
    const { depositPaid = 0, ...legacyActive } = active;
    active = { ...legacyActive, deadlineAt: active.serviceStartAt + activeTemplate.serviceDuration };
    completed = { ...completed, restaurant: { ...completed.restaurant,
      funds: completed.restaurant.funds - depositPaid, dailyRevenue: completed.restaurant.dailyRevenue - depositPaid } };
  }
  completed = { ...completed, serviceContracts: { ...completed.serviceContracts, active } };
  if (status === 'withdrawn') return withdrawServiceContract(completed, { instanceId: active.instanceId });

  if (status === 'succeeded') {
    let fulfilled = 0;
    const parties = active.parties.map(party => {
      if (fulfilled >= active.target) return party;
      fulfilled += party.size;
      return { ...party, status: 'admitted', admittedAt: party.arrivalAt };
    });
    let sequence = 0;
    const guests = active.guests.map(guest => {
      if (sequence >= active.target) return guest;
      sequence++;
      const party = active.parties.find(row => row.partyId === guest.partyId);
      return { ...guest, status: 'fulfilled_paid', paidVisitSequence: sequence, resolvedAt: party.arrivalAt + 1 };
    });
    active = { ...active, parties, guests };
    completed = { ...completed, paidVisitSequence: sequence,
      serviceContracts: { ...completed.serviceContracts, active } };
  }

  completed = { ...completed, restaurant: { ...completed.restaurant, gameTime: active.deadlineAt } };
  return settleServiceContracts(completed, active.deadlineAt, { entry: true });
}

describe('ServiceContractsPanel', () => {
  it('shows missing kitchen equipment and keeps contract acceptance advisory', () => {
    state.kitchenStations = [];
    render(<ServiceContractsPanel />);
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card).getByText(/No affordable dish has a compatible kitchen station/)).toBeVisible();
    expect(within(card).getByText(/Toasted Bread.*Toaster/)).toBeVisible();
    expect(within(card).getByText(/Equipment checks do not assess access, workload or service completion/)).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'Review Office lunch' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Accept and start preparation' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACCEPT_SERVICE_CONTRACT', templateId: 'office-lunch' });
  });

  it('updates partial equipment advice during review after a compatible station is placed', () => {
    state = withOwnedAuthoredDishes(state, [
      { ...state.dishes[0], cookbookId: 'toast' },
      { id: 'roast', cookbookId: 'roast-vegetables', name: 'Roast', price: 20 },
    ]);
    const { rerender } = render(<ServiceContractsPanel />);
    const card = () => screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card()).getByText(/Some affordable dishes lack a compatible kitchen station/)).toBeVisible();
    expect(within(card()).queryByText(/No affordable dish has a compatible kitchen station/)).not.toBeInTheDocument();
    expect(within(card()).getByText(/Roast.*Oven/)).toBeVisible();
    fireEvent.click(within(card()).getByRole('button', { name: 'Review Office lunch' }));
    state = { ...state,
      equipment: state.equipment.map(equipment => equipment.id === 'eq2' ? { ...equipment, owned: true } : equipment),
      kitchenStations: [...state.kitchenStations, { id: 'oven', equipmentId: 'eq2', x: 200, y: 120 }],
    };
    rerender(<ServiceContractsPanel />);
    expect(within(card()).queryByText(/Some affordable dishes lack a compatible kitchen station/)).not.toBeInTheDocument();
    expect(within(card()).queryByText(/Roast.*Oven/)).not.toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Accept and start preparation' })).toBeEnabled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('describes the station requirement for an owned authored dish', () => {
    state = withOwnedAuthoredDishes(state, [
      { id: 'roast', cookbookId: 'roast-vegetables', name: 'Roast Vegetables' },
    ]);
    state.kitchenStations = [];
    render(<ServiceContractsPanel />);
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card).getByText(/Roast Vegetables.*needs owned equipment at a matching kitchen station: Oven/))
      .toBeVisible();
    expect(within(card).queryByText(/undefined|null/)).not.toBeInTheDocument();
  });

  it('shows all exact offers and readiness information without dispatching on inspection', () => {
    const { unmount } = render(<ServiceContractsPanel />);
    for (const title of ['Office lunch', 'Family service', 'Tasting service', 'Party rush']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('6 guests · 2 paid meals needed')).toBeVisible();
    expect(screen.getByText('8 guests · 4 paid meals needed')).toBeVisible();
    expect(screen.getByText('4 guests · 2 paid meals needed')).toBeVisible();
    expect(screen.getByText('12 guests · 3 paid meals needed')).toBeVisible();
    expect(screen.getAllByText(/15 game minutes to prepare/)).toHaveLength(4);
    expect(screen.getByText('$180 total reward · $45 deposit upfront')).toBeVisible();
    const partyOffer = screen.getByRole('region', { name: 'Party rush offer' });
    expect(partyOffer).toHaveTextContent(/Before service starts: repay only the \$45 deposit; no compensation or reputation penalty/);
    expect(partyOffer).toHaveTextContent(/After service starts: repay \$45 \+ \$45 compensation = \$90 deducted, plus −0\.25 reputation/);
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    const schedule = within(card).getByText(/Arrival 3: couple, 2 guests/);
    expect(schedule).not.toBeVisible();
    fireEvent.click(within(card).getByText('Details'));
    expect(schedule).toBeVisible();
    expect(within(card).getByText(/Guests choose affordable menu options and may order only drinks/)).toBeVisible();
    expect(within(card).getByText(/rusher.*\$24/)).toBeVisible();
    expect(within(card).getByText('Booked diners have 1.5× the usual patience for queue and food waits.')).toBeVisible();
    expect(within(card).getByText(/Day 1, 11:42 AM/)).toBeInTheDocument();
    expect(within(card).getByText(/87.5 game minutes of service/)).toBeInTheDocument();
    expect(screen.getAllByText(/125 game minutes of service/)).toHaveLength(2);
    unmount();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('renders tier and preparation facts from each versioned offer record as advisory only', () => {
    const view = selectServiceContractView(state);
    const { offers } = view;
    render(<ServiceContractsPanel />);

    for (const offer of offers) {
      const template = getServiceContractTemplate(offer.template.id, SERVICE_CONTRACT_RULES_VERSION);
      expect(offer.tier).toBe(template.tier);
      expect(offer.preparationExpectations).toEqual(template.preparationExpectations);

      const card = screen.getByRole('region', { name: `${template.title} offer` });
      expect(within(card).getByText(`Tier: ${offer.tier}`)).toBeVisible();
      fireEvent.click(within(card).getByText('Details'));
      for (const expectation of offer.preparationExpectations) {
        expect(within(card).getByText(expectation)).toBeVisible();
      }
      expect(within(card).getByText('Advisory reference preparation only — these expectations are not a guarantee.'))
        .toBeVisible();
      expect(card).not.toHaveTextContent(/success rate|success percentage|chance of success|\d+%|guarantees? success/i);
    }
    const activeView = selectServiceContractView(acceptServiceContract(state, { templateId: 'office-lunch' })).active;
    expect(activeView).toMatchObject({ tier: 'introductory',
      preparationExpectations: getServiceContractTemplate('office-lunch', SERVICE_CONTRACT_RULES_VERSION)
        .preparationExpectations });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('keeps v5 active contract metadata version-correct while current offers retain v6 metadata', () => {
    const accepted = acceptServiceContract(state, { templateId: 'office-lunch' });
    const v5Template = getServiceContractTemplate('office-lunch', 5);
    const active = { ...accepted.serviceContracts.active, rulesVersion: 5,
      target: v5Template.target, reward: v5Template.reward };
    state = { ...accepted, serviceContracts: { ...accepted.serviceContracts, active } };

    const view = selectServiceContractView(state);
    expect(view.active).toMatchObject({ title: v5Template.title, target: 4, reward: v5Template.reward });
    expect(view.active).not.toHaveProperty('tier');
    expect(view.active).not.toHaveProperty('preparationExpectations');
    for (const rulesVersion of [1, 2, 3, 4, 5]) {
      const historicalState = { ...accepted, serviceContracts: { ...accepted.serviceContracts,
        active: { ...active, rulesVersion,
          target: getServiceContractTemplate('office-lunch', rulesVersion).target } } };
      const historicalActive = selectServiceContractView(historicalState).active;
      expect(historicalActive).not.toHaveProperty('tier');
      expect(historicalActive).not.toHaveProperty('preparationExpectations');
    }
    expect(view.offers.find(offer => offer.template.id === 'office-lunch')).toMatchObject({
      tier: 'introductory', preparationExpectations: getServiceContractTemplate('office-lunch', 6).preparationExpectations,
    });

    render(<ServiceContractsPanel />);
    const activeCard = screen.getByRole('region', { name: 'Active contract' });
    expect(within(activeCard).getByText('0/4 fulfilled meals')).toBeInTheDocument();
    expect(within(activeCard).queryByText(/Tier:|Reference preparation/)).not.toBeInTheDocument();
    const currentOffer = screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(currentOffer).getByText('6 guests · 2 paid meals needed')).toBeVisible();
    expect(within(currentOffer).getByText('Tier: introductory')).toBeVisible();
  });
  it('summarises exact reason counts from the latest stored guest result ledger', () => {
    const guestResults = [
      { guestId: 'sc-3-g1', status: 'not_fulfilled', reason: 'drink_only' },
      { guestId: 'sc-3-g2', status: 'not_fulfilled', reason: 'drink_only' },
      { guestId: 'sc-3-g3', status: 'missed', reason: 'missed_closed' },
      { guestId: 'sc-3-g4', status: 'unfinished', reason: 'deadline' },
      { guestId: 'sc-3-g5', status: 'fulfilled_paid', reason: null },
    ];
    const latestResult = { instanceId: 'sc-3', templateId: 'office-lunch', rulesVersion: 6,
      status: 'failed', guestResults };
    state = { ...state, serviceContracts: { ...state.serviceContracts, results: [latestResult] } };

    expect(selectServiceContractView(state).latestResult).toBe(latestResult);
    render(<ServiceContractsPanel />);

    expect(screen.getByText(
      'Latest result reasons: Drink-only visit × 2 · Closed at arrival × 1 · Payment not completed by the deadline × 1.',
    )).toBeVisible();
    expect(screen.queryByText(/cook capacity|bad layout|cause|root cause/i)).not.toBeInTheDocument();
  });
  it('shows an expandable empty recent-results section', () => {
    render(<ServiceContractsPanel />);

    const summary = screen.getByText('Recent contract results (0)');
    expect(summary).toBeVisible();
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('No completed contracts yet.')).not.toBeVisible();

    fireEvent.click(summary);

    expect(screen.getByText('No completed contracts yet.')).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows recorded withdrawal status, counts, reason and finite financial evidence for one result', () => {
    state = completeHistoryContract(state, { day: 1, status: 'withdrawn' });
    render(<ServiceContractsPanel />);

    const summary = screen.getByText('Recent contract results (1)');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    const result = screen.getByRole('article', { name: 'Office lunch — Day 1 — Withdrawn' });

    expect(within(result).getByText('Accepted day: 1')).toBeVisible();
    expect(within(result).getByText('Status: Withdrawn')).toBeVisible();
    expect(within(result).getByText('0/2 fulfilled meals')).toBeVisible();
    expect(within(result).getByText('Reasons: Contract withdrawn × 6')).toBeVisible();
    expect(within(result).getByText('Contract reward paid (including any retained deposit): $0')).toBeVisible();
    expect(within(result).getByText('Deposit repaid: $22.50')).toBeVisible();
    expect(within(result).getByText('Compensation paid: $0')).toBeVisible();
    expect(within(result).getByText('Reputation penalty: 0')).toBeVisible();
    expect(screen.getByText(
      'Contract payments are separate from meal takings; the reward includes any retained deposit.',
    )).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('renders succeeded, failed and withdrawn outcomes newest-first using stored versioned counts', () => {
    state = completeHistoryContract(state, { day: 1, status: 'succeeded', rulesVersion: 5 });
    state = completeHistoryContract(state, { day: 2, status: 'failed' });
    state = completeHistoryContract(state, { day: 3, status: 'withdrawn' });
    const storedResults = state.serviceContracts.results;
    const storedOrder = storedResults.map(result => result.instanceId);
    render(<ServiceContractsPanel />);

    fireEvent.click(screen.getByText('Recent contract results (3)'));

    const results = screen.getAllByRole('article');
    expect(results.map(result => result.getAttribute('aria-label'))).toEqual([
      'Office lunch — Day 3 — Withdrawn',
      'Office lunch — Day 2 — Failed',
      'Office lunch — Day 1 — Succeeded',
    ]);
    expect(within(results[0]).getByText('0/2 fulfilled meals')).toBeVisible();
    expect(within(results[1]).getByText('0/2 fulfilled meals')).toBeVisible();
    expect(within(results[2]).getByText('4/4 fulfilled meals')).toBeVisible();
    expect(within(results[2]).getByText('Contract reward paid (including any retained deposit): $90')).toBeVisible();
    expect(state.serviceContracts.results).toBe(storedResults);
    expect(state.serviceContracts.results.map(result => result.instanceId)).toEqual(storedOrder);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows no financial fields missing from a legacy result and falls back to its template ID without a stored revision', () => {
    state = completeHistoryContract(state, { day: 1, status: 'failed', rulesVersion: 1 });
    const legacyResult = { ...state.serviceContracts.results[0] };
    delete legacyResult.rulesVersion;
    state = { ...state, serviceContracts: { ...state.serviceContracts, results: [legacyResult] } };
    render(<ServiceContractsPanel />);

    fireEvent.click(screen.getByText('Recent contract results (1)'));

    const result = screen.getByRole('article', { name: 'office-lunch — Day 1 — Failed' });
    expect(within(result).getByText('0/4 fulfilled meals')).toBeVisible();
    expect(within(result).getByText('Contract reward paid (including any retained deposit): $0')).toBeVisible();
    expect(within(result).queryByText(/Deposit repaid:|Compensation paid:|Reputation penalty:/)).not.toBeInTheDocument();
    expect(screen.getByText('6 guests · 2 paid meals needed')).toBeVisible();
    expect(screen.getByText('$90 total reward · $22.50 deposit upfront')).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('renders ten newest outcomes without mutating stored order or an active contract during a decision pause', () => {
    for (let index = 0; index < 10; index++) {
      const statuses = ['succeeded', 'failed', 'withdrawn'];
      state = completeHistoryContract(state, { day: index + 1, status: statuses[index % statuses.length] });
    }
    const dayEleven = { ...state, restaurant: { ...state.restaurant, day: 11, gameTime: 900000 } };
    state = acceptServiceContract(dayEleven, { templateId: 'family-service' });
    state = { ...state, careerRun: { needsDecision: true } };
    const activeContract = state.serviceContracts.active;
    const storedResults = state.serviceContracts.results;
    const storedOrder = storedResults.map(result => result.instanceId);
    render(<ServiceContractsPanel />);

    const summary = screen.getByText('Recent contract results (10)');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);

    const results = screen.getAllByRole('article');
    expect(results).toHaveLength(10);
    expect(results[0]).toHaveAttribute('aria-label', expect.stringContaining('Day 10'));
    expect(results[9]).toHaveAttribute('aria-label', expect.stringContaining('Day 1'));
    expect(screen.getByText('Contract paused — choose Continue in Opening Week to resume')).toBeVisible();
    expect(state.serviceContracts.active).toBe(activeContract);
    expect(state.serviceContracts.results).toBe(storedResults);
    expect(state.serviceContracts.results.map(result => result.instanceId)).toEqual(storedOrder);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows exact Party stakes before acceptance and leaves cancelling inert', () => {
    render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Party rush' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm Party rush' });
    expect(confirmation).toHaveTextContent('Receive $45 now and $135 on success');
    expect(confirmation).toHaveTextContent('Before service starts: repay only the $45 deposit; no compensation or reputation penalty.');
    expect(confirmation).toHaveTextContent('After service starts: repay $45 + $45 compensation = $90 deducted, plus −0.25 reputation.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel acceptance' }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.restaurant.funds).toBe(600);
  });
  it('shows current projected review times without opening details and refreshes both on rerender', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    const card = () => screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card()).getByText(/Arrival 3: couple, 2 guests/)).not.toBeVisible();
    fireEvent.click(within(card()).getByRole('button', { name: 'Review Office lunch' }));
    const confirmation = () => screen.getByRole('group', { name: 'Confirm Office lunch' });
    expect(within(confirmation()).getByText('Projected start: Day 1, 10:15 AM')).toBeVisible();
    expect(within(confirmation()).getByText('Projected deadline: Day 1, 11:42 AM')).toBeVisible();
    expect(within(card()).getByText(/Arrival 3: couple, 2 guests/)).not.toBeVisible();
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 11 * 3600 } };
    rerender(<ServiceContractsPanel />);
    expect(within(confirmation()).getByText('Projected start: Day 1, 11:15 AM')).toBeVisible();
    expect(within(confirmation()).getByText('Projected deadline: Day 1, 12:42 PM')).toBeVisible();
    expect(within(confirmation()).queryByText('Projected start: Day 1, 10:15 AM')).not.toBeInTheDocument();
    expect(within(confirmation()).queryByText('Projected deadline: Day 1, 11:42 AM')).not.toBeInTheDocument();
  });
  it('labels projected review times across a midnight day wrap', () => {
    state = { ...state, restaurant: { ...state.restaurant, day: 1, gameTime: 23 * 3600 + 50 * 60 } };
    render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm Office lunch' });
    expect(within(confirmation).getByText('Projected start: Day 2, 12:05 AM')).toBeVisible();
    expect(within(confirmation).getByText('Projected deadline: Day 2, 1:32 AM')).toBeVisible();
  });
  it('replaces projected review times with unavailable and blocks acceptance after an invalid clock', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    expect(screen.getByRole('button', { name: 'Accept and start preparation' })).toBeEnabled();
    state = { ...state, restaurant: { ...state.restaurant, gameTime: Number.NaN } };
    rerender(<ServiceContractsPanel />);
    const confirmation = screen.getByRole('group', { name: 'Confirm Office lunch' });
    expect(within(confirmation).getByText('Projected times unavailable.')).toBeVisible();
    expect(within(confirmation).queryByText(/Projected start:/)).not.toBeInTheDocument();
    expect(within(confirmation).queryByText(/Projected deadline:/)).not.toBeInTheDocument();
    const accept = within(confirmation).getByRole('button', { name: 'Accept and start preparation' });
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    expect(dispatch).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Office lunch offer' }))
      .getByText('The game clock cannot start a contract')).toBeVisible();
  });
  it('keeps readiness warnings visible outside collapsed details', () => {
    state = { ...state, staff: [] };
    render(<ServiceContractsPanel />);
    const card = screen.getByRole('region', { name: 'Party rush offer' });
    expect(within(card).getByText('No cook is employed.')).toBeVisible();
    expect(within(card).getByText('No waiter is employed.')).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Review Party rush' })).toBeEnabled();
  });
  it('opens an inline confirmation, cancels without dispatch, and explicitly accepts', () => {
    render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel acceptance' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start preparation' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACCEPT_SERVICE_CONTRACT', templateId: 'office-lunch' });
  });
  it('focuses review context without trapping Tab and restores focus to the review trigger on cancel', () => {
    render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm Office lunch' });
    expect(document.activeElement).toBe(confirmation);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fireEvent.keyDown(confirmation, { key: 'Tab', cancelable: true })).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel acceptance' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review Office lunch' }));
  });
  it('does not move focus back to review context on an unrelated state rerender', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    const cancel = screen.getByRole('button', { name: 'Cancel acceptance' });
    cancel.focus();

    state = { ...state, restaurant: { ...state.restaurant, gameTime: state.restaurant.gameTime + 1 } };
    rerender(<ServiceContractsPanel />);

    expect(document.activeElement).toBe(cancel);
  });
  it('focuses the active contract heading after successful acceptance', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    dispatch.mockImplementationOnce(({ templateId }) => {
      state = acceptServiceContract(state, { templateId });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept and start preparation' }));
    rerender(<ServiceContractsPanel />);

    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Active: Office lunch' }));
  });
  it('revalidates the confirmation when current state becomes blocked', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<ServiceContractsPanel />);
    expect(screen.getByRole('button', { name: 'Accept and start preparation' })).toBeDisabled();
    expect(screen.getByText('Contract paused — choose Continue in Opening Week to resume')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept and start preparation' }));
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows phase, full scheduled guest roster, counts and a non-countdown live announcement', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    render(<ServiceContractsPanel />);
    expect(screen.getByRole('progressbar', { name: 'Fulfilled meals' })).toHaveAttribute('value', '0');
    expect(screen.getByText('0/2 fulfilled meals')).toBeInTheDocument();
    expect(screen.getByText(/0\/6 admitted.*6 unresolved.*0 failed.*0 missed/)).toBeInTheDocument();
    expect(screen.getByText(/Next arrival: Day 1, 10:15 AM/)).toBeInTheDocument();
    expect(screen.getByText('Office guest 1 — Scheduled')).not.toBeVisible();
    fireEvent.click(screen.getByText('Guest details'));
    expect(screen.getByText('Office guest 1 — Scheduled')).toBeVisible();
    expect(screen.getByText('Office guest 6 — Scheduled')).toBeVisible();
    expect(screen.getByText('Deposit received: $22.50 · Success balance: $67.50')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing');
    expect(screen.getByRole('status')).not.toHaveTextContent('minutes');
    expect(screen.getByRole('button', { name: 'Review Family service' })).toBeDisabled();
  });
  it('shows best-case further meals when scheduled guests can exactly meet the target', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    setGuestOutcomes(0, 2, 'scheduled');
    render(<ServiceContractsPanel />);

    const active = screen.getByRole('region', { name: 'Active contract' });
    expect(within(active).getByText('0/6 admitted · 2 unresolved · 4 failed · 0 missed')).toBeInTheDocument();
    expect(within(active).getByText(
      'Best case: 2 further meals from unresolved guests. This is a best-case count, not a guarantee.',
    )).toBeVisible();
    expect(within(active).getByRole('button', { name: 'Withdraw contract' })).toBeEnabled();
    expect(state.serviceContracts.active).not.toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('says the target is no longer reachable when even all unresolved guests fall short', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    setGuestOutcomes(1, 0);
    render(<ServiceContractsPanel />);

    const active = screen.getByRole('region', { name: 'Active contract' });
    expect(within(active).getByText(
      'Target no longer reachable — best case 1/2. This is a best-case count, not a guarantee.',
    )).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('does not show reachability guidance after the target is met', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    setGuestOutcomes(4, 2);
    render(<ServiceContractsPanel />);

    const active = screen.getByRole('region', { name: 'Active contract' });
    expect(within(active).getByText(/Target met —/)).toBeVisible();
    expect(within(active).queryByText(/Best case:|Target no longer reachable/)).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('retains the deadline settlement notice without reachability guidance', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    setGuestOutcomes(1, 2);
    state = { ...state, restaurant: { ...state.restaurant,
      gameTime: state.serviceContracts.active.deadlineAt } };
    render(<ServiceContractsPanel />);

    const active = screen.getByRole('region', { name: 'Active contract' });
    expect(within(active).getByText(
      'Deadline reached — resume the simulation to settle this contract.',
    )).toBeVisible();
    expect(within(active).queryByText(/Best case:|Target no longer reachable/)).not.toBeInTheDocument();
    expect(state.serviceContracts.active).not.toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each([1, 2])('keeps a loaded v%s contract on its original financial terms', rulesVersion => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    state.serviceContracts.active = { ...state.serviceContracts.active, rulesVersion, deadlineAt: rulesVersion === 1 ? 40500 : 41100 };
    delete state.serviceContracts.active.depositPaid;
    render(<ServiceContractsPanel />);
    expect(within(screen.getByRole('region', { name: 'Active contract' }))
      .getByText(`Deadline: Day 1, ${rulesVersion === 1 ? '11:15' : '11:25'} AM`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm contract withdrawal' });
    expect(confirmation).toHaveTextContent('Original terms: no deposit or contract penalty');
    expect(confirmation).not.toHaveTextContent('−0.25');
    expect(within(screen.getByRole('region', { name: 'Office lunch offer' }))
      .getByText(/87.5 game minutes of service/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('confirms withdrawal costs and hides retained results while preserving the daily lock', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    expect(screen.getByText(/Existing guests remain/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Confirm contract withdrawal' }))
      .toHaveTextContent('Before service starts: repay only the $22.50 deposit; no compensation or reputation penalty.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep contract' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'WITHDRAW_SERVICE_CONTRACT', instanceId: 'sc-1' });
    state = withdrawServiceContract(state, { instanceId: 'sc-1' });
    rerender(<ServiceContractsPanel />);
    expect(screen.getByText('Latest result reasons: Contract withdrawn × 6.')).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(state.serviceContracts.results).toHaveLength(1);
    expect(screen.getByText('Available next day')).toBeInTheDocument();
  });
  it('previews full v5 cancellation liability when withdrawal is requested at service start', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    state = { ...state, restaurant: { ...state.restaurant,
      gameTime: state.serviceContracts.active.serviceStartAt } };
    render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm contract withdrawal' });
    expect(confirmation).toHaveTextContent('After service starts: repay $22.50 + $22.50 compensation = $45 deducted, plus −0.25 reputation (minimum 1).');
    expect(confirmation).not.toHaveTextContent('no compensation or reputation penalty');
  });
  it('focuses withdrawal context, restores Keep focus to its trigger, and focuses offers after success', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Confirm contract withdrawal' }));

    fireEvent.click(screen.getByRole('button', { name: 'Keep contract' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Withdraw contract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    dispatch.mockImplementationOnce(({ instanceId }) => {
      state = withdrawServiceContract(state, { instanceId });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    rerender(<ServiceContractsPanel />);

    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Contract offers' }));
  });
  it('falls back to offer context when eligibility changes and disables the review trigger', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Office lunch' }));
    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<ServiceContractsPanel />);
    expect(screen.getByRole('button', { name: 'Accept and start preparation' })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Confirm Office lunch' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel acceptance' }));

    expect(screen.getByRole('button', { name: 'Review Office lunch' })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Office lunch' }));
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('falls back to active contract context when Keep restores a disabled withdrawal trigger', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Confirm contract withdrawal' }));
    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<ServiceContractsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Keep contract' }));

    expect(screen.getByRole('button', { name: 'Withdraw contract' })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Active: Office lunch' }));
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('moves focus to the current contract context when a pending withdrawal instance is replaced', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    const withdrawn = withdrawServiceContract(state, { instanceId: 'sc-1' });
    state = acceptServiceContract(withdrawn, { templateId: 'family-service' });

    rerender(<ServiceContractsPanel />);

    expect(screen.queryByRole('group', { name: 'Confirm contract withdrawal' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Active: Family service' }));
  });
  it('disables withdrawal during a career decision while retaining scheduled bookings', () => {
    state = { ...acceptServiceContract(state, { templateId: 'office-lunch' }), careerRun: { needsDecision: true } };
    render(<ServiceContractsPanel />);
    expect(screen.getByRole('button', { name: 'Withdraw contract' })).toBeDisabled();
    expect(screen.getByText('Office guest 1 — Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Contract paused — choose Continue in Opening Week to resume')).toBeInTheDocument();
  });
  it('leaves overdue loaded contracts to guarded settlement rather than exposing a withdrawal shortcut', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    state = { ...state, paused: true, restaurant: { ...state.restaurant, gameTime: 43050 } };
    render(<ServiceContractsPanel />);
    expect(screen.getByRole('button', { name: 'Withdraw contract' })).toBeDisabled();
    expect(screen.getByText('Deadline reached — resume the simulation to settle this contract.')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows early target achievement as a pending bonus, not paid money, and keeps countdowns out of live announcements', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    for (const time of [36900, 37620]) {
      state = { ...state, restaurant: { ...state.restaurant, gameTime: time } };
      state = advanceServiceContractArrivals(state, time, { admitParty: s => ({ state: s, admitted: true, reason: null }) });
    }
    for (let index = 0; index < 4; index++) {
      const guest = state.serviceContracts.active.guests[index];
      state = recordServiceContractPaidVisit({ ...state, paidVisitSequence: index + 1 }, {
        schemaVersion: 1, sequence: index + 1, customerId: guest.guestId, partyId: guest.partyId,
        serviceContractId: 'sc-1', serviceContractGuestId: guest.guestId,
        paidAt: 37620, menuOutcome: 'ordered', foodOutcome: 'delivered',
        dish: { serviceItemId: `dish-${index}`, menuItemId: 'starter-toast', cookbookId: null,
          priceAtOrder: 12, chargedAmount: 12, fulfilled: true, paid: true }, subtotal: 12, tip: 0, totalPaid: 12,
      });
    }
    const { rerender } = render(<ServiceContractsPanel />);
    expect(screen.getByText(/Target met — \$67.50 balance settles at Day 1, 11:42 AM/)).toBeVisible();
    expect(screen.getByText('4/2 fulfilled meals')).toBeInTheDocument();
    const announcement = screen.getByRole('status').textContent;
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 37680 } };
    rerender(<ServiceContractsPanel />);
    expect(screen.getByRole('status').textContent).toBe(announcement);
    expect(state.restaurant.funds).toBe(622.5);
  });
  it('states the pause-aware walk-in policy while open and while paused', () => {
    const { rerender } = render(<ServiceContractsPanel />);
    const intro = () => screen.getByText(
      /Walk-ins follow opening hours and the walk-in pause setting; tables and staff are not reserved\./,
    );
    expect(intro()).toBeVisible();
    expect(screen.queryByText(/Walk-ins continue/)).not.toBeInTheDocument();

    state = { ...state, careerRun: { needsDecision: true } };
    rerender(<ServiceContractsPanel />);
    expect(intro()).toBeVisible();
    expect(screen.getByText('Contract paused — choose Continue in Opening Week to resume')).toBeInTheDocument();
  });
  it('keeps the scheduled-work disclaimer visible on a warning-free offer', () => {
    render(<ServiceContractsPanel />);
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card).queryByText('Check before accepting:')).not.toBeInTheDocument();
    expect(within(card).getByText('Scheduled Work does not guarantee availability or coverage throughout service.')).toBeVisible();
  });
  it('keeps schedule advice and the coverage disclaimer outside details with acceptance enabled', () => {
    const rest = Array.from({ length: 48 }, () => 'rest');
    state = { ...state, staff: state.staff.map(person => ({ ...person, schedule: rest })) };
    render(<ServiceContractsPanel />);
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card).getByText('Under current schedules, no cook is scheduled to Work at one or more arrivals.')).toBeVisible();
    expect(within(card).getByText('Under current schedules, no waiter is scheduled to Work at one or more arrivals.')).toBeVisible();
    expect(within(card).getByText('Under current schedules, no assigned checkout waiter is scheduled to Work at one or more arrivals.')).toBeVisible();
    expect(within(card).getByText('Scheduled Work does not guarantee availability or coverage throughout service.')).toBeVisible();
    expect(within(card).queryByText('No cook is employed.')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Review Office lunch' })).toBeEnabled();
  });
});

describe('ServiceContractTracker', () => {
  it('is absent when inactive and opens through onOpen without dispatching', () => {
    const onOpen = vi.fn();
    const { container, rerender } = render(<ServiceContractTracker onOpen={onOpen} />);
    expect(container).toBeEmptyDOMElement();
    state = acceptServiceContract(state, { templateId: 'family-service' });
    rerender(<ServiceContractTracker onOpen={onOpen} />);
    const tracker = screen.getByRole('complementary', { name: 'Service contract tracker' });
    expect(tracker).toHaveStyle({ position: 'absolute', width: 'max-content',
      maxWidth: 'min(460px, calc(100% - 16px))' });
    expect(screen.getByText(/Family service.*Preparing.*0\/4/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View contracts' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
