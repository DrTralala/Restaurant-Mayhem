import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecipeCreator from './RecipeCreator';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

import { useDispatch, useGameState } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

describe('RecipeCreator', () => {
  it('constrains creation prices to finite integers from $1 to $100', () => {
    useGameState.mockReturnValue({
      equipment: [{ id: 'eq2', name: 'Oven', owned: true }],
      dishes: [],
      recipeSlots: 1,
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<RecipeCreator onClose={vi.fn()} />);

    const price = screen.getByRole('spinbutton', { name: 'Price: $' });
    expect(price).toHaveAttribute('min', '1');
    expect(price).toHaveAttribute('max', '100');

    fireEvent.change(screen.getByLabelText('Dish name:'), { target: { value: 'Soup' } });
    fireEvent.change(price, { target: { value: '101' } });
    expect(screen.getByRole('button', { name: /Create/ })).toBeDisabled();

    fireEvent.change(price, { target: { value: '12.5' } });
    expect(screen.getByRole('button', { name: /Create/ })).toBeDisabled();
  });

  it('allows another dish when the legacy recipe-slot count is full', () => {
    useGameState.mockReturnValue({
      equipment: [{ id: 'eq2', name: 'Oven', owned: true }],
      dishes: [{ id: 'existing' }],
      recipeSlots: 1,
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<RecipeCreator onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Dish name:'), { target: { value: 'Soup' } });

    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });
});

describe('RecipeCreator validation guidance', () => {
  const ownedOvenState = {
    equipment: [{ id: 'eq2', name: 'Oven', owned: true }],
    dishes: [],
    recipeSlots: 1,
  };
  const priceMessage = 'Price must be a whole number from $1 to $100.';

  const renderCreator = (state) => {
    useGameState.mockReturnValue(state);
    const dispatch = vi.fn();
    const onClose = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const view = render(<RecipeCreator onClose={onClose} />);
    return { ...view, dispatch, onClose };
  };

  it('shows blank-name guidance on first render and marks the name input invalid', () => {
    const { dispatch, onClose } = renderCreator(ownedOvenState);

    expect(screen.getByText('Enter a dish name.')).toBeVisible();
    const name = screen.getByLabelText('Dish name:');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'dish-name-error');

    const create = screen.getByRole('button', { name: /Create/ });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears name guidance when corrected but treats whitespace as blank', () => {
    renderCreator(ownedOvenState);
    const name = screen.getByLabelText('Dish name:');

    fireEvent.change(name, { target: { value: '   ' } });
    expect(screen.getByText('Enter a dish name.')).toBeVisible();
    expect(name).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(name, { target: { value: 'Soup ' } });
    expect(screen.queryByText('Enter a dish name.')).not.toBeInTheDocument();
    expect(name).not.toHaveAttribute('aria-describedby');
    expect(name).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('button', { name: /Create/ })).toBeEnabled();
  });

  it('explains blank, zero, out-of-range and fractional prices', () => {
    renderCreator(ownedOvenState);
    const price = screen.getByRole('spinbutton', { name: 'Price: $' });
    expect(screen.queryByText(priceMessage)).not.toBeInTheDocument();
    expect(price).toHaveAttribute('aria-invalid', 'false');

    for (const value of ['', '0', '101', '12.5']) {
      fireEvent.change(price, { target: { value } });
      expect(screen.getByText(priceMessage)).toBeVisible();
      expect(price).toHaveAttribute('aria-invalid', 'true');
      expect(price).toHaveAttribute('aria-describedby', 'dish-price-error');
      expect(screen.getByRole('button', { name: /Create/ })).toBeDisabled();
    }
  });

  it('accepts the price boundaries 1 and 100 and clears the price guidance', () => {
    renderCreator(ownedOvenState);
    const name = screen.getByLabelText('Dish name:');
    const price = screen.getByRole('spinbutton', { name: 'Price: $' });
    fireEvent.change(name, { target: { value: 'Soup' } });
    fireEvent.change(price, { target: { value: '0' } });
    expect(screen.getByText(priceMessage)).toBeVisible();

    for (const value of ['1', '100']) {
      fireEvent.change(price, { target: { value } });
      expect(screen.queryByText(priceMessage)).not.toBeInTheDocument();
      expect(price).not.toHaveAttribute('aria-describedby');
      expect(price).toHaveAttribute('aria-invalid', 'false');
      expect(screen.getByRole('button', { name: /Create/ })).toBeEnabled();
    }
  });

  it('shows required-equipment fallback when the fixture is missing', () => {
    renderCreator({ equipment: [], dishes: [], recipeSlots: 1 });

    expect(screen.getByText('You need to own the required equipment first.')).toBeVisible();
    const method = screen.getByLabelText('Cooking method:');
    expect(method).toHaveAttribute('aria-invalid', 'true');
    expect(method).toHaveAttribute('aria-describedby', 'recipe-equipment-guidance');
  });

  it('shows unowned-equipment guidance and updates it for the selected method', () => {
    renderCreator({
      equipment: [
        { id: 'eq2', name: 'Oven', owned: false },
        { id: 'eq4', name: 'Blender', owned: true },
      ],
      dishes: [],
      recipeSlots: 1,
    });
    const method = screen.getByLabelText('Cooking method:');
    expect(screen.getByText('You need to own Oven first.')).toBeVisible();
    expect(method).toHaveAttribute('aria-invalid', 'true');
    expect(method).toHaveAttribute('aria-describedby', 'recipe-equipment-guidance');

    fireEvent.change(method, { target: { value: 'Blended' } });
    expect(screen.queryByText('You need to own Oven first.')).not.toBeInTheDocument();
    expect(screen.getByText('Requires: Blender (owned)')).toBeVisible();
    expect(method).toHaveAttribute('aria-invalid', 'false');
  });

  it('updates equipment guidance when ownership changes on rerender', () => {
    const { rerender, onClose } = renderCreator({
      equipment: [{ id: 'eq2', name: 'Oven', owned: false }],
      dishes: [],
      recipeSlots: 1,
    });
    expect(screen.getByText('You need to own Oven first.')).toBeVisible();

    useGameState.mockReturnValue({
      equipment: [{ id: 'eq2', name: 'Oven', owned: true }],
      dishes: [],
      recipeSlots: 1,
    });
    rerender(<RecipeCreator onClose={onClose} />);

    expect(screen.queryByText('You need to own Oven first.')).not.toBeInTheDocument();
    expect(screen.getByText('Requires: Oven (owned)')).toBeVisible();
    expect(screen.getByLabelText('Cooking method:')).toHaveAttribute('aria-invalid', 'false');
  });

  it('labels both selects', () => {
    renderCreator(ownedOvenState);

    expect(screen.getByRole('combobox', { name: 'Base ingredient:' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Cooking method:' })).toBeInTheDocument();
  });

  it('dispatches the exact trimmed ADD_DISH payload once and closes', () => {
    const { dispatch, onClose } = renderCreator(ownedOvenState);
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);

    fireEvent.change(screen.getByLabelText('Dish name:'), { target: { value: '  Soup  ' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price: $' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ADD_DISH',
      dish: {
        id: 'dish-123456789',
        name: 'Soup',
        base: 'Bread',
        method: 'Grilled',
        price: 12,
        prepTime: 120,
        quality: 1,
        popularity: 45,
        cuisine: 'generic',
        requiredEquipmentId: 'eq2',
        unlocked: true,
      },
    });
    expect(randomSpy).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once on Cancel without dispatching', () => {
    const { dispatch, onClose } = renderCreator(ownedOvenState);
    fireEvent.change(screen.getByLabelText('Dish name:'), { target: { value: 'Soup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
