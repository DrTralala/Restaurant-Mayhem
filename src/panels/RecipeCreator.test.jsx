import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecipeCreator from './RecipeCreator';
import { CUSTOM_RECIPE_STATS } from '../data/recipes';

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
    expect(document.getElementById(name.getAttribute('aria-describedby'))).toBe(screen.getByText('Enter a dish name.'));

    const create = screen.getByRole('button', { name: /Create/ });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks the dish name as required and shows the exact placeholder', () => {
    renderCreator(ownedOvenState);
    const name = screen.getByLabelText('Dish name:');

    expect(name).toBeRequired();
    expect(name).toHaveAttribute('placeholder', 'Enter a dish name');
  });

  it('blocks dispatch when the name is blank or whitespace only', () => {
    const { dispatch, onClose } = renderCreator(ownedOvenState);
    const name = screen.getByLabelText('Dish name:');
    const create = screen.getByRole('button', { name: /Create/ });

    fireEvent.click(create);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.click(create);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not insert a name when the base or method changes', () => {
    const { dispatch, onClose } = renderCreator(ownedOvenState);
    const name = screen.getByLabelText('Dish name:');

    fireEvent.change(screen.getByRole('combobox', { name: 'Base ingredient:' }), { target: { value: 'Pasta' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Cooking method:' }), { target: { value: 'Baked' } });

    expect(name).toHaveValue('');
    expect(name).toHaveAttribute('placeholder', 'Enter a dish name');
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
      expect(document.getElementById(price.getAttribute('aria-describedby'))).toBe(screen.getByText(priceMessage));
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
    expect(document.getElementById(method.getAttribute('aria-describedby')))
      .toBe(screen.getByText('You need to own the required equipment first.'));
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
    expect(document.getElementById(method.getAttribute('aria-describedby')))
      .toBe(screen.getByText('You need to own Oven first.'));

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

describe('RecipeCreator instance field identity', () => {
  const pairState = {
    equipment: [
      { id: 'eq2', name: 'Oven', owned: true },
      { id: 'eq4', name: 'Blender', owned: true },
    ],
    dishes: [],
    recipeSlots: 1,
  };
  const priceMessage = 'Price must be a whole number from $1 to $100.';

  const renderPair = () => {
    useGameState.mockReturnValue(pairState);
    useDispatch.mockReturnValue(vi.fn());
    render(
      <>
        <div data-testid="creator-one"><RecipeCreator onClose={vi.fn()} /></div>
        <div data-testid="creator-two"><RecipeCreator onClose={vi.fn()} /></div>
      </>,
    );
    return {
      one: screen.getByTestId('creator-one'),
      two: screen.getByTestId('creator-two'),
    };
  };

  const controls = (container) => ({
    base: within(container).getByRole('combobox', { name: 'Base ingredient:' }),
    method: within(container).getByRole('combobox', { name: 'Cooking method:' }),
    name: within(container).getByRole('textbox', { name: 'Dish name:' }),
    price: within(container).getByRole('spinbutton', { name: 'Price: $' }),
  });

  const describedElement = (control) =>
    document.getElementById(control.getAttribute('aria-describedby'));

  it('gives each instance a unique ID prefix with exact label and description associations', () => {
    const { one, two } = renderPair();
    const first = controls(one);
    const second = controls(two);

    fireEvent.change(first.price, { target: { value: '0' } });
    fireEvent.change(second.price, { target: { value: '0' } });

    const firstGuidance = describedElement(first.method);
    const firstPriceError = describedElement(first.price);
    const firstIds = [
      first.base.id,
      first.method.id,
      firstGuidance.id,
      first.name.id,
      describedElement(first.name).id,
      first.price.id,
      firstPriceError.id,
    ];
    const secondIds = [
      second.base.id,
      second.method.id,
      describedElement(second.method).id,
      second.name.id,
      describedElement(second.name).id,
      second.price.id,
      describedElement(second.price).id,
    ];

    expect(firstIds.every(Boolean)).toBe(true);
    expect(secondIds.every(Boolean)).toBe(true);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(new Set(secondIds).size).toBe(secondIds.length);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);

    const prefix = first.base.id.replace(/-base$/, '');
    expect(prefix).not.toBe(first.base.id);
    expect(first.method.id).toBe(`${prefix}-method`);
    expect(firstGuidance.id).toBe(`${prefix}-equipment-guidance`);
    expect(first.name.id).toBe(`${prefix}-name`);
    expect(describedElement(first.name).id).toBe(`${prefix}-name-error`);
    expect(first.price.id).toBe(`${prefix}-price`);
    expect(firstPriceError.id).toBe(`${prefix}-price-error`);

    expect(within(one).getByText('Base ingredient:')).toHaveAttribute('for', first.base.id);
    expect(within(one).getByText('Cooking method:')).toHaveAttribute('for', first.method.id);
    expect(within(one).getByText('Dish name:')).toHaveAttribute('for', first.name.id);
    expect(within(one).getByText('Price: $')).toHaveAttribute('for', first.price.id);
    expect(within(two).getByText('Base ingredient:')).toHaveAttribute('for', second.base.id);
    expect(within(two).getByText('Cooking method:')).toHaveAttribute('for', second.method.id);
    expect(within(two).getByText('Dish name:')).toHaveAttribute('for', second.name.id);
    expect(within(two).getByText('Price: $')).toHaveAttribute('for', second.price.id);

    expect(first.method).toHaveAccessibleDescription('Requires: Oven (owned)');
    expect(second.method).toHaveAccessibleDescription('Requires: Oven (owned)');
    expect(first.name).toHaveAccessibleDescription('Enter a dish name.');
    expect(second.name).toHaveAccessibleDescription('Enter a dish name.');
    expect(first.price).toHaveAccessibleDescription(priceMessage);
    expect(second.price).toHaveAccessibleDescription(priceMessage);
    expect(within(one).getByText('Requires: Oven (owned)')).toBe(firstGuidance);
    expect(within(one).getByText('Enter a dish name.')).toBe(describedElement(first.name));
    expect(within(one).getByText(priceMessage)).toBe(firstPriceError);
    expect(within(two).getByText('Requires: Oven (owned)')).toBe(describedElement(second.method));
    expect(within(two).getByText('Enter a dish name.')).toBe(describedElement(second.name));
    expect(within(two).getByText(priceMessage)).toBe(describedElement(second.price));
  });

  it('keeps edits and conditional errors isolated to the targeted instance', () => {
    const { one, two } = renderPair();
    const first = controls(one);
    const second = controls(two);
    const firstInitialNameError = describedElement(first.name);
    const secondInitialNameError = describedElement(second.name);

    expect(firstInitialNameError).not.toBe(secondInitialNameError);

    fireEvent.change(second.name, { target: { value: 'Soup' } });
    expect(second.name).toHaveValue('Soup');
    expect(first.name).toHaveValue('');
    expect(first.name).toHaveAccessibleDescription('Enter a dish name.');
    expect(second.name).not.toHaveAttribute('aria-describedby');
    expect(within(one).getByText('Enter a dish name.')).toBe(firstInitialNameError);
    expect(within(two).queryByText('Enter a dish name.')).not.toBeInTheDocument();

    fireEvent.change(second.method, { target: { value: 'Blended' } });
    expect(second.method).toHaveAccessibleDescription('Requires: Blender (owned)');
    expect(first.method).toHaveAccessibleDescription('Requires: Oven (owned)');

    fireEvent.change(first.price, { target: { value: '0' } });
    expect(first.price).toHaveAccessibleDescription(priceMessage);
    expect(second.price).not.toHaveAttribute('aria-describedby');
    const firstPriceError = describedElement(first.price);
    expect(within(one).getByText(priceMessage)).toBe(firstPriceError);
    expect(within(two).queryByText(priceMessage)).not.toBeInTheDocument();

    fireEvent.change(second.price, { target: { value: '0' } });
    expect(second.price).toHaveAccessibleDescription(priceMessage);
    expect(within(one).getByText(priceMessage)).toBe(firstPriceError);
    expect(within(two).getByText(priceMessage)).toBe(describedElement(second.price));
    expect(describedElement(second.price)).not.toBe(firstPriceError);
  });
});

describe('RecipeCreator custom base-stat disclosure', () => {
  const ownedOvenState = {
    equipment: [{ id: 'eq2', name: 'Oven', owned: true }],
    dishes: [],
    recipeSlots: 1,
  };
  const disclosureText = 'Creation randomly assigns base prep work from 120 to 239 game seconds and base popularity from 30 to 59. Actual preparation time and order demand depend on other factors.';

  const renderCustomCreator = (state = ownedOvenState) => {
    useGameState.mockReturnValue(state);
    const dispatch = vi.fn();
    const onClose = vi.fn();
    useDispatch.mockReturnValue(dispatch);
    const view = render(<RecipeCreator onClose={onClose} />);
    return { ...view, dispatch, onClose };
  };

  const fillValidDish = () => {
    fireEvent.change(screen.getByLabelText('Dish name:'), { target: { value: 'Soup' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price: $' }), { target: { value: '12' } });
  };

  const expectCreatedDish = ({ dispatch, prepTime, popularity }) => {
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ADD_DISH',
      dish: {
        id: 'dish-123456789',
        name: 'Soup',
        base: 'Bread',
        method: 'Grilled',
        price: 12,
        prepTime,
        quality: 1,
        popularity,
        cuisine: 'generic',
        requiredEquipmentId: 'eq2',
        unlocked: true,
      },
    });
  };

  it('exports frozen custom recipe stat bounds', () => {
    expect(CUSTOM_RECIPE_STATS).toEqual({
      prepTime: { min: 120, max: 239 },
      popularity: { min: 30, max: 59 },
    });
    expect(Object.isFrozen(CUSTOM_RECIPE_STATS)).toBe(true);
    expect(Object.isFrozen(CUSTOM_RECIPE_STATS.prepTime)).toBe(true);
    expect(Object.isFrozen(CUSTOM_RECIPE_STATS.popularity)).toBe(true);
  });

  it('renders the exact disclosure as a wrapping paragraph linked to Create', () => {
    renderCustomCreator();
    const create = screen.getByRole('button', { name: 'Create' });
    const disclosure = screen.getByText(disclosureText);

    expect(disclosure.tagName).toBe('P');
    expect(disclosure).toHaveTextContent(disclosureText);
    expect(disclosureText).toBe(`Creation randomly assigns base prep work from ${CUSTOM_RECIPE_STATS.prepTime.min} to ${CUSTOM_RECIPE_STATS.prepTime.max} game seconds and base popularity from ${CUSTOM_RECIPE_STATS.popularity.min} to ${CUSTOM_RECIPE_STATS.popularity.max}. Actual preparation time and order demand depend on other factors.`);
    expect(disclosureText).not.toMatch(/%|ETA/i);

    const descriptionId = create.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId)).toBe(disclosure);
    expect(create).toHaveAccessibleDescription(disclosureText);
    expect(disclosure.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('uses a unique useId-derived disclosure for each instance', () => {
    useGameState.mockReturnValue(ownedOvenState);
    useDispatch.mockReturnValue(vi.fn());
    render(
      <>
        <div data-testid="creator-one"><RecipeCreator onClose={vi.fn()} /></div>
        <div data-testid="creator-two"><RecipeCreator onClose={vi.fn()} /></div>
      </>,
    );
    const one = screen.getByTestId('creator-one');
    const two = screen.getByTestId('creator-two');

    const firstDisclosure = within(one).getByText(disclosureText);
    const secondDisclosure = within(two).getByText(disclosureText);
    const firstCreate = within(one).getByRole('button', { name: 'Create' });
    const secondCreate = within(two).getByRole('button', { name: 'Create' });

    expect(firstDisclosure.id).toBeTruthy();
    expect(firstDisclosure.id).not.toBe(secondDisclosure.id);
    expect(firstDisclosure.id).toMatch(/-custom-stats$/);
    expect(secondDisclosure.id).toMatch(/-custom-stats$/);
    expect(firstCreate).toHaveAttribute('aria-describedby', firstDisclosure.id);
    expect(secondCreate).toHaveAttribute('aria-describedby', secondDisclosure.id);
    expect(firstCreate).toHaveAccessibleDescription(disclosureText);
    expect(secondCreate).toHaveAccessibleDescription(disclosureText);
  });

  it('rolls inclusive lower endpoints at 0', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
    const { dispatch, onClose } = renderCustomCreator();
    fillValidDish();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expectCreatedDish({ dispatch, prepTime: 120, popularity: 30 });
    expect(randomSpy).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing midpoint payload at 0.5', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { dispatch } = renderCustomCreator();
    expect(randomSpy).not.toHaveBeenCalled();

    fillValidDish();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expectCreatedDish({ dispatch, prepTime: 180, popularity: 45 });
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });

  it('rolls inclusive upper endpoints at 1 - Number.EPSILON', () => {
    const nearOne = 1 - Number.EPSILON;
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const randomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(nearOne)
      .mockReturnValueOnce(nearOne);
    const { dispatch } = renderCustomCreator();
    fillValidDish();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expectCreatedDish({ dispatch, prepTime: 239, popularity: 59 });
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });

  it('draws exactly twice in prep-then-popularity order for a valid creation', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const { dispatch, onClose } = renderCustomCreator();
    expect(randomSpy).not.toHaveBeenCalled();

    fillValidDish();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(randomSpy).toHaveBeenCalledTimes(2);
    expectCreatedDish({ dispatch, prepTime: 150, popularity: 52 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not draw randomness on render or invalid Create attempts', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const { dispatch, onClose, rerender } = renderCustomCreator();
    expect(randomSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(randomSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();

    fillValidDish();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price: $' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(randomSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();

    useGameState.mockReturnValue({
      equipment: [{ id: 'eq2', name: 'Oven', owned: false }],
      dishes: [],
      recipeSlots: 1,
    });
    rerender(<RecipeCreator onClose={onClose} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price: $' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(randomSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
