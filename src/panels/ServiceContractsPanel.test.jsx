import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createInitialState } from '../state/initialState';
import { acceptServiceContract, advanceServiceContractArrivals, recordServiceContractPaidVisit,
  withdrawServiceContract } from '../simulation/serviceContracts';
import ServiceContractsPanel, { ServiceContractTracker } from './ServiceContractsPanel';

let state;
const dispatch = vi.fn();
vi.mock('../state/GameContext', () => ({ useGameState: () => state, useDispatch: () => dispatch }));
beforeEach(() => { state = createInitialState(); dispatch.mockClear(); });

describe('ServiceContractsPanel', () => {
  it('shows all exact offers and readiness information without dispatching on inspection', () => {
    const { unmount } = render(<ServiceContractsPanel />);
    for (const title of ['Office lunch', 'Family service', 'Tasting service', 'Party rush']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('6 guests · 4 paid meals needed')).toBeVisible();
    expect(screen.getByText('8 guests · 6 paid meals needed')).toBeVisible();
    expect(screen.getByText('4 guests · 3 paid meals needed')).toBeVisible();
    expect(screen.getByText('12 guests · 6 paid meals needed')).toBeVisible();
    expect(screen.getAllByText(/15 game minutes to prepare/)).toHaveLength(4);
    expect(screen.getByText('$180 total reward · $45 deposit upfront')).toBeVisible();
    expect(screen.getByText('Failure / withdrawal: $135 deducted · −0.25 reputation')).toBeVisible();
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    const schedule = within(card).getByText(/Arrival 3: couple, 2 guests/);
    expect(schedule).not.toBeVisible();
    fireEvent.click(within(card).getByText('Details'));
    expect(schedule).toBeVisible();
    expect(within(card).getByText(/rusher.*\$24/)).toBeVisible();
    expect(within(card).getByText(/Day 1, 11:25 AM/)).toBeInTheDocument();
    expect(within(card).getByText(/70 game minutes of service/)).toBeInTheDocument();
    expect(screen.getAllByText(/100 game minutes of service/)).toHaveLength(2);
    unmount();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows exact Party stakes before acceptance and leaves cancelling inert', () => {
    render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Party rush' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm Party rush' });
    expect(confirmation).toHaveTextContent('Receive $45 now and $135 on success');
    expect(confirmation).toHaveTextContent('Failure or withdrawal: repay $45 + $90 compensation = $135 deducted');
    expect(confirmation).toHaveTextContent('−0.25 reputation');
    expect(confirmation).toHaveTextContent('including during preparation');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel acceptance' }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.restaurant.funds).toBe(600);
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
    expect(screen.getByText('0/4 fulfilled meals')).toBeInTheDocument();
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
      .getByText(/70 game minutes of service/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('confirms withdrawal costs and hides retained results while preserving the daily lock', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    expect(screen.getByText(/Existing guests remain/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Confirm contract withdrawal' }))
      .toHaveTextContent('repay $22.50 + $45 compensation = $67.50 deducted');
    fireEvent.click(screen.getByRole('button', { name: 'Keep contract' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'WITHDRAW_SERVICE_CONTRACT', instanceId: 'sc-1' });
    state = withdrawServiceContract(state, { instanceId: 'sc-1' });
    rerender(<ServiceContractsPanel />);
    expect(screen.queryByText(/Latest result|Result history|Bonus \$0 earned/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(state.serviceContracts.results).toHaveLength(1);
    expect(screen.getByText('Available next day')).toBeInTheDocument();
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
    state = { ...state, paused: true, restaurant: { ...state.restaurant, gameTime: 42000 } };
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
    expect(screen.getByText(/Target met — \$67.50 balance settles at Day 1, 11:25 AM/)).toBeVisible();
    expect(screen.getByText('4/4 fulfilled meals')).toBeInTheDocument();
    const announcement = screen.getByRole('status').textContent;
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 37680 } };
    rerender(<ServiceContractsPanel />);
    expect(screen.getByRole('status').textContent).toBe(announcement);
    expect(state.restaurant.funds).toBe(622.5);
  });
});

describe('ServiceContractTracker', () => {
  it('is absent when inactive and opens through onOpen without dispatching', () => {
    const onOpen = vi.fn();
    const { container, rerender } = render(<ServiceContractTracker onOpen={onOpen} />);
    expect(container).toBeEmptyDOMElement();
    state = acceptServiceContract(state, { templateId: 'family-service' });
    rerender(<ServiceContractTracker onOpen={onOpen} />);
    expect(screen.getByText(/Family service.*Preparing.*0\/6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View contracts' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
