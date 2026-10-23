import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CookbookPanel from './CookbookPanel';
import { useDispatch, useGameState } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { applyCookbookPaidVisit, getCookbookEntryStatus, normaliseCookbookState, reconcileCookbookDiscoveries } from '../simulation/cookbook';

vi.mock('../state/GameContext', () => ({ useGameState: vi.fn(), useDispatch: vi.fn() }));
vi.mock('../simulation/cookbook', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, getCookbookEntryStatus: vi.fn(actual.getCookbookEntryStatus) };
});

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

  it('shows all seven named recipes, numeric locked requirements and starter progress', () => {
    render(<CookbookPanel onClose={vi.fn()} />);
    expect(screen.getAllByRole('article')).toHaveLength(7);
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
    const gazpacho = within(screen.getByRole('article', { name: 'Gazpacho recipe' }));
    expect(gazpacho.getByText('Locked — meet the discovery requirements below')).toBeInTheDocument();
    expect(gazpacho.getByText('Own Blender: 0/1')).toBeInTheDocument();
    expect(gazpacho.getByRole('button', { name: 'Add Gazpacho to menu' })).toBeDisabled();
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

  it('discovers the Blender recipe on ownership and adds it without a placed station', () => {
    state.equipment = state.equipment.map(equipment =>
      equipment.id === 'eq4' ? { ...equipment, owned: true } : equipment);
    state.cookbook = reconcileCookbookDiscoveries(state);
    render(<CookbookPanel onClose={vi.fn()} />);
    const gazpacho = within(screen.getByRole('article', { name: 'Gazpacho recipe' }));
    expect(gazpacho.getByText('Discovered')).toBeInTheDocument();
    expect(gazpacho.getByText('Ready to add')).toBeInTheDocument();
    expect(gazpacho.getByText(/No matching kitchen station/)).toBeInTheDocument();
    fireEvent.click(gazpacho.getByRole('button', { name: 'Add Gazpacho to menu' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_COOKBOOK_DISH', cookbookId: 'gazpacho' });
  });

  it('offers the Gazpacho mastery preview once 15 paid portions are recorded', () => {
    state.equipment = state.equipment.map(equipment =>
      equipment.id === 'eq4' ? { ...equipment, owned: true } : equipment);
    state.cookbook = reconcileCookbookDiscoveries(state);
    state.cookbook = { ...state.cookbook, entries: { ...state.cookbook.entries,
      gazpacho: { ...state.cookbook.entries.gazpacho, paidPortions: 15 } } };
    state.dishes = [];
    render(<CookbookPanel onClose={vi.fn()} />);
    const gazpacho = within(screen.getByRole('article', { name: 'Gazpacho recipe' }));
    expect(gazpacho.getByText('Signature choice available')).toBeInTheDocument();
    fireEvent.click(gazpacho.getByRole('button', { name: 'Choose Quick Service' }));
    expect(gazpacho.getByText('75 → 64 seconds base cook work')).toBeInTheDocument();
    expect(gazpacho.getByText('55 → 55 popularity')).toBeInTheDocument();
    fireEvent.click(gazpacho.getByRole('button', { name: 'Confirm Quick Service' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'CHOOSE_DISH_MASTERY', cookbookId: 'gazpacho', perk: 'speed' });
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

  it('offers All and Ready actions with pressed state, an adjacent count and no dispatch', () => {
    state = paidToast(state, 3);
    render(<CookbookPanel onClose={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Cookbook view' });
    const all = within(group).getByRole('button', { name: 'All' });
    const ready = within(group).getByRole('button', { name: 'Ready actions' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(ready).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByText('1 recipes have ready actions.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(7);
    fireEvent.click(ready);
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(ready).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Cheese Toast recipe' })).toBeInTheDocument();
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(ready).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('article')).toHaveLength(7);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('includes each recipe whose status canAdd or canChoosePerk exactly once', () => {
    state = paidToast(state, 15);
    state.equipment = state.equipment.map(equipment =>
      equipment.id === 'eq4' ? { ...equipment, owned: true } : equipment);
    state.cookbook = reconcileCookbookDiscoveries(state);
    state.cookbook = { ...state.cookbook, entries: { ...state.cookbook.entries,
      gazpacho: { ...state.cookbook.entries.gazpacho, paidPortions: 15 } } };
    render(<CookbookPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ready actions' }));
    expect(screen.getByText('3 recipes have ready actions.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('article', { name: 'Toasted Bread recipe' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Cheese Toast recipe' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Gazpacho recipe' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Roast Vegetables recipe' })).not.toBeInTheDocument();
  });

  it('keeps the ready truth independent of a career-decision block and guards mutations', () => {
    state = paidToast(state, 3);
    state.careerRun = { needsDecision: true };
    render(<CookbookPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ready actions' }));
    expect(screen.getByText('1 recipes have ready actions.')).toBeInTheDocument();
    const cheese = within(screen.getByRole('article', { name: 'Cheese Toast recipe' }));
    const add = cheese.getByRole('button', { name: 'Add Cheese Toast to menu' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/Career decision pending/)).toBeInTheDocument();
  });

  it('recomputes the ready count and filtered list when state changes on rerender', () => {
    state = paidToast(state, 3);
    const view = render(<CookbookPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ready actions' }));
    expect(screen.getByText('1 recipes have ready actions.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    state = paidToast(state, 15);
    view.rerender(<CookbookPanel onClose={vi.fn()} />);
    expect(screen.getByText('2 recipes have ready actions.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('article', { name: 'Toasted Bread recipe' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Cheese Toast recipe' })).toBeInTheDocument();
  });

  it('computes each recipe status exactly once per render', () => {
    getCookbookEntryStatus.mockClear();
    render(<CookbookPanel onClose={vi.fn()} />);
    expect(getCookbookEntryStatus).toHaveBeenCalledTimes(7);
    expect(new Set(getCookbookEntryStatus.mock.calls.map(([, cookbookId]) => cookbookId)).size).toBe(7);
  });

  it('shows the empty ready message when no recipe has a ready action', () => {
    render(<CookbookPanel onClose={vi.fn()} />);
    expect(screen.getByText('0 recipes have ready actions.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ready actions' }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('No recipes have ready actions.')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('pins an open signature confirmation that stops qualifying, excludes it from the count and keeps Cancel reachable', () => {
    state = paidToast(state, 15);
    const view = render(<CookbookPanel onClose={vi.fn()} />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    fireEvent.click(toast.getByRole('button', { name: 'Choose Quick Service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ready actions' }));
    expect(screen.queryByText('Shown while its signature choice is open.')).not.toBeInTheDocument();
    state.cookbook = { ...state.cookbook, entries: { ...state.cookbook.entries,
      toast: { ...state.cookbook.entries.toast, paidPortions: 14 } } };
    view.rerender(<CookbookPanel onClose={vi.fn()} />);
    expect(screen.getByText('1 recipes have ready actions.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    const pinned = within(screen.getByRole('article', { name: 'Toasted Bread recipe' }));
    expect(pinned.getByText('Shown while its signature choice is open.')).toBeInTheDocument();
    const confirm = pinned.getByRole('button', { name: 'Confirm Quick Service' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(dispatch).not.toHaveBeenCalled();
    const cancel = pinned.getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('article', { name: 'Toasted Bread recipe' })).not.toBeInTheDocument();
    expect(screen.queryByText('Shown while its signature choice is open.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});
