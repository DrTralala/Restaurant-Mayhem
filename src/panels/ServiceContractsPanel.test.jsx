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
    for (const title of ['Office lunch', 'Family service', 'Tasting service']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('Complete payment for 4 fulfilled meals out of 6 booked guests')).toBeInTheDocument();
    expect(screen.getByText('Complete payment for 6 fulfilled meals out of 8 booked guests')).toBeInTheDocument();
    expect(screen.getByText('Complete payment for 3 fulfilled meals out of 4 booked guests')).toBeInTheDocument();
    expect(screen.getAllByText(/15 game minutes to prepare/)).toHaveLength(3);
    expect(screen.getByText(/Bonus \$90/)).toHaveTextContent(/normal service costs and guest reactions still apply/);
    expect(screen.getByText(/choose from affordable menu options and may order only drinks/)).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Office lunch offer' });
    expect(within(card).getByText(/Arrival 3: couple, 2 guests.*rusher.*\$24.*24 game minutes/)).toBeInTheDocument();
    expect(within(card).getByText(/Day 1, 11:15 AM/)).toBeInTheDocument();
    unmount();
    expect(dispatch).not.toHaveBeenCalled();
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
    expect(screen.getByText('Office guest 1 — Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Office guest 6 — Scheduled')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing');
    expect(screen.getByRole('status')).not.toHaveTextContent('minutes');
    expect(screen.getByRole('button', { name: 'Review Family service' })).toBeDisabled();
  });
  it('confirms withdrawal, keeps cancellation inert and shows the retained result and daily lock', () => {
    state = acceptServiceContract(state, { templateId: 'office-lunch' });
    const { rerender } = render(<ServiceContractsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    expect(screen.getByText(/Existing guests remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep contract' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw contract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'WITHDRAW_SERVICE_CONTRACT', instanceId: 'sc-1' });
    state = withdrawServiceContract(state, { instanceId: 'sc-1' });
    rerender(<ServiceContractsPanel />);
    expect(screen.getByRole('heading', { name: 'Latest result: Office lunch — Withdrawn' })).toBeInTheDocument();
    expect(screen.getAllByText('Bonus $0 earned; $90 not earned.').length).toBeGreaterThan(0);
    expect(screen.getByText('Available next day')).toBeInTheDocument();
    expect(screen.getByText('Result history (1/10)')).toBeInTheDocument();
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
    state = { ...state, paused: true, restaurant: { ...state.restaurant, gameTime: 41000 } };
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
    expect(screen.getByText(/Target met — bonus settles at Day 1, 11:15 AM/)).toHaveTextContent('Pending bonus $90; no bonus has been paid yet.');
    expect(screen.getByText('4/4 fulfilled meals')).toBeInTheDocument();
    const announcement = screen.getByRole('status').textContent;
    state = { ...state, restaurant: { ...state.restaurant, gameTime: 37680 } };
    rerender(<ServiceContractsPanel />);
    expect(screen.getByRole('status').textContent).toBe(announcement);
    expect(state.restaurant.funds).toBe(600);
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
