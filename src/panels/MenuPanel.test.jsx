import { useReducer } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuPanel from './MenuPanel';
import { useDispatch, useGameState, gameReducer } from '../state/GameContext';
import { createInitialState } from '../state/initialState';
import { createCookbookState, normaliseCookbookState } from '../simulation/cookbook';
import { estimateMenuDemand, getMenuAnalysis } from '../simulation/menuEconomy';
import * as menuEconomy from '../simulation/menuEconomy';

vi.mock('../state/GameContext', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    useGameState: vi.fn(),
    useDispatch: vi.fn(),
  };
});

const statefulHarness = { current: null };

function StatefulMenuPanel({ initial, actions }) {
  const [state, dispatch] = useReducer(gameReducer, initial);
  statefulHarness.current = {
    state,
    dispatch: action => {
      actions.push(action);
      dispatch(action);
    },
  };
  return <MenuPanel />;
}

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

    const waterPrice = within(waterCard).getByLabelText('Water price');
    fireEvent.change(waterPrice, { target: { value: '9' } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.blur(waterPrice);
    expect(dispatch).toHaveBeenCalledTimes(1);
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
    const toastPrice = within(dishCard).getByLabelText('Toast price');
    fireEvent.change(toastPrice, { target: { value: '14' } });
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.blur(toastPrice);
    expect(dispatch).toHaveBeenCalledTimes(1);
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
      ['Premium Lemonade', 'Price: $9 · Base prep: 180s · Popularity: 75%'],
    ];
    for (const [name, text] of previews) {
      const card = screen.getByRole('article', { name: `${name} menu item` });
      expect(within(card).getByText(text)).toBeInTheDocument();
    }

    const icedTeaCard = screen.getByRole('article', { name: 'Iced Tea menu item' });
    expect(within(icedTeaCard).getByRole('button', { name: 'Unlock Iced Tea ($150)' })).toBeInTheDocument();
    expect(within(icedTeaCard).queryByLabelText('Iced Tea price')).not.toBeInTheDocument();
    expect(within(icedTeaCard).queryByText(/Estimated demand:/)).not.toBeInTheDocument();

    const lemonadeCard = screen.getByRole('article', { name: 'Premium Lemonade menu item' });
    expect(within(lemonadeCard).getByRole('button', {
      name: 'Unlock Premium Lemonade ($450)',
    })).toBeInTheDocument();
    expect(within(lemonadeCard).queryByLabelText('Premium Lemonade price')).not.toBeInTheDocument();
    expect(within(lemonadeCard).queryByText(/Estimated demand:/)).not.toBeInTheDocument();
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

  it('shows unlocked Premium Lemonade with its canonical 180s duration and ordinary controls', () => {
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base, unlockedDrinkIds: ['water', 'premium-lemonade'],
    });
    render(<MenuPanel />);

    const card = screen.getByRole('article', { name: 'Premium Lemonade menu item' });
    expect(within(card).getByText('$9 · 180s prep')).toBeInTheDocument();
    expect(within(card).getByText('Popularity: 75%')).toBeInTheDocument();
    expect(within(card).getByLabelText('Premium Lemonade price')).toHaveValue(9);
    expect(within(card).getByRole('button', {
      name: 'Upgrade Premium Lemonade quality ($50)',
    })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Unlock Premium Lemonade/ }))
      .not.toBeInTheDocument();
  });

  it('dispatches the canonical Premium Lemonade unlock and enforces its funds boundary', () => {
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base, restaurant: { ...base.restaurant, funds: 450 },
    });
    const view = render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock Premium Lemonade ($450)' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'UNLOCK_DRINK', id: 'premium-lemonade' });

    useGameState.mockReturnValue({
      ...base, restaurant: { ...base.restaurant, funds: 449 },
    });
    view.rerender(<MenuPanel />);
    expect(screen.getByRole('button', { name: 'Unlock Premium Lemonade ($450)' })).toBeDisabled();
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
    expect(screen.getAllByRole('article')).toHaveLength(9);
    expect(screen.queryByRole('region', { name: 'Menu affordability' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));
    expect(screen.getByRole('button', { name: '+ New dish' })).toBeEnabled();
    expect(screen.getByLabelText('Water price')).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Menu affordability' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    expect(screen.getByRole('heading', { name: 'Create new dish' })).toBeInTheDocument();
  });

  it('focuses the first available control on entry to Cookbook and New dish', () => {
    render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    expect(screen.getByRole('button', { name: 'Back to menu' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    expect(screen.getByRole('combobox', { name: 'Base ingredient:' })).toHaveFocus();
  });

  it('returns focus to the Cookbook opener after Back', () => {
    render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));

    expect(screen.getByRole('button', { name: 'Cookbook' })).toHaveFocus();
  });

  it('preserves Cookbook focus across an ordinary parent rerender', () => {
    const view = render(<MenuPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));

    const readyActions = screen.getByRole('button', { name: 'Ready actions' });
    readyActions.focus();
    const state = useGameState();
    useGameState.mockReturnValue({
      ...state,
      restaurant: { ...state.restaurant, funds: state.restaurant.funds + 1 },
    });
    view.rerender(<MenuPanel />);

    expect(readyActions).toHaveFocus();
  });

  it('preserves creator focus on rerender and restores the New dish opener on Cancel', () => {
    const view = render(<MenuPanel />);
    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));

    const dishName = screen.getByLabelText('Dish name:');
    dishName.focus();
    const state = useGameState();
    useGameState.mockReturnValue({
      ...state,
      restaurant: { ...state.restaurant, funds: state.restaurant.funds + 1 },
    });
    view.rerender(<MenuPanel />);

    expect(dishName).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: '+ New dish' })).toHaveFocus();
  });

  it('returns focus to New dish after successful creation', () => {
    const state = useGameState();
    useGameState.mockReturnValue({
      ...state,
      equipment: [...state.equipment, { id: 'eq2', name: 'Oven', owned: true }],
    });
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
    fireEvent.change(screen.getByLabelText('Dish name:'), { target: { value: 'Soup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'ADD_DISH', dish: { name: 'Soup' } });
    expect(screen.getByRole('button', { name: '+ New dish' })).toHaveFocus();
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

  describe('cookbook mastery progress', () => {
    const stateWithMastery = (paidPortions, perk = null) => {
      const state = createInitialState();
      state.cookbook.entries.toast = {
        ...state.cookbook.entries.toast, paidPortions, perk,
      };
      return state;
    };
    const toastCard = () => screen.getByRole('article', {
      name: 'Toasted Bread menu item',
    });

    it.each([
      [0, false],
      [14, false],
      [15, true],
    ])('shows cumulative progress and choice availability at %i paid portions', (paidPortions, canChoose) => {
      const dispatch = vi.fn();
      useGameState.mockReturnValue(stateWithMastery(paidPortions));
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      expect(within(toastCard()).getByText(new RegExp(
        `Mastery progress: ${paidPortions}/15 paid portions \\(cumulative\\)`,
      ))).toBeVisible();
      if (canChoose) {
        expect(toastCard()).toHaveTextContent('Signature choice available in Cookbook');
      } else {
        expect(toastCard()).not.toHaveTextContent('Signature choice available in Cookbook');
      }
      expect(screen.queryByRole('button', { name: /Choose (Quick Service|House Favourite)/ }))
        .not.toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it.each([
      ['speed', 'Quick Service'],
      ['appeal', 'House Favourite'],
    ])('retains the %s signature label without adding another signature action', (perk, label) => {
      useGameState.mockReturnValue(stateWithMastery(15, perk));
      render(<MenuPanel />);

      expect(toastCard()).toHaveTextContent('Mastery progress: 15/15 paid portions (cumulative)');
      expect(within(toastCard()).getByText(`Cookbook recipe · Signature: ${label}`)).toBeVisible();
      expect(toastCard()).not.toHaveTextContent('Signature choice available in Cookbook');
      expect(screen.queryByRole('button', { name: /Choose (Quick Service|House Favourite)/ }))
        .not.toBeInTheDocument();
    });

    it('omits mastery progress from custom dishes', () => {
      const state = stateWithMastery(14);
      state.dishes.push({
        ...state.dishes[0], id: 'custom-toast', cookbookId: null, name: 'Custom Toast',
      });
      useGameState.mockReturnValue(state);
      render(<MenuPanel />);

      expect(toastCard()).toHaveTextContent('Mastery progress: 14/15 paid portions (cumulative)');
      expect(within(screen.getByRole('article', { name: 'Custom Toast menu item' }))
        .queryByText(/Mastery progress:/)).not.toBeInTheDocument();
    });

    it('updates cumulative progress and choice availability on rerender without dispatch', () => {
      const state = stateWithMastery(14);
      const dispatch = vi.fn();
      useGameState.mockReturnValue(state);
      useDispatch.mockReturnValue(dispatch);
      const view = render(<MenuPanel />);

      expect(toastCard()).toHaveTextContent('Mastery progress: 14/15 paid portions (cumulative)');
      expect(toastCard()).not.toHaveTextContent('Signature choice available in Cookbook');

      useGameState.mockReturnValue({
        ...state,
        cookbook: {
          ...state.cookbook,
          entries: {
            ...state.cookbook.entries,
            toast: { ...state.cookbook.entries.toast, paidPortions: 15 },
          },
        },
      });
      view.rerender(<MenuPanel />);

      expect(toastCard()).toHaveTextContent('Mastery progress: 15/15 paid portions (cumulative)');
      expect(toastCard()).toHaveTextContent('Signature choice available in Cookbook');
      expect(toastCard()).toHaveTextContent('Paid today: 0');
      expect(dispatch).not.toHaveBeenCalled();
    });

    it.each([
      ['read-only', true, false],
      ['career decision', false, true],
    ])('keeps mastery progress and Cookbook browsing available during %s mode', (_label, readOnly, needsDecision) => {
      const state = stateWithMastery(15);
      useGameState.mockReturnValue(needsDecision
        ? { ...state, careerRun: { needsDecision: true } }
        : state);
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel readOnly={readOnly} />);

      expect(toastCard()).toHaveTextContent('Mastery progress: 15/15 paid portions (cumulative)');
      expect(toastCard()).toHaveTextContent('Signature choice available in Cookbook');
      expect(screen.getByRole('button', { name: 'Cookbook' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));

      expect(screen.getByRole('heading', { name: 'Cookbook' })).toBeVisible();
      expect(screen.getByText('Signature choice available')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Choose Quick Service' })).toBeDisabled();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('career decision blocks dish, drink and creator mutations while allowing cookbook browsing', () => {
    const state = useGameState();
    useGameState.mockReturnValue({ ...state, careerRun: { needsDecision: true } });
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);
    expect(screen.getByText(/Career decision pending/)).toBeInTheDocument();
    for (const name of ['+ New dish', 'Upgrade Toast quality ($50)', 'Remove Toast from menu', 'Upgrade Water quality ($50)', 'Unlock Tea ($150)']) {
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
        'Price-only coverage for new walk-in guest budgets at current reputation, not existing guests or booked contracts. These overlapping percentages are not additive and do not predict purchases or service capacity. Item demand weights every possible budget and guest preference; item percentages overlap and are not additive.',
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

  describe('menu item demand', () => {
    const demandText = (state, kind, id) => {
      const demand = estimateMenuDemand(state);
      return `Estimated demand: ${(kind === 'dish' ? demand.dishes : demand.drinks).get(id) ?? 0}%`;
    };

    const singleDish = (price, reputation = 1) => ({
      dishes: [{ id: 'toast', name: 'Toast', price, prepTime: 60, quality: 2, popularity: 45 }],
      recipeSlots: 1, equipment: [], unlockedDrinkIds: [], drinkOverrides: {}, upgrades: [],
      restaurant: { funds: 200, reputation },
    });

    it('shows exhaustive integer-budget demand and updates it as the price crosses tiers', () => {
      const cheap = singleDish(7);
      useGameState.mockReturnValue(cheap);
      const view = render(<MenuPanel />);
      const card = () => within(screen.getByRole('article', { name: 'Toast menu item' }));
      expect(card().getByText('Estimated demand: 95%')).toBeInTheDocument();

      const dearer = singleDish(19);
      useGameState.mockReturnValue(dearer);
      view.rerender(<MenuPanel />);

      expect(card().getByText('Estimated demand: 27%')).toBeInTheDocument();
      expect(card().getByText(demandText(dearer, 'dish', 'toast'))).toBeInTheDocument();
    });

    it('updates dish, drink, quality and reputation demand on rerender', () => {
      const base = {
        dishes: [
          { id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45 },
          { id: 'rival', name: 'Rival', price: 12, prepTime: 60, quality: 2, popularity: 45 },
        ],
        recipeSlots: 1, equipment: [], unlockedDrinkIds: ['water'],
        drinkOverrides: { water: { price: 8, quality: 3 } }, upgrades: [],
        restaurant: { funds: 200, reputation: 3 },
      };
      useGameState.mockReturnValue(base);
      const view = render(<MenuPanel />);
      const dishDemand = () => within(screen.getByRole('article', { name: 'Toast menu item' }))
        .getByText(/Estimated demand: /).textContent;
      const drinkDemand = () => within(screen.getByRole('article', { name: 'Water menu item' }))
        .getByText(/Estimated demand: /).textContent;
      const expectShown = state => {
        expect(dishDemand()).toBe(demandText(state, 'dish', 'toast'));
        expect(drinkDemand()).toBe(demandText(state, 'drink', 'water'));
      };
      const initialToast = dishDemand();
      const initialWater = drinkDemand();
      expectShown(base);

      const repricedDish = { ...base, dishes: [{ ...base.dishes[0], price: 19 }, base.dishes[1]] };
      useGameState.mockReturnValue(repricedDish);
      view.rerender(<MenuPanel />);
      expectShown(repricedDish);
      expect(dishDemand()).not.toBe(initialToast);

      const repricedDrink = { ...base, drinkOverrides: { water: { price: 11, quality: 3 } } };
      useGameState.mockReturnValue(repricedDrink);
      view.rerender(<MenuPanel />);
      expectShown(repricedDrink);
      expect(drinkDemand()).not.toBe(initialWater);

      const upgradedDish = { ...base, dishes: [{ ...base.dishes[0], quality: 10 }, base.dishes[1]] };
      useGameState.mockReturnValue(upgradedDish);
      view.rerender(<MenuPanel />);
      expectShown(upgradedDish);
      expect(dishDemand()).not.toBe(initialToast);

      const famous = { ...base, restaurant: { ...base.restaurant, reputation: 5 } };
      useGameState.mockReturnValue(famous);
      view.rerender(<MenuPanel />);
      expectShown(famous);
      expect(dishDemand()).not.toBe(initialToast);
      expect(drinkDemand()).not.toBe(initialWater);
    });

    it('updates demand when a cookbook dish resolution changes', () => {
      const cookbookState = price => ({
        dishes: [
          { id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45 },
          { id: 'cookbook-toast', cookbookId: 'toast' },
        ],
        recipeSlots: 1, equipment: [], unlockedDrinkIds: [], drinkOverrides: {}, upgrades: [],
        restaurant: { funds: 200, reputation: 3 },
        cookbook: {
          schemaVersion: 2,
          lastAppliedPaidVisitSequence: 0,
          entries: {
            toast: {
              discovered: true, paidPortions: 0, perk: null,
              menuSettings: { name: 'Toasted Bread', price, quality: 2 },
            },
          },
        },
      });
      const before = cookbookState(12);
      useGameState.mockReturnValue(before);
      const view = render(<MenuPanel />);
      const demand = () => within(screen.getByRole('article', { name: 'Toasted Bread menu item' }))
        .getByText(/Estimated demand: /).textContent;
      const beforeText = demand();
      expect(beforeText).toBe(demandText(before, 'dish', 'cookbook-toast'));

      const after = cookbookState(30);
      useGameState.mockReturnValue(after);
      view.rerender(<MenuPanel />);

      expect(demand()).toBe(demandText(after, 'dish', 'cookbook-toast'));
      expect(demand()).not.toBe(beforeText);
    });
  });

  describe('menu suspension controls', () => {
    it('enables one bulk-resume action only when a manual suspension is present', () => {
      const base = useGameState();
      const empty = {
        ...base,
        restaurant: {
          ...base.restaurant,
          suspendedDishIds: [],
          suspendedDrinkIds: [],
        },
      };
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      useGameState.mockReturnValue(empty);
      const view = render(<MenuPanel />);

      const resumeAll = screen.getByRole('button', {
        name: 'Resume all manually suspended items',
      });
      expect(resumeAll).toBeDisabled();
      expect(dispatch).not.toHaveBeenCalled();

      useGameState.mockReturnValue({
        ...empty,
        restaurant: {
          ...empty.restaurant,
          suspendedDishIds: ['toast'],
          suspendedDrinkIds: ['water'],
          walkInsPaused: true,
        },
      });
      view.rerender(<MenuPanel />);

      expect(screen.getByRole('button', {
        name: 'Resume all manually suspended items',
      })).toBeEnabled();
      expect(screen.getByText(
        'Resuming manually suspended items does not change daily paid-sales thresholds or the walk-in admission pause.',
      )).toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', {
        name: 'Resume all manually suspended items',
      }));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({ type: 'RESUME_ALL_MENU_ITEMS' });
    });

    it.each([
      ['career decision', false, true],
      ['read-only', true, false],
    ])('blocks bulk resume while %s', (_label, readOnly, needsDecision) => {
      const base = useGameState();
      useGameState.mockReturnValue({
        ...base,
        ...(needsDecision ? { careerRun: { needsDecision: true } } : {}),
        restaurant: {
          ...base.restaurant,
          suspendedDishIds: ['toast'],
          suspendedDrinkIds: ['water'],
        },
      });
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel readOnly={readOnly} />);

      const resumeAll = screen.getByRole('button', {
        name: 'Resume all manually suspended items',
      });
      expect(resumeAll).toBeDisabled();
      fireEvent.click(resumeAll);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('resumes manual holds without overriding a reached paid-sales threshold', () => {
      const initial = createInitialState();
      const state = {
        ...initial,
        restaurant: {
          ...initial.restaurant,
          suspendedDishIds: ['starter-toast'],
          suspendedDrinkIds: ['water'],
          menuSalesThresholds: [
            { kind: 'dish', id: 'starter-toast', threshold: 1 },
          ],
        },
        menuSales: {
          day: 1,
          dishes: [{ key: 'starter-toast', count: 1, gross: 12, grossComplete: true }],
          drinks: [],
        },
      };
      const actions = [];
      useGameState.mockImplementation(() => statefulHarness.current.state);
      useDispatch.mockImplementation(() => statefulHarness.current.dispatch);
      render(<StatefulMenuPanel initial={state} actions={actions} />);

      expect(getMenuAnalysis(state).hasAvailableMenu).toBe(false);
      fireEvent.click(screen.getByRole('button', {
        name: 'Resume all manually suspended items',
      }));

      const next = statefulHarness.current.state;
      const dishCard = within(screen.getByRole('article', { name: 'Toasted Bread menu item' }));
      const waterCard = within(screen.getByRole('article', { name: 'Water menu item' }));
      expect(actions).toEqual([{ type: 'RESUME_ALL_MENU_ITEMS' }]);
      expect(dishCard.queryByText('Suspended for walk-ins')).not.toBeInTheDocument();
      expect(dishCard.getByText('Paid-sales threshold reached for walk-ins')).toBeInTheDocument();
      expect(dishCard.getByText('Estimated demand: 0%')).toBeInTheDocument();
      expect(waterCard.queryByText('Suspended for walk-ins')).not.toBeInTheDocument();
      expect(screen.getByRole('button', {
        name: 'Resume all manually suspended items',
      })).toBeDisabled();
      expect(getMenuAnalysis(next).hasAvailableMenu).toBe(true);
      expect(getMenuAnalysis(next).demand.drinks.get('water')).toBeGreaterThan(0);
      expect(next.restaurant.menuSalesThresholds).toBe(state.restaurant.menuSalesThresholds);
      expect(next.restaurant.walkInsPaused).toBe(state.restaurant.walkInsPaused);
    });

    it('offers exact suspend actions with pressed state for dishes and unlocked drinks', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      const dishCard = within(screen.getByRole('article', { name: 'Toast menu item' }));
      const suspendDish = dishCard.getByRole('button', { name: 'Suspend Toast for walk-ins' });
      expect(suspendDish).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(suspendDish);
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_MENU_ITEM_SUSPENDED', kind: 'dish', id: 'toast', suspended: true,
      });

      const waterCard = within(screen.getByRole('article', { name: 'Water menu item' }));
      const suspendDrink = waterCard.getByRole('button', { name: 'Suspend Water for walk-ins' });
      expect(suspendDrink).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(suspendDrink);
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_MENU_ITEM_SUSPENDED', kind: 'drink', id: 'water', suspended: true,
      });

      expect(dishCard.queryByText('Suspended for walk-ins')).not.toBeInTheDocument();
      expect(waterCard.queryByText('Suspended for walk-ins')).not.toBeInTheDocument();
    });

    it('shows the suspended status and resume action only for suspended items', () => {
      const base = useGameState();
      useGameState.mockReturnValue({
        ...base,
        restaurant: {
          ...base.restaurant, suspendedDishIds: ['toast'], suspendedDrinkIds: ['water'],
        },
      });
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      const dishCard = within(screen.getByRole('article', { name: 'Toast menu item' }));
      expect(dishCard.getByText('Suspended for walk-ins')).toBeInTheDocument();
      const resumeDish = dishCard.getByRole('button', { name: 'Resume Toast for walk-ins' });
      expect(resumeDish).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(resumeDish);
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_MENU_ITEM_SUSPENDED', kind: 'dish', id: 'toast', suspended: false,
      });
      expect(dishCard.queryByRole('button', { name: 'Suspend Toast for walk-ins' })).not.toBeInTheDocument();

      const waterCard = within(screen.getByRole('article', { name: 'Water menu item' }));
      expect(waterCard.getByText('Suspended for walk-ins')).toBeInTheDocument();
      expect(waterCard.getByRole('button', { name: 'Resume Water for walk-ins' })).toBeInTheDocument();

      const teaCard = within(screen.getByRole('article', { name: 'Tea menu item' }));
      expect(teaCard.queryByRole('button', { name: /for walk-ins/ })).not.toBeInTheDocument();
      expect(teaCard.getByRole('button', { name: 'Unlock Tea ($150)' })).toBeInTheDocument();
    });

    it('disables suspension controls for read-only and career decision states', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const view = render(<MenuPanel />);

      const base = useGameState();
      useGameState.mockReturnValue({ ...base, careerRun: { needsDecision: true } });
      view.rerender(<MenuPanel />);
      const careerDish = screen.getByRole('button', { name: 'Suspend Toast for walk-ins' });
      const careerDrink = screen.getByRole('button', { name: 'Suspend Water for walk-ins' });
      expect(careerDish).toBeDisabled();
      expect(careerDrink).toBeDisabled();
      fireEvent.click(careerDish);
      fireEvent.click(careerDrink);

      useGameState.mockReturnValue(base);
      view.rerender(<MenuPanel readOnly />);
      const readOnlyDish = screen.getByRole('button', { name: 'Suspend Toast for walk-ins' });
      expect(readOnlyDish).toBeDisabled();
      fireEvent.click(readOnlyDish);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('explains the scope and warns only when no walk-in item is offered', () => {
      const base = useGameState();
      useGameState.mockReturnValue({
        ...base,
        restaurant: {
          ...base.restaurant, suspendedDishIds: ['toast'], suspendedDrinkIds: ['water'],
        },
      });
      const view = render(<MenuPanel />);

      expect(screen.getByText(
        'Suspension affects new walk-in orders only. Booked contract guests can still order these items; orders already taken continue unchanged.',
      )).toBeInTheDocument();
      expect(screen.getByText(
        'No items are available for new walk-in orders. Guests without an order may leave unhappy.',
      )).toBeInTheDocument();
      expect(screen.getByText('Can afford an order containing a dish: 0%')).toBeInTheDocument();
      expect(screen.getByText('Can afford any order, including drink-only: 0%')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      useGameState.mockReturnValue({
        dishes: [{ id: 'toast', name: 'Toast', price: 120, prepTime: 60, quality: 2, popularity: 45 }],
        recipeSlots: 1, equipment: [], unlockedDrinkIds: [], drinkOverrides: {}, upgrades: [],
        restaurant: { funds: 200, reputation: 1 },
      });
      view.rerender(<MenuPanel />);

      expect(screen.getByText(
        'Suspension affects new walk-in orders only. Booked contract guests can still order these items; orders already taken continue unchanged.',
      )).toBeInTheDocument();
      expect(screen.queryByText(
        'No items are available for new walk-in orders. Guests without an order may leave unhappy.',
      )).not.toBeInTheDocument();
    });

    it('rerenders exclusions through demand and coverage without losing controls', () => {
      const base = useGameState();
      useGameState.mockReturnValue(base);
      const view = render(<MenuPanel />);
      const card = () => within(screen.getByRole('article', { name: 'Toast menu item' }));
      const dishDemand = card().getByText(/Estimated demand: /).textContent;
      expect(dishDemand).not.toBe('Estimated demand: 0%');

      useGameState.mockReturnValue({
        ...base,
        restaurant: { ...base.restaurant, suspendedDishIds: ['toast'] },
      });
      view.rerender(<MenuPanel />);

      expect(card().getByText('Estimated demand: 0%')).toBeInTheDocument();
      expect(card().getByText('Suspended for walk-ins')).toBeInTheDocument();
      expect(card().getByRole('button', { name: 'Resume Toast for walk-ins' }))
        .toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Can afford an order containing a dish: 0%')).toBeInTheDocument();
      expect(screen.getByText('Can afford any order, including drink-only: 93.5%')).toBeInTheDocument();
      expect(screen.queryByText(
        'No items are available for new walk-in orders. Guests without an order may leave unhappy.',
      )).not.toBeInTheDocument();
    });

    it('keeps demand, affordability and the walk-in warning in sync after menu changes', () => {
      const base = useGameState();
      const view = render(<MenuPanel />);
      const dishCard = () => within(screen.getByRole('article', { name: 'Toast menu item' }));
      const initialDemand = dishCard().getByText(/Estimated demand: /).textContent;
      expect(initialDemand).not.toBe('Estimated demand: 0%');
      expect(screen.getByText('Can afford an order containing a dish: 80.4%')).toBeInTheDocument();
      expect(screen.queryByText(
        'No items are available for new walk-in orders. Guests without an order may leave unhappy.',
      )).not.toBeInTheDocument();

      const repriced = { ...base, dishes: [{ ...base.dishes[0], price: 19 }] };
      useGameState.mockReturnValue(repriced);
      view.rerender(<MenuPanel />);
      expect(dishCard().getByText(/Estimated demand: /).textContent).not.toBe(initialDemand);
      expect(screen.getByText('Can afford an order containing a dish: 53.6%')).toBeInTheDocument();

      useGameState.mockReturnValue({
        ...repriced,
        restaurant: {
          ...repriced.restaurant, suspendedDishIds: ['toast'], suspendedDrinkIds: ['water'],
        },
      });
      view.rerender(<MenuPanel />);

      expect(dishCard().getByText('Estimated demand: 0%')).toBeInTheDocument();
      expect(screen.getByText('Can afford an order containing a dish: 0%')).toBeInTheDocument();
      expect(screen.getByText('Can afford any order, including drink-only: 0%')).toBeInTheDocument();
      expect(screen.getByText(
        'No items are available for new walk-in orders. Guests without an order may leave unhappy.',
      )).toBeInTheDocument();
    });
  });

  describe('draft menu prices', () => {
    const pricedMenu = () => ({
      dishes: [
        { id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45 },
        { id: 'cookbook-toast', cookbookId: 'toast' },
      ],
      recipeSlots: 1, equipment: [], unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 8, quality: 3 } }, upgrades: [],
      restaurant: { funds: 200, reputation: 3 },
      cookbook: {
        schemaVersion: 2,
        lastAppliedPaidVisitSequence: 0,
        entries: {
          toast: {
            discovered: true, paidPortions: 0, perk: null,
            menuSettings: { name: 'Toasted Bread', price: 12, quality: 2 },
          },
        },
      },
    });

    beforeEach(() => {
      useGameState.mockReturnValue(pricedMenu());
    });

    it('keeps all three menu kinds as local drafts and commits each once on Enter', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      const cases = [
        ['Toast price', '14', { type: 'UPDATE_DISH', id: 'toast', changes: { price: 14 } }],
        ['Toasted Bread price', '30', { type: 'UPDATE_DISH', id: 'cookbook-toast', changes: { price: 30 } }],
        ['Water price', '11', { type: 'UPDATE_DRINK', id: 'water', changes: { price: 11 } }],
      ];

      for (const [label, typed, action] of cases) {
        const field = screen.getByLabelText(label);
        const before = dispatch.mock.calls.length;
        fireEvent.change(field, { target: { value: typed } });
        expect(dispatch).toHaveBeenCalledTimes(before);
        fireEvent.keyDown(field, { key: 'Enter' });
        expect(dispatch).toHaveBeenCalledTimes(before + 1);
        expect(dispatch).toHaveBeenLastCalledWith(action);
        fireEvent.blur(field);
        expect(dispatch).toHaveBeenCalledTimes(before + 1);
      }
      expect(dispatch).toHaveBeenCalledTimes(3);
    });

    it('commits normalised finite prices on blur and treats an unchanged price as a no-op', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);
      const field = screen.getByLabelText('Water price');

      fireEvent.change(field, { target: { value: '0' } });
      fireEvent.blur(field);
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'UPDATE_DRINK', id: 'water', changes: { price: 1 } });

      fireEvent.change(field, { target: { value: '101' } });
      fireEvent.blur(field);
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'UPDATE_DRINK', id: 'water', changes: { price: 100 } });

      fireEvent.change(field, { target: { value: '1.6' } });
      fireEvent.blur(field);
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'UPDATE_DRINK', id: 'water', changes: { price: 2 } });

      fireEvent.change(field, { target: { value: '8.4' } });
      fireEvent.blur(field);
      expect(dispatch).toHaveBeenCalledTimes(3);
    });

    it('restores the latest price on Escape and cancels stale drafts on authoritative changes', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const view = render(<MenuPanel />);
      const water = () => screen.getByLabelText('Water price');

      fireEvent.change(water(), { target: { value: '50' } });
      fireEvent.keyDown(water(), { key: 'Escape' });
      expect(water()).toHaveValue(8);
      fireEvent.blur(water());
      expect(dispatch).not.toHaveBeenCalled();

      const base = useGameState();
      useGameState.mockReturnValue({ ...base, drinkOverrides: { water: { price: 9, quality: 3 } } });
      view.rerender(<MenuPanel />);
      fireEvent.change(water(), { target: { value: '50' } });
      expect(water()).toHaveValue(50);

      useGameState.mockReturnValue({ ...base, drinkOverrides: { water: { price: 10, quality: 3 } } });
      view.rerender(<MenuPanel />);
      expect(water()).toHaveValue(10);
      fireEvent.blur(water());
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('disables every price field for readOnly and career decision states', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const view = render(<MenuPanel />);
      const labels = ['Toast price', 'Toasted Bread price', 'Water price'];

      const base = useGameState();
      useGameState.mockReturnValue({ ...base, careerRun: { needsDecision: true } });
      view.rerender(<MenuPanel />);
      for (const label of labels) {
        const field = screen.getByLabelText(label);
        expect(field).toBeDisabled();
        fireEvent.change(field, { target: { value: '99' } });
        fireEvent.blur(field);
      }
      expect(dispatch).not.toHaveBeenCalled();

      useGameState.mockReturnValue(base);
      view.rerender(<MenuPanel readOnly />);
      for (const label of labels) {
        const field = screen.getByLabelText(label);
        expect(field).toBeDisabled();
        fireEvent.change(field, { target: { value: '99' } });
        fireEvent.blur(field);
      }
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('keeps suspension controls working while a price draft is pending', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      fireEvent.change(screen.getByLabelText('Toast price'), { target: { value: '20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Suspend Toast for walk-ins' }));

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_MENU_ITEM_SUSPENDED', kind: 'dish', id: 'toast', suspended: true,
      });
    });

    it('previews cookbook dishes and resolved drinks locally, dispatching only on commit', () => {
      const state = pricedMenu();
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      const cookbookInput = screen.getByLabelText('Toasted Bread price');
      fireEvent.change(cookbookInput, { target: { value: '30' } });

      expect(dispatch).not.toHaveBeenCalled();
      const cookbookPreview = screen.getByRole('group', { name: 'Price preview for Toasted Bread' });
      expect(within(cookbookPreview).getByText(/Draft price: \$30/)).toBeInTheDocument();
      expect(within(cookbookPreview).getByLabelText('Current whole-menu gross per 100 hypothetical walk-in guests'))
        .toHaveTextContent(`$${getMenuAnalysis(state).expectedGrossPer100.toFixed(2)}`);
      expect(within(cookbookPreview).getByLabelText('Draft whole-menu gross per 100 hypothetical walk-in guests'))
        .toHaveTextContent(`$${getMenuAnalysis(state, {
          kind: 'dish', id: 'cookbook-toast', price: 30,
        }).expectedGrossPer100.toFixed(2)}`);

      fireEvent.keyDown(cookbookInput, { key: 'Escape' });
      expect(screen.queryByRole('group', { name: 'Price preview for Toasted Bread' })).not.toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();

      const waterInput = screen.getByLabelText('Water price');
      fireEvent.change(waterInput, { target: { value: '11' } });
      expect(dispatch).not.toHaveBeenCalled();
      const waterPreview = screen.getByRole('group', { name: 'Price preview for Water' });
      expect(within(waterPreview).getByText(/Draft price: \$11/)).toBeInTheDocument();
      expect(within(waterPreview).getByLabelText('Draft whole-menu gross per 100 hypothetical walk-in guests'))
        .toHaveTextContent(`$${getMenuAnalysis(state, {
          kind: 'drink', id: 'water', price: 11,
        }).expectedGrossPer100.toFixed(2)}`);

      fireEvent.keyDown(waterInput, { key: 'Enter' });

      expect(dispatch).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_DRINK', id: 'water', changes: { price: 11 },
      });
      expect(screen.queryByRole('group', { name: 'Price preview for Water' })).not.toBeInTheDocument();
    });

    it('shows current-to-draft tier affordability for food and drink edits without dispatching', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const state = {
        dishes: [{ id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45 }],
        recipeSlots: 1, equipment: [], unlockedDrinkIds: ['water'],
        drinkOverrides: { water: { price: 8, quality: 3 } }, upgrades: [],
        restaurant: { funds: 200, reputation: 3 },
      };
      useGameState.mockReturnValue(state);
      const view = render(<MenuPanel />);

      fireEvent.change(screen.getByLabelText('Toast price'), { target: { value: '19' } });
      const dishPreview = screen.getByRole('group', { name: 'Price preview for Toast' });
      expect(within(dishPreview).getByLabelText('Budget tier affordability'))
        .toHaveTextContent('Budget: dish-containing orders 53.8% → 0%; any orders 84.6% → 84.6%');
      expect(within(dishPreview).getByLabelText('Value tier affordability'))
        .toHaveTextContent('Value: dish-containing orders 100% → 87.1%; any orders 100% → 100%');
      expect(dispatch).not.toHaveBeenCalled();

      fireEvent.keyDown(screen.getByLabelText('Toast price'), { key: 'Escape' });
      const waterOnly = {
        ...state,
        dishes: [],
        drinkOverrides: { water: { price: 8, quality: 3 } },
      };
      useGameState.mockReturnValue(waterOnly);
      view.rerender(<MenuPanel />);

      fireEvent.change(screen.getByLabelText('Water price'), { target: { value: '19' } });
      const drinkPreview = screen.getByRole('group', { name: 'Price preview for Water' });
      expect(within(drinkPreview).getByLabelText('Budget tier affordability'))
        .toHaveTextContent('Budget: dish-containing orders 0% → 0%; any orders 84.6% → 0%');
      expect(within(drinkPreview).getByLabelText('Value tier affordability'))
        .toHaveTextContent('Value: dish-containing orders 0% → 0%; any orders 100% → 87.1%');
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('keeps suspended-item price previews neutral for walk-in gross', () => {
      const state = pricedMenu();
      state.restaurant.suspendedDishIds = ['cookbook-toast'];
      useGameState.mockReturnValue(state);
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      fireEvent.change(screen.getByLabelText('Toasted Bread price'), { target: { value: '70' } });

      const preview = screen.getByRole('group', { name: 'Price preview for Toasted Bread' });
      expect(within(preview).getByLabelText('Current whole-menu gross per 100 hypothetical walk-in guests'))
        .toHaveTextContent(`$${getMenuAnalysis(state).expectedGrossPer100.toFixed(2)}`);
      expect(within(preview).getByLabelText('Draft whole-menu gross per 100 hypothetical walk-in guests'))
        .toHaveTextContent(`$${getMenuAnalysis(state, {
          kind: 'dish', id: 'cookbook-toast', price: 70,
        }).expectedGrossPer100.toFixed(2)}`);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('keeps the active preview after the complete action row, including removal confirmation', () => {
      useGameState.mockReturnValue(pricedMenu());
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      const price = screen.getByLabelText('Toast price');
      fireEvent.change(price, { target: { value: '14' } });
      const row = price.parentElement;
      const activePreview = screen.getByRole('group', { name: 'Price preview for Toast' });
      expect(row.compareDocumentPosition(activePreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(row).getByRole('button', { name: 'Upgrade Toast quality ($50)' })).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Suspend Toast for walk-ins' })).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Remove Toast from menu' })).toBeInTheDocument();

      fireEvent.click(within(row).getByRole('button', { name: 'Remove Toast from menu' }));
      const removal = within(row).getByRole('region', { name: 'Remove Toast? This permanently deletes its recipe.' });
      expect(removal.compareDocumentPosition(activePreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('uses only active draft analyses and retains the last plain forecast while inactive', () => {
      const state = pricedMenu();
      useGameState.mockReturnValue(state);
      useDispatch.mockReturnValue(vi.fn());
      const analysisSpy = vi.spyOn(menuEconomy, 'getMenuAnalysis');

      try {
        const view = render(<MenuPanel />);
        expect(analysisSpy).toHaveBeenCalledOnce();
        expect(analysisSpy).toHaveBeenCalledWith(state);
        analysisSpy.mockClear();

        const field = screen.getByLabelText('Water price');
        fireEvent.change(field, { target: { value: '11' } });
        const activeDraftCalls = analysisSpy.mock.calls.filter(([, override]) => override !== undefined);
        expect(activeDraftCalls.length).toBeGreaterThan(0);
        expect(activeDraftCalls.every(([analyzedState, override]) => analyzedState === state
          && override.kind === 'drink' && override.id === 'water' && override.price === 11)).toBe(true);
        const activePreview = screen.getByRole('group', { name: 'Price preview for Water' });
        expect(activePreview).toHaveTextContent('Draft price: $11');

        analysisSpy.mockClear();
        fireEvent.keyDown(field, { key: 'Enter' });
        expect(analysisSpy).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Price preview for Water' })).not.toBeInTheDocument();
        const row = field.parentElement;
        const retained = row.nextElementSibling.firstElementChild;
        expect(retained).toHaveAttribute('aria-hidden', 'true');
        expect(retained).toHaveTextContent('Draft price: $11');

        analysisSpy.mockClear();
        view.rerender(<MenuPanel />);
        expect(analysisSpy).toHaveBeenCalledOnce();
        expect(analysisSpy).toHaveBeenCalledWith(state);
        expect(analysisSpy.mock.calls.some(([, override]) => override !== undefined)).toBe(false);
        expect(retained).toHaveTextContent('Draft price: $11');
      } finally {
        analysisSpy.mockRestore();
      }
    });
  });

  describe('quality and unlock purchase guards', () => {
    const cookbookState = () => ({
      dishes: [
        { id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45 },
        { id: 'cookbook-toast', cookbookId: 'toast' },
      ],
      recipeSlots: 1, equipment: [], unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 8, quality: 3 } }, upgrades: [],
      restaurant: { funds: 200, reputation: 3 },
      cookbook: {
        schemaVersion: 2,
        lastAppliedPaidVisitSequence: 0,
        entries: {
          toast: {
            discovered: true, paidPortions: 0, perk: null,
            menuSettings: { name: 'Toasted Bread', price: 12, quality: 2 },
          },
        },
      },
    });

    const purchaseControls = () => ({
      custom: within(screen.getByRole('article', { name: 'Toast menu item' }))
        .getByRole('button', { name: 'Upgrade Toast quality ($50)' }),
      cookbook: within(screen.getByRole('article', { name: 'Toasted Bread menu item' }))
        .getByRole('button', { name: 'Upgrade Toasted Bread quality ($50)' }),
      drink: within(screen.getByRole('article', { name: 'Water menu item' }))
        .getByRole('button', { name: 'Upgrade Water quality ($50)' }),
      unlock: screen.getByRole('button', { name: 'Unlock Tea ($150)' }),
    });

    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['undefined', undefined],
    ])('disables every quality and locked-drink control when funds are %s', (_label, funds) => {
      const base = cookbookState();
      useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, funds } });
      render(<MenuPanel />);

      const controls = purchaseControls();
      expect(controls.custom).toBeDisabled();
      expect(controls.cookbook).toBeDisabled();
      expect(controls.drink).toBeDisabled();
      expect(controls.unlock).toBeDisabled();
    });

    it('disables quality at $49.99, enables it at exactly $50 and still respects the level cap', () => {
      const base = cookbookState();
      useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, funds: 49.99 } });
      const view = render(<MenuPanel />);
      expect(purchaseControls().custom).toBeDisabled();
      expect(purchaseControls().cookbook).toBeDisabled();
      expect(purchaseControls().drink).toBeDisabled();

      useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, funds: 50 } });
      view.rerender(<MenuPanel />);
      expect(purchaseControls().custom).toBeEnabled();
      expect(purchaseControls().cookbook).toBeEnabled();
      expect(purchaseControls().drink).toBeEnabled();

      useGameState.mockReturnValue({
        ...base,
        dishes: [{ ...base.dishes[0], quality: 10 }, base.dishes[1]],
        drinkOverrides: { water: { price: 8, quality: 10 } },
        restaurant: { ...base.restaurant, funds: 50 },
      });
      view.rerender(<MenuPanel />);
      expect(purchaseControls().custom).toBeDisabled();
      expect(purchaseControls().drink).toBeDisabled();
      expect(screen.getAllByText('+ Quality ($50)')).toHaveLength(3);
    });

    it('dispatches id-only purchase actions with pinned labels', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const base = cookbookState();
      useGameState.mockReturnValue({ ...base, restaurant: { ...base.restaurant, funds: 150 } });
      render(<MenuPanel />);

      const controls = purchaseControls();
      expect(controls.custom).toHaveAccessibleName('Upgrade Toast quality ($50)');
      expect(controls.cookbook).toHaveAccessibleName('Upgrade Toasted Bread quality ($50)');
      expect(controls.drink).toHaveAccessibleName('Upgrade Water quality ($50)');
      expect(controls.unlock).toHaveAccessibleName('Unlock Tea ($150)');

      fireEvent.click(controls.custom);
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'UPGRADE_DISH_QUALITY', id: 'toast' });
      fireEvent.click(controls.drink);
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'UPGRADE_DRINK_QUALITY', id: 'water' });
      fireEvent.click(controls.unlock);
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'UNLOCK_DRINK', id: 'tea' });
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dispatch.mock.calls.every(([action]) => Object.keys(action).sort().join() === 'id,type')).toBe(true);
    });

    it('keeps quality and unlock controls disabled for readOnly and career-decision states', () => {
      const base = cookbookState();
      const active = { ...base, restaurant: { ...base.restaurant, funds: 150 } };
      useGameState.mockReturnValue({ ...active, careerRun: { needsDecision: true } });
      const view = render(<MenuPanel />);
      expect(purchaseControls().custom).toBeDisabled();
      expect(purchaseControls().cookbook).toBeDisabled();
      expect(purchaseControls().drink).toBeDisabled();
      expect(purchaseControls().unlock).toBeDisabled();

      useGameState.mockReturnValue(active);
      view.rerender(<MenuPanel readOnly />);
      expect(purchaseControls().custom).toBeDisabled();
      expect(purchaseControls().cookbook).toBeDisabled();
      expect(purchaseControls().drink).toBeDisabled();
      expect(purchaseControls().unlock).toBeDisabled();
    });
  });

  describe('custom dish removal confirmation', () => {
    const removalMenu = () => ({
      dishes: [
        { id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45 },
        { id: 'cookbook-toast', cookbookId: 'toast' },
      ],
      recipeSlots: 1, equipment: [], unlockedDrinkIds: [], drinkOverrides: {}, upgrades: [],
      restaurant: { funds: 200, reputation: 3 },
      cookbook: {
        schemaVersion: 2,
        lastAppliedPaidVisitSequence: 0,
        entries: {
          toast: {
            discovered: true, paidPortions: 0, perk: null,
            menuSettings: { name: 'Toasted Bread', price: 12, quality: 2 },
          },
        },
      },
    });
    const permanentWarning = 'Removing this custom dish permanently deletes its recipe. '
      + 'Suspend it instead to stop new walk-in orders without deleting it.';
    const removeButton = name => screen.getByRole('button', { name: `Remove ${name} from menu` });
    const confirmation = () => screen.queryByRole('region', { name: /permanently deletes its recipe/ });
    const customDish = (id, name) => ({
      id, name, price: 12, prepTime: 60, quality: 2, popularity: 45,
    });
    const statefulRemovalMenu = dishes => ({ ...createInitialState(), dishes });

    beforeEach(() => {
      useGameState.mockReturnValue(removalMenu());
    });

    it('requires explicit confirmation before dispatching a custom dish removal', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      fireEvent.click(removeButton('Toast'));
      expect(dispatch).not.toHaveBeenCalled();

      const region = screen.getByRole('region', { name: 'Remove Toast? This permanently deletes its recipe.' });
      expect(within(region).getByText(permanentWarning)).toBeInTheDocument();
      expect(within(region).getByRole('button', { name: 'Cancel' })).toHaveFocus();
      expect(removeButton('Toast')).toHaveTextContent('Remove');

      fireEvent.click(within(region).getByRole('button', { name: 'Confirm remove Toast' }));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_DISH', id: 'toast' });
      expect(confirmation()).not.toBeInTheDocument();
    });

    it('focuses Cookbook after a stateful custom removal with another dish remaining', () => {
      const actions = [];
      useGameState.mockImplementation(() => statefulHarness.current.state);
      useDispatch.mockImplementation(() => statefulHarness.current.dispatch);
      render(<StatefulMenuPanel
        initial={statefulRemovalMenu([
          customDish('toast', 'Toast'),
          customDish('rye-toast', 'Rye Toast'),
        ])}
        actions={actions}
      />);

      fireEvent.click(removeButton('Toast'));
      const confirm = screen.getByRole('button', { name: 'Confirm remove Toast' });
      confirm.focus();
      expect(confirm).toHaveFocus();
      fireEvent.click(confirm);

      expect(screen.queryByRole('article', { name: 'Toast menu item' })).not.toBeInTheDocument();
      expect(screen.getByRole('article', { name: 'Rye Toast menu item' })).toBeInTheDocument();
      expect(actions).toEqual([{ type: 'REMOVE_DISH', id: 'toast' }]);
      expect(screen.getByRole('button', { name: 'Cookbook' })).toHaveFocus();
    });

    it('focuses Cookbook after a stateful removal of the last dish', () => {
      const actions = [];
      useGameState.mockImplementation(() => statefulHarness.current.state);
      useDispatch.mockImplementation(() => statefulHarness.current.dispatch);
      render(<StatefulMenuPanel
        initial={statefulRemovalMenu([customDish('toast', 'Toast')])}
        actions={actions}
      />);

      fireEvent.click(removeButton('Toast'));
      const confirm = screen.getByRole('button', { name: 'Confirm remove Toast' });
      confirm.focus();
      expect(confirm).toHaveFocus();
      fireEvent.click(confirm);

      expect(screen.queryByRole('article', { name: 'Toast menu item' })).not.toBeInTheDocument();
      expect(screen.getByText('No dishes yet. Create your first dish!')).toBeInTheDocument();
      expect(actions).toEqual([{ type: 'REMOVE_DISH', id: 'toast' }]);
      expect(screen.getByRole('button', { name: 'Cookbook' })).toHaveFocus();
    });

    it('cancels with Cancel or Escape without dispatch and returns focus to Remove', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      fireEvent.click(removeButton('Toast'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(dispatch).not.toHaveBeenCalled();
      expect(confirmation()).not.toBeInTheDocument();
      expect(removeButton('Toast')).toHaveFocus();

      fireEvent.click(removeButton('Toast'));
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
      const documentKeyDown = vi.fn();
      document.addEventListener('keydown', documentKeyDown);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
      document.removeEventListener('keydown', documentKeyDown);
      expect(documentKeyDown).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(confirmation()).not.toBeInTheDocument();
      expect(removeButton('Toast')).toHaveFocus();
    });

    it('does not cancel when focus moves between the confirmation controls', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      fireEvent.click(removeButton('Toast'));
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      const confirm = screen.getByRole('button', { name: 'Confirm remove Toast' });
      fireEvent.focus(confirm);
      fireEvent.blur(cancel);
      expect(confirmation()).toBeInTheDocument();

      fireEvent.click(confirm);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_DISH', id: 'toast' });
    });

    it('closes the confirmation for a removed, replaced or blocked target without a stale action', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      const base = removalMenu();
      useGameState.mockReturnValue(base);
      const view = render(<MenuPanel />);

      fireEvent.click(removeButton('Toast'));
      expect(confirmation()).toBeInTheDocument();

      useGameState.mockReturnValue({ ...base, dishes: base.dishes.slice(1) });
      view.rerender(<MenuPanel />);
      expect(confirmation()).not.toBeInTheDocument();

      useGameState.mockReturnValue(base);
      view.rerender(<MenuPanel />);
      expect(confirmation()).not.toBeInTheDocument();

      useGameState.mockReturnValue({ ...base, dishes: [{ ...base.dishes[0] }, base.dishes[1]] });
      view.rerender(<MenuPanel />);
      fireEvent.click(removeButton('Toast'));
      expect(confirmation()).toBeInTheDocument();
      useGameState.mockReturnValue({ ...base, dishes: [{ ...base.dishes[0] }, base.dishes[1]] });
      view.rerender(<MenuPanel />);
      expect(confirmation()).not.toBeInTheDocument();

      useGameState.mockReturnValue(base);
      view.rerender(<MenuPanel />);
      fireEvent.click(removeButton('Toast'));
      expect(confirmation()).toBeInTheDocument();
      useGameState.mockReturnValue({ ...base, careerRun: { needsDecision: true } });
      view.rerender(<MenuPanel />);
      expect(confirmation()).not.toBeInTheDocument();
      expect(removeButton('Toast')).toBeDisabled();

      useGameState.mockReturnValue(base);
      view.rerender(<MenuPanel />);
      expect(confirmation()).not.toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('removes cookbook dishes immediately with a contextual name and no permanent warning', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      for (const name of ['Toast', 'Toasted Bread']) {
        expect(removeButton(name)).toHaveTextContent('Remove');
      }
      fireEvent.click(removeButton('Toasted Bread'));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_DISH', id: 'cookbook-toast' });
      expect(confirmation()).not.toBeInTheDocument();
      expect(screen.queryByText(permanentWarning)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Confirm remove/ })).not.toBeInTheDocument();
    });

    it('focuses Cookbook after a stateful cookbook removal with another dish remaining', () => {
      const actions = [];
      useGameState.mockImplementation(() => statefulHarness.current.state);
      useDispatch.mockImplementation(() => statefulHarness.current.dispatch);
      const initial = createInitialState();
      initial.dishes.push(customDish('rye-toast', 'Rye Toast'));
      render(<StatefulMenuPanel initial={initial} actions={actions} />);

      const remove = removeButton('Toasted Bread');
      remove.focus();
      expect(remove).toHaveFocus();
      fireEvent.click(remove);

      expect(screen.queryByRole('article', { name: 'Toasted Bread menu item' })).not.toBeInTheDocument();
      expect(screen.getByRole('article', { name: 'Rye Toast menu item' })).toBeInTheDocument();
      expect(actions).toEqual([{ type: 'REMOVE_DISH', id: 'starter-toast' }]);
      expect(screen.getByRole('button', { name: 'Cookbook' })).toHaveFocus();
    });

    it('focuses Cookbook after a stateful removal of the final cookbook dish', () => {
      const actions = [];
      useGameState.mockImplementation(() => statefulHarness.current.state);
      useDispatch.mockImplementation(() => statefulHarness.current.dispatch);
      render(<StatefulMenuPanel initial={createInitialState()} actions={actions} />);

      const remove = removeButton('Toasted Bread');
      remove.focus();
      expect(remove).toHaveFocus();
      fireEvent.click(remove);

      expect(screen.queryByRole('article', { name: 'Toasted Bread menu item' })).not.toBeInTheDocument();
      expect(screen.getByText('No dishes yet. Create your first dish!')).toBeInTheDocument();
      expect(actions).toEqual([{ type: 'REMOVE_DISH', id: 'starter-toast' }]);
      expect(screen.getByRole('button', { name: 'Cookbook' })).toHaveFocus();
    });

    it.each([
      ['read-only', true, false],
      ['career decision pending', false, true],
    ])('does not dispatch or move focus for a blocked cookbook removal (%s)', (_label, readOnly, needsDecision) => {
      const base = removalMenu();
      useGameState.mockReturnValue(needsDecision ? { ...base, careerRun: { needsDecision: true } } : base);
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel readOnly={readOnly} />);

      const cookbook = screen.getByRole('button', { name: 'Cookbook' });
      cookbook.focus();
      const remove = removeButton('Toasted Bread');
      expect(remove).toBeDisabled();
      fireEvent.click(remove);

      expect(dispatch).not.toHaveBeenCalled();
      expect(cookbook).toHaveFocus();
    });

    it('clears a custom confirmation when detouring to the cookbook and back', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      useGameState.mockReturnValue({ ...removalMenu(), cookbook: createCookbookState() });
      render(<MenuPanel />);

      fireEvent.click(removeButton('Toast'));
      expect(confirmation()).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
      expect(screen.getByRole('heading', { name: 'Cookbook' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back to menu' }));
      expect(confirmation()).not.toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();

      fireEvent.click(removeButton('Toast'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(removeButton('Toast')).toHaveFocus();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('clears a custom confirmation when detouring to the creator and back', () => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);

      fireEvent.click(removeButton('Toast'));
      expect(confirmation()).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '+ New dish' }));
      expect(screen.getByRole('heading', { name: 'Create new dish' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(confirmation()).not.toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();

      fireEvent.click(removeButton('Toast'));
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
      expect(removeButton('Toast')).toHaveFocus();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe('paid today counters', () => {
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

  it('shows zero for missing legacy telemetry and leaves locked drinks unchanged', () => {
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base,
      restaurant: { ...base.restaurant, day: 1 },
      menuSales: undefined,
    });
    render(<MenuPanel />);

    const dishCard = within(screen.getByRole('article', { name: 'Toast menu item' }));
    const waterCard = within(screen.getByRole('article', { name: 'Water menu item' }));
    expect(dishCard.getByText('Paid today: 0')).toBeInTheDocument();
    expect(waterCard.getByText('Paid today: 0')).toBeInTheDocument();

    const teaCard = within(screen.getByRole('article', { name: 'Tea menu item' }));
    expect(teaCard.queryByText(/Paid today:/)).not.toBeInTheDocument();
  });

  it('shows current-day counts beside demand and hides a stale day', () => {
    const base = useGameState();
    const menuSales = {
      day: 1,
      dishes: [{ key: 'toast', count: 4 }],
      drinks: [{ key: 'water', count: 2 }],
    };
    useGameState.mockReturnValue({
      ...base,
      restaurant: { ...base.restaurant, day: 1 },
      menuSales,
    });
    const view = render(<MenuPanel />);

    const dishCard = within(screen.getByRole('article', { name: 'Toast menu item' }));
    const waterCard = within(screen.getByRole('article', { name: 'Water menu item' }));
    expect(dishCard.getByText('Paid today: 4')).toBeInTheDocument();
    expect(waterCard.getByText('Paid today: 2')).toBeInTheDocument();
    expect(dishCard.getByText(/Estimated demand:/)).toBeInTheDocument();

    useGameState.mockReturnValue({
      ...base,
      restaurant: { ...base.restaurant, day: 2 },
      menuSales,
    });
    view.rerender(<MenuPanel />);

    expect(within(screen.getByRole('article', { name: 'Toast menu item' }))
      .getByText('Paid today: 0')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Water menu item' }))
      .getByText('Paid today: 0')).toBeInTheDocument();
  });

  it('keeps counters visible read-only and explains charged-unit tracking limits', () => {
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base,
      restaurant: { ...base.restaurant, day: 3 },
      menuSales: {
        day: 3,
        dishes: [{ key: 'toast', count: 5 }],
        drinks: [{ key: 'water', count: 1 }],
      },
    });
    render(<MenuPanel readOnly />);

    expect(within(screen.getByRole('article', { name: 'Toast menu item' }))
      .getByText('Paid today: 5')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Water menu item' }))
      .getByText('Paid today: 1')).toBeInTheDocument();

    const explanation = screen.getByText(/Paid today counts charged units/);
    expect(explanation).toHaveTextContent('including booked guests');
    expect(explanation).toHaveTextContent('not a demand percentage');
    expect(explanation).toHaveTextContent('older saves');
    expect(explanation).toHaveTextContent('removing a dish clears its paid count');
  });

  it('shows complete gross and labels known partial gross distinctly', () => {
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base,
      restaurant: { ...base.restaurant, day: 3 },
      menuSales: {
        day: 3,
        dishes: [{ key: 'toast', count: 2, gross: 13.5, grossComplete: true }],
        drinks: [{ key: 'water', count: 2, gross: 8, grossComplete: false }],
      },
    });
    render(<MenuPanel />);

    const dishCard = within(screen.getByRole('article', { name: 'Toast menu item' }));
    const waterCard = within(screen.getByRole('article', { name: 'Water menu item' }));
    expect(dishCard.getByText('Gross sales today: $13.50')).toBeInTheDocument();
    expect(waterCard.getByText('Tracked gross sales: $8 (partial)')).toBeInTheDocument();
    expect(dishCard.getByText('Paid today: 2')).toBeInTheDocument();

    const explanation = screen.getByText(/Paid today counts charged units/);
    expect(explanation).toHaveTextContent('exclude tips');
    expect(explanation).toHaveTextContent('not profit');
    expect(explanation).toHaveTextContent('legacy count-only data');
    expect(explanation).toHaveTextContent('removing a dish clears its paid count');
  });

  it('marks legacy or zero-known partial gross as unavailable', () => {
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base,
      restaurant: { ...base.restaurant, day: 3 },
      menuSales: {
        day: 3,
        dishes: [{ key: 'toast', count: 2 }],
        drinks: [{ key: 'water', count: 2, gross: 0, grossComplete: false }],
      },
    });
    render(<MenuPanel />);

    expect(within(screen.getByRole('article', { name: 'Toast menu item' }))
      .getByText('Gross sales today: unavailable')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Water menu item' }))
      .getByText('Gross sales today: unavailable')).toBeInTheDocument();
  });

  it('applies and clears dish and drink policies only on explicit button clicks', () => {
    const base = useGameState();
    useGameState.mockReturnValue({
      ...base,
      restaurant: {
        ...base.restaurant,
        day: 1,
        menuSalesThresholds: [
          { kind: 'dish', id: 'toast', threshold: 2 },
          { kind: 'drink', id: 'water', threshold: 3 },
        ],
      },
    });
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    const toast = within(screen.getByRole('article', { name: 'Toast menu item' }));
    const water = within(screen.getByRole('article', { name: 'Water menu item' }));
    const toastInput = toast.getByLabelText('Daily paid-sales threshold for Toast');
    const waterInput = water.getByLabelText('Daily paid-sales threshold for Water');
    expect(toastInput).toHaveValue('2');
    expect(waterInput).toHaveValue('3');
    expect(toast.getByText('Apply threshold')).toBeInTheDocument();
    expect(water.getByText('Clear threshold')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(toast.getByRole('button', { name: 'Clear Toast daily paid-sales threshold' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_MENU_SALES_THRESHOLD', kind: 'dish', id: 'toast', threshold: null,
    });

    dispatch.mockClear();
    fireEvent.change(toastInput, { target: { value: '5' } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(toast.getByRole('button', { name: 'Apply Toast daily paid-sales threshold' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_MENU_SALES_THRESHOLD', kind: 'dish', id: 'toast', threshold: 5,
    });

    dispatch.mockClear();
    fireEvent.change(waterInput, { target: { value: '4' } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(water.getByRole('button', { name: 'Apply Water daily paid-sales threshold' }));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_MENU_SALES_THRESHOLD', kind: 'drink', id: 'water', threshold: 4,
    });

    dispatch.mockClear();
    fireEvent.click(water.getByRole('button', { name: 'Clear Water daily paid-sales threshold' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_MENU_SALES_THRESHOLD', kind: 'drink', id: 'water', threshold: null,
    });
  });

  it('keeps reached items excluded from the current and draft price preview', () => {
    const base = useGameState();
    const state = {
      ...base,
      restaurant: {
        ...base.restaurant,
        day: 1,
        menuSalesThresholds: [{ kind: 'dish', id: 'toast', threshold: 1 }],
      },
      menuSales: { day: 1, dishes: [{ key: 'toast', count: 1 }], drinks: [] },
    };
    useGameState.mockReturnValue(state);
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel />);

    const card = within(screen.getByRole('article', { name: 'Toast menu item' }));
    expect(card.getByText('Estimated demand: 0%')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Toast price'), { target: { value: '20' } });

    const preview = screen.getByRole('group', { name: 'Price preview for Toast' });
    expect(within(preview).getByLabelText(
      'Current whole-menu gross per 100 hypothetical walk-in guests',
    )).toHaveTextContent(`$${getMenuAnalysis(state).expectedGrossPer100.toFixed(2)}`);
    expect(within(preview).getByLabelText(
      'Draft whole-menu gross per 100 hypothetical walk-in guests',
    )).toHaveTextContent(`$${getMenuAnalysis(state, {
      kind: 'dish', id: 'toast', price: 20,
    }).expectedGrossPer100.toFixed(2)}`);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-1', '1.5', '1e3', 'Infinity', '+2', ' 2 ', '9007199254740992'])(
    'rejects invalid threshold draft %j without dispatching', draft => {
      const dispatch = vi.fn();
      useDispatch.mockReturnValue(dispatch);
      render(<MenuPanel />);
      const card = within(screen.getByRole('article', { name: 'Toast menu item' }));
      const input = card.getByLabelText('Daily paid-sales threshold for Toast');

      fireEvent.change(input, { target: { value: draft } });

      const apply = card.getByRole('button', { name: 'Apply Toast daily paid-sales threshold' });
      expect(apply).toBeDisabled();
      expect(dispatch).not.toHaveBeenCalled();
      if (draft !== '') {
        expect(card.getByRole('alert')).toHaveTextContent('Enter a positive whole number of paid sales.');
      }
    },
  );

  it('reflects external policy changes and shows reached status separately from suspension', () => {
    const base = useGameState();
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    useGameState.mockReturnValue({
      ...base,
      restaurant: {
        ...base.restaurant,
        day: 1,
        suspendedDishIds: ['toast'],
        menuSalesThresholds: [{ kind: 'dish', id: 'toast', threshold: 2 }],
      },
      menuSales: { day: 1, dishes: [{ key: 'toast', count: 2 }], drinks: [] },
    });
    const view = render(<MenuPanel />);
    const card = () => within(screen.getByRole('article', { name: 'Toast menu item' }));
    const input = () => card().getByLabelText('Daily paid-sales threshold for Toast');

    expect(card().getByText('Suspended for walk-ins')).toBeInTheDocument();
    expect(card().getByText('Paid-sales threshold reached for walk-ins')).toBeInTheDocument();
    expect(card().getByRole('button', { name: 'Resume Toast for walk-ins' }))
      .toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(input(), { target: { value: '7' } });
    expect(dispatch).not.toHaveBeenCalled();

    useGameState.mockReturnValue({
      ...base,
      restaurant: {
        ...base.restaurant,
        day: 1,
        suspendedDishIds: ['toast'],
        menuSalesThresholds: [{ kind: 'dish', id: 'toast', threshold: 3 }],
      },
      menuSales: { day: 1, dishes: [{ key: 'toast', count: 3 }], drinks: [] },
    });
    view.rerender(<MenuPanel />);

    expect(input()).toHaveValue('3');
    expect(card().getByText('Paid-sales threshold reached for walk-ins')).toBeInTheDocument();
    expect(screen.getByText(/Daily paid-sales thresholds stop offering/)).toHaveTextContent(
      'Paid-sales counts reset automatically each new game day; thresholds remain in place and apply again.',
    );
    expect(screen.getByText(/Booked contract guests can still order thresholded items/))
      .toHaveTextContent('exceed the threshold');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['read-only', true, false],
    ['career decision', false, true],
  ])('disables and guards threshold controls during %s', (_label, readOnly, needsDecision) => {
    const base = useGameState();
    useGameState.mockReturnValue(needsDecision
      ? { ...base, careerRun: { needsDecision: true } }
      : base);
    const dispatch = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    render(<MenuPanel readOnly={readOnly} />);
    const card = within(screen.getByRole('article', { name: 'Toast menu item' }));
    const input = card.getByLabelText('Daily paid-sales threshold for Toast');
    const apply = card.getByRole('button', { name: 'Apply Toast daily paid-sales threshold' });
    const clear = card.getByRole('button', { name: 'Clear Toast daily paid-sales threshold' });

    expect(input).toBeDisabled();
    expect(apply).toBeDisabled();
    expect(clear).toBeDisabled();
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(apply);
    fireEvent.click(clear);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('MenuPanel kitchen equipment advice', () => {
  const starterDish = () => within(screen.getByRole('article', {
    name: 'Toasted Bread menu item',
  }));

  it('warns without a compatible station and clears the warning after a matching station is added', () => {
    const state = { ...createInitialState(), kitchenStations: [] };
    const dispatch = vi.fn();
    useGameState.mockReturnValue(state);
    useDispatch.mockReturnValue(dispatch);
    const view = render(<MenuPanel />);

    expect(starterDish().getByText(/Toaster.*no compatible kitchen station/)).toBeVisible();
    expect(screen.getByText(
      'Equipment advice checks ownership and station compatibility, not access, workload or service completion.',
    )).toBeVisible();

    useGameState.mockReturnValue({
      ...state,
      kitchenStations: [{ id: 'matching-station', equipmentId: 'eq1' }],
    });
    view.rerender(<MenuPanel />);

    expect(starterDish().queryByText(/Toaster.*no compatible kitchen station/))
      .not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['unowned', state => ({
      ...state,
      kitchenStations: [{ id: 'unowned-station', equipmentId: 'eq1' }],
      equipment: state.equipment.map(equipment => equipment.id === 'eq1'
        ? { ...equipment, owned: false } : equipment),
    })],
    ['mismatched', state => ({
      ...state,
      kitchenStations: [{ id: 'mismatched-station', equipmentId: 'eq2' }],
      equipment: state.equipment.map(equipment => equipment.id === 'eq2'
        ? { ...equipment, owned: true } : equipment),
    })],
  ])('warns when the station equipment is %s', (_label, configure) => {
    useGameState.mockReturnValue(configure(createInitialState()));
    render(<MenuPanel />);

    expect(starterDish().getByText(/Toaster.*no compatible kitchen station/)).toBeVisible();
  });

  it('requires any station for an unrestricted dish and clears that warning when one is added', () => {
    const dish = {
      id: 'unrestricted-dish', name: 'Garden Salad', price: 12, prepTime: 60,
      quality: 1, popularity: 50, requiredEquipmentId: null,
    };
    const state = { ...createInitialState(), dishes: [dish], kitchenStations: [] };
    useGameState.mockReturnValue(state);
    const view = render(<MenuPanel />);
    const card = () => within(screen.getByRole('article', { name: 'Garden Salad menu item' }));

    expect(card().getByText('Kitchen equipment: this dish needs a kitchen station.')).toBeVisible();

    useGameState.mockReturnValue({
      ...state, kitchenStations: [{ id: 'bare-station', equipmentId: null }],
    });
    view.rerender(<MenuPanel />);

    expect(card().queryByText('Kitchen equipment: this dish needs a kitchen station.'))
      .not.toBeInTheDocument();
  });

  it.each([
    ['read-only', state => state, true],
    ['career decision', state => ({ ...state, careerRun: { needsDecision: true } }), false],
  ])('keeps advice visible for suspended dishes in %s mode', (_label, configure, readOnly) => {
    const initial = createInitialState();
    const state = configure({
      ...initial,
      kitchenStations: [],
      restaurant: { ...initial.restaurant, suspendedDishIds: ['starter-toast'] },
    });
    useGameState.mockReturnValue(state);
    render(<MenuPanel readOnly={readOnly} />);

    expect(starterDish().getByText('Suspended for walk-ins')).toBeVisible();
    expect(starterDish().getByText(/Toaster.*no compatible kitchen station/)).toBeVisible();
  });
});
