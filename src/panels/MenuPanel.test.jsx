import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuPanel from './MenuPanel';
import { useDispatch, useGameState } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { normaliseCookbookState } from '../simulation/cookbook';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

describe('MenuPanel drinks', () => {
  beforeEach(() => {
    useGameState.mockReturnValue({
      dishes: [{
        id: 'toast', name: 'Toast', price: 12, prepTime: 60,
        quality: 2, popularity: 45,
      }],
      recipeSlots: 1,
      equipment: [{ id: 'eq1', name: 'Toaster', owned: true }],
      unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 8, quality: 3 } },
      upgrades: [],
      restaurant: { funds: 200, reputation: 3 },
    });
    useDispatch.mockReturnValue(vi.fn());
  });

  it('shows unlocked Water with resolved menu controls and demand', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    const waterCard = screen.getByRole('article', { name: 'Water menu item' });
    expect(within(waterCard).getByLabelText('Water price')).toHaveValue(8);
    expect(within(waterCard).getByText(/Estimated demand: \d+%/)).toBeInTheDocument();
    expect(within(waterCard).getByText(/Quality: .* Lv\.3/)).toBeInTheDocument();
    expect(within(waterCard).getByText('Popularity: 50%')).toBeInTheDocument();
    expect(within(waterCard).getByText('$8 · 120s prep')).toBeInTheDocument();
    expect(within(waterCard).getByRole('button', { name: 'Upgrade Water quality ($50)' })).toBeEnabled();
    expect(screen.getByText('Menu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlock Water/ })).not.toBeInTheDocument();

    fireEvent.change(within(waterCard).getByLabelText('Water price'), { target: { value: '9' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_DRINK', id: 'water', changes: { price: 9 },
    });
    fireEvent.click(within(waterCard).getByRole('button', { name: 'Upgrade Water quality ($50)' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_DRINK_QUALITY', id: 'water' });
  });

  it('keeps dish pricing dispatch behavior and adds demand', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    const dishCard = screen.getByRole('article', { name: 'Toast menu item' });
    expect(within(dishCard).getByText(/Estimated demand: \d+%/)).toBeInTheDocument();
    fireEvent.change(within(dishCard).getByLabelText('Toast price'), { target: { value: '14' } });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_DISH', id: 'toast', changes: { price: 14 },
    });
  });

  it('keeps locked Tea limited to its unlock action', () => {
    render(<MenuPanel />);

    const teaCard = screen.getByRole('article', { name: 'Tea menu item' });
    expect(within(teaCard).getByRole('button', { name: 'Unlock Tea ($150)' })).toBeInTheDocument();
    expect(within(teaCard).queryByLabelText('Tea price')).not.toBeInTheDocument();
    expect(within(teaCard).queryByRole('button', { name: 'Upgrade Tea quality ($50)' })).not.toBeInTheDocument();
    expect(within(teaCard).queryByText(/Estimated demand:/)).not.toBeInTheDocument();
  });

  it('shows a neutral canonical preview for every locked drink', () => {
    render(<MenuPanel />);

    const previews = [
      ['Tea', 'Price: $4 · Base prep: 120s · Popularity: 55%'],
      ['Soda', 'Price: $5 · Base prep: 120s · Popularity: 60%'],
      ['Coffee', 'Price: $6 · Base prep: 120s · Popularity: 65%'],
      ['Juice', 'Price: $7 · Base prep: 120s · Popularity: 70%'],
      ['Iced Tea', 'Price: $4 · Base prep: 90s · Popularity: 45%'],
    ];
    for (const [name, text] of previews) {
      const card = screen.getByRole('article', { name: `${name} menu item` });
      expect(within(card).getByText(text)).toBeInTheDocument();
    }

    const icedTeaCard = screen.getByRole('article', { name: 'Iced Tea menu item' });
    expect(within(icedTeaCard).getByRole('button', { name: 'Unlock Iced Tea ($150)' })).toBeInTheDocument();
    expect(within(icedTeaCard).queryByLabelText('Iced Tea price')).not.toBeInTheDocument();
    expect(within(icedTeaCard).queryByText(/Estimated demand:/)).not.toBeInTheDocument();
  });

  it('dispatches a canonical Iced Tea unlock and respects affordability and read-only guards', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const view = render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock Iced Tea ($150)' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'UNLOCK_DRINK', id: 'iced-tea' });

    const base = useGameState();
    useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, funds: 149 } });
    view.rerender(<MenuPanel />);
    expect(screen.getByRole('button', { name: 'Unlock Iced Tea ($150)' })).toBeDisabled();

    useGameState.mockReturnValue(base);
    view.rerender(<MenuPanel readOnly />);
    expect(screen.getByRole('button', { name: 'Unlock Iced Tea ($150)' })).toBeDisabled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('shows the unlocked Iced Tea canonical 90s duration and keeps its controls', () => {
    const base = useGameState();
    useGameState.mockReturnValue({ ...base, unlockedDrinkIds: ['water', 'iced-tea'] });
    render(<MenuPanel />);

    const card = screen.getByRole('article', { name: 'Iced Tea menu item' });
    expect(within(card).getByText('$4 · 90s prep')).toBeInTheDocument();
    expect(within(card).getByText('Popularity: 45%')).toBeInTheDocument();
    expect(within(card).getByLabelText('Iced Tea price')).toHaveValue(4);
    expect(within(card).getByRole('button', { name: 'Upgrade Iced Tea quality ($50)' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Unlock Iced Tea/ })).not.toBeInTheDocument();
    expect(within(card).queryByText('Price: $4 · Base prep: 90s · Popularity: 45%')).not.toBeInTheDocument();
  });

  it('dispatches a canonical Tea unlock', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock Tea ($150)' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'UNLOCK_DRINK', id: 'tea' });
  });

  it('disables unaffordable drinks', () => {
    useGameState.mockReturnValue({
      dishes: [], recipeSlots: 1, unlockedDrinkIds: ['water'], drinkOverrides: {},
      upgrades: [], restaurant: { funds: 149, reputation: 3 },
    });
    render(<MenuPanel />);

    expect(screen.getByRole('button', { name: 'Unlock Tea ($150)' })).toBeDisabled();
  });

  it('reserves room beside New dish for the modal close button', () => {
    render(<MenuPanel />);

    const headingRow = screen.getByRole('heading', { name: 'Menu' }).parentElement;
    expect(headingRow).toHaveStyle({ paddingRight: '40px' });
    expect(within(headingRow).getByRole('button', { name: '+ New dish' }))
      .toBeInTheDocument();
  });

  it('browses the cookbook child and returns without losing creator or drink controls', () => {
    render(<MenuPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    expect(screen.getByRole('heading', { name: 'Cookbook' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(7);
    expect(screen.queryByRole('region', { name: 'Menu affordability' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));
    expect(screen.getByRole('button', { name: '+ New dish' })).toBeEnabled();
    expect(screen.getByLabelText('Water price')).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Menu affordability' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    expect(screen.getByRole('heading', { name: 'Create new dish' })).toBeInTheDocument();
  });

  it('shows authored effective seconds, popularity and mastery separately from custom dishes', () => {
    let state = createInitialState();
    state = { ...state, ...normaliseCookbookState(state, { legacy: true }) };
    Object.assign(state.cookbook.entries.toast, { paidPortions: 15, perk: 'speed' });
    state.dishes.push({ ...state.dishes[0], cookbookId: null, id: 'custom', name: 'Custom Toast', prepTime: 180 });
    useGameState.mockReturnValue(state);
    render(<MenuPanel />);
    const toast = within(screen.getByRole('article', { name: 'Toasted Bread menu item' }));
    expect(toast.getByText('$12 · 51s cook')).toBeInTheDocument();
    expect(toast.getByText('Popularity: 50%')).toBeInTheDocument();
    expect(toast.getByText('Cookbook recipe · Signature: Quick Service')).toBeInTheDocument();
    expect(screen.getByText('Custom recipe')).toBeInTheDocument();
    expect(screen.getByText(/base cooking work, not the complete wait time/)).toBeInTheDocument();
  });

  it('career decision blocks dish, drink and creator mutations while allowing cookbook browsing', () => {
    const state = useGameState();
    useGameState.mockReturnValue({ ...state, careerRun: { needsDecision: true } });
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);
    expect(screen.getByText(/Career decision pending/)).toBeInTheDocument();
    for (const name of ['+ New dish', 'Upgrade Toast quality ($50)', 'Remove', 'Upgrade Water quality ($50)', 'Unlock Tea ($150)']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByLabelText('Toast price')).toBeDisabled();
    expect(screen.getByLabelText('Water price')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Toast price'), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Water price'), { target: { value: '99' } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    expect(screen.getByRole('button', { name: 'Back to menu' })).toBeEnabled();
  });

  it('suppresses an already-open custom creator when the parent gate becomes read-only', () => {
    const view = render(<MenuPanel />);
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    view.rerender(<MenuPanel readOnly />);
    expect(screen.queryByRole('heading', { name: 'Create new dish' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New dish' })).toBeDisabled();
  });

  describe('menu affordability', () => {
    const coverage = label => screen.getByText(label);

    it('shows the read-only summary, exact labels and caveat without dispatching on render', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      const region = screen.getByRole('region', { name: 'Menu affordability' });
      expect(within(region).getByText('Can afford an order containing a dish: 80.4%')).toBeInTheDocument();
      expect(within(region).getByText('Can afford any order, including drink-only: 93.5%')).toBeInTheDocument();
      expect(within(region).getByText(
        'Price-only coverage for new walk-in guest budgets at current reputation, not existing guests or booked contracts. These overlapping percentages are not additive and do not predict purchases or service capacity. Item demand uses sampled budgets and preferences.',
      )).toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('shows zero coverage for an empty menu and keeps the no-dishes message', () => {
      useGameState.mockReturnValue({
        dishes: [], recipeSlots: 1, unlockedDrinkIds: [], drinkOverrides: {},
        upgrades: [], restaurant: { funds: 200, reputation: 3 },
      });
      render(<MenuPanel />);

      const region = screen.getByRole('region', { name: 'Menu affordability' });
      expect(within(region).getByText('Can afford an order containing a dish: 0%')).toBeInTheDocument();
      expect(within(region).getByText('Can afford any order, including drink-only: 0%')).toBeInTheDocument();
      expect(screen.getByText('No dishes yet. Create your first dish!')).toBeInTheDocument();
    });

    it('updates dish coverage when a dish price changes', () => {
      const view = render(<MenuPanel />);
      expect(coverage('Can afford an order containing a dish: 80.4%')).toBeInTheDocument();

      const base = useGameState();
      useGameState.mockReturnValue({ ...base, dishes: [{ ...base.dishes[0], price: 19 }] });
      view.rerender(<MenuPanel />);

      expect(coverage('Can afford an order containing a dish: 53.6%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 93.5%')).toBeInTheDocument();
    });

    it('updates order coverage when the Water price changes', () => {
      const view = render(<MenuPanel />);
      const base = useGameState();
      useGameState.mockReturnValue({ ...base, drinkOverrides: { water: { price: 100 } } });
      view.rerender(<MenuPanel />);

      expect(coverage('Can afford an order containing a dish: 80.4%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 80.4%')).toBeInTheDocument();
    });

    it('updates coverage when reputation changes', () => {
      const view = render(<MenuPanel />);
      const base = useGameState();
      useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, reputation: 5 } });
      view.rerender(<MenuPanel />);

      expect(coverage('Can afford an order containing a dish: 93.1%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 97.7%')).toBeInTheDocument();
    });

    it('updates order coverage when the last unlocked drink is locked', () => {
      const view = render(<MenuPanel />);
      const base = useGameState();
      useGameState.mockReturnValue({ ...base, unlockedDrinkIds: [] });
      view.rerender(<MenuPanel />);

      expect(coverage('Can afford an order containing a dish: 80.4%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 80.4%')).toBeInTheDocument();
    });

    it('formats exact endpoints and the smallest positive coverage', () => {
      useGameState.mockReturnValue({
        dishes: [{ id: 'toast', name: 'Toast', price: 6, prepTime: 60, quality: 2, popularity: 45 }],
        recipeSlots: 1, unlockedDrinkIds: [], drinkOverrides: {}, upgrades: [],
        restaurant: { funds: 200, reputation: 1 },
      });
      const view = render(<MenuPanel />);
      expect(coverage('Can afford an order containing a dish: 100%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 100%')).toBeInTheDocument();

      const base = useGameState();
      useGameState.mockReturnValue({ ...base, dishes: [{ ...base.dishes[0], price: 120 }] });
      view.rerender(<MenuPanel />);
      expect(coverage('Can afford an order containing a dish: 0.1%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 0.1%')).toBeInTheDocument();

      useGameState.mockReturnValue({ ...base, dishes: [{ ...base.dishes[0], price: 19 }] });
      view.rerender(<MenuPanel />);
      expect(coverage('Can afford an order containing a dish: 26.8%')).toBeInTheDocument();
    });

    it('shows exact 100% endpoints when every budget is covered at reputation 3', () => {
      useGameState.mockReturnValue({
        dishes: [{ id: 'toast', name: 'Toast', price: 6, prepTime: 60, quality: 2, popularity: 45 }],
        recipeSlots: 1, unlockedDrinkIds: [], drinkOverrides: {}, upgrades: [],
        restaurant: { funds: 200, reputation: 3 },
      });
      const view = render(<MenuPanel />);
      expect(coverage('Can afford an order containing a dish: 100%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 100%')).toBeInTheDocument();

      const base = useGameState();
      useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, reputation: 2 } });
      view.rerender(<MenuPanel />);
      expect(coverage('Can afford an order containing a dish: 100%')).toBeInTheDocument();
      expect(coverage('Can afford any order, including drink-only: 100%')).toBeInTheDocument();
    });

    it('keeps coverage visible and editing blocked while a career decision is pending', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const base = useGameState();
      useGameState.mockReturnValue({ ...base, careerRun: { needsDecision: true } });
      render(<MenuPanel />);

      const region = screen.getByRole('region', { name: 'Menu affordability' });
      expect(within(region).getByText('Can afford an order containing a dish: 80.4%')).toBeInTheDocument();
      expect(within(region).getByText('Can afford any order, including drink-only: 93.5%')).toBeInTheDocument();
      expect(screen.getByLabelText('Toast price')).toBeDisabled();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
