import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CookbookPanel from './CookbookPanel';
import { useDispatch, useGameState } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { applyCookbookPaidVisit, normaliseCookbookState, reconcileCookbookDiscoveries } from '../simulation/cookbook';

vi.mock('../state/GameContext', () => ({ useGameState: vi.fn(), useDispatch: vi.fn() }));

function initial() {
  const state = createInitialState();
  return { ...state, paidVisitSequence: 0, ...normaliseCookbookState(state, { legacy: true }) };
}

function paidToast(state, count) {
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const outcome = { schemaVersion: 1, sequence, customerId: `c${sequence}`, partyId: `p${sequence}`,
      paidAt: 36000 + sequence, menuOutcome: 'ordered', foodOutcome: 'delivered',
      serviceContractId: null, serviceContractGuestId: null, subtotal: 12, tip: 2, totalPaid: 14,
      dish: { serviceItemId: `i${sequence}`, menuItemId: 'starter-toast', cookbookId: 'toast',
        priceAtOrder: 12, chargedAmount: 12, fulfilled: true, paid: true } };
    state = { ...state, paidVisitSequence: sequence, cookbook: applyCookbookPaidVisit(state.cookbook, outcome) };
    state.cookbook = reconcileCookbookDiscoveries(state);
  }
  return state;
}

describe('CookbookPanel', () => {
  let state;
  let dispatch;
  beforeEach(() => {
    state = initial();
    dispatch = vi.fn();
    useGameState.mockImplementation(() => state);
    useDispatch.mockReturnValue(dispatch);
  });

  it('shows all six named recipes, numeric locked requirements and starter progress', () => {
    render(<CookbookPanel onClose={vi.fn()} />);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    expect(toast.getByText('On menu')).toBeInTheDocument();
    expect(toast.getByText('Paid portions: 0/15')).toBeInTheDocument();
    expect(toast.getByRole('button', { name: 'Choose Quick Service' })).toBeDisabled();
    expect(toast.getByText(/15 paid portions to choose/)).toBeInTheDocument();
    const cheese = within(screen.getByRole('article', { name: 'Cheese Toast recipe' }));
    expect(cheese.getByText('Toasted Bread paid portions: 0/3')).toBeInTheDocument();
    expect(cheese.getByRole('button', { name: 'Add Cheese Toast to menu' })).toBeDisabled();
    const potato = within(screen.getByRole('article', { name: 'Baked Potato recipe' }));
    expect(potato.getByText('Own Oven: 0/1')).toBeInTheDocument();
    expect(potato.getByText('Roast Vegetables paid portions: 0/5')).toBeInTheDocument();
  });

  it('starterCookbookProgress: three real canonical outcomes expose free Cheese Toast addition', () => {
    state = paidToast(state, 3);
    render(<CookbookPanel onClose={vi.fn()} />);
    const cheese = within(screen.getByRole('article', { name: 'Cheese Toast recipe' }));
    expect(cheese.getByText('Ready to add')).toBeInTheDocument();
    fireEvent.click(cheese.getByRole('button', { name: 'Add Cheese Toast to menu' }));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_COOKBOOK_DISH', cookbookId: 'cheese-toast' });
    expect(state.restaurant.funds).toBe(600);
    expect(state.recipeSlots).toBe(1);
  });

  it('shows equipment-missing reasons and warns about absent stations without preventing eligible addition', () => {
    state.dishes = [];
    state.equipment = [];
    const view = render(<CookbookPanel onClose={vi.fn()} />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    expect(toast.getByText('Equipment needed')).toBeInTheDocument();
    expect(toast.getByRole('button', { name: 'Add Toasted Bread to menu' })).toBeDisabled();
    state.equipment = [{ id: 'eq1', owned: true }];
    state.kitchenStations = [];
    view.rerender(<CookbookPanel onClose={vi.fn()} />);
    expect(toast.getByText(/No matching kitchen station/)).toBeInTheDocument();
    expect(toast.getByRole('button', { name: 'Add Toasted Bread to menu' })).toBeEnabled();
  });

  it('cancels inline mastery without dispatch and confirms exact permanent choice off-menu', () => {
    state = paidToast(state, 15);
    state.dishes = [];
    render(<CookbookPanel onClose={vi.fn()} />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    expect(toast.getByText('Signature choice available')).toBeInTheDocument();
    fireEvent.click(toast.getByRole('button', { name: 'Choose Quick Service' }));
    expect(toast.getByText('60 → 51 seconds base cook work')).toBeInTheDocument();
    expect(toast.getByText('50 → 50 popularity')).toBeInTheDocument();
    expect(toast.getByText('Permanent for this recipe; applies to new orders only')).toBeInTheDocument();
    fireEvent.click(toast.getByRole('button', { name: 'Cancel' }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(toast.getByRole('button', { name: 'Choose House Favourite' }));
    expect(toast.getByText('60 → 60 seconds base cook work')).toBeInTheDocument();
    expect(toast.getByText('50 → 60 popularity')).toBeInTheDocument();
    fireEvent.click(toast.getByRole('button', { name: 'Confirm House Favourite' }));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ type: 'CHOOSE_DISH_MASTERY', cookbookId: 'toast', perk: 'appeal' });
  });

  it('shows permanently chosen effective stats and retained settings, without another choice', () => {
    state = paidToast(state, 15);
    state.cookbook.entries.toast.perk = 'speed';
    state.cookbook.entries.toast.menuSettings = { name: 'House Toast', price: 24, quality: 4 };
    state.dishes = [];
    render(<CookbookPanel onClose={vi.fn()} />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    expect(toast.getByText('Signature: Quick Service')).toBeInTheDocument();
    expect(toast.getByText('60 → 51 seconds base cook work')).toBeInTheDocument();
    expect(toast.getByText(/House Toast.*\$24.*Quality 4/)).toBeInTheDocument();
    expect(toast.queryByRole('button', { name: 'Choose House Favourite' })).not.toBeInTheDocument();
    expect(toast.getByText('Paid portions: 15/15')).toBeInTheDocument();
  });

  it('careerDecisionPreservesCookbook: an already-open confirmation becomes read-only', () => {
    state = paidToast(state, 15);
    const before = structuredClone(state.cookbook);
    const view = render(<CookbookPanel onClose={vi.fn()} />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    fireEvent.click(toast.getByRole('button', { name: 'Choose Quick Service' }));
    state.careerRun = { needsDecision: true };
    view.rerender(<CookbookPanel onClose={vi.fn()} />);
    expect(screen.getByText(/Career decision pending/)).toBeInTheDocument();
    const confirm = toast.getByRole('button', { name: 'Confirm Quick Service' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.cookbook).toEqual(before);
    expect(screen.getByRole('button', { name: 'Back to menu' })).toBeEnabled();
  });

  it('honours a parent-provided read-only gate and keeps Back to menu available', () => {
    state = paidToast(state, 3);
    const onClose = vi.fn();
    render(<CookbookPanel readOnly onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Add Cheese Toast to menu' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
