import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getMenuAnalysis } from '../simulation/menuEconomy';
import { withOwnedAuthoredDishes } from '../simulation/menuTestFixtures';
import MenuPricePreview, { createMenuPricePreviewPresentation } from './MenuPricePreview';

const menu = withOwnedAuthoredDishes({
  dishes: [{ id: 'toast', cookbookId: 'toast', name: 'Toast', price: 12, quality: 2 }],
  unlockedDrinkIds: ['water'],
  drinkOverrides: { water: { price: 8, quality: 3 } },
  restaurant: { reputation: 3 },
});

describe('MenuPricePreview', () => {
  it('shows the item price and current-versus-draft whole-menu gross with caveats', () => {
    const currentGrossPer100 = 456.789;
    const currentAffordabilityByTier = getMenuAnalysis(menu).affordabilityByTier;
    const presentation = createMenuPricePreviewPresentation({
      state: menu, kind: 'dish', id: 'toast', name: 'Toast', price: 19,
      currentGrossPer100, currentAffordabilityByTier,
    });
    render(
      <MenuPricePreview presentation={presentation} />,
    );

    const preview = screen.getByRole('group', { name: 'Price preview for Toast' });
    expect(within(preview).getByText(/Draft price: \$19/)).toBeInTheDocument();
    expect(within(preview).getByLabelText('Current expected whole-menu gross per 100 hypothetical walk-in guests'))
      .toHaveTextContent('$456.79');
    expect(within(preview).getByLabelText('Draft expected whole-menu gross per 100 hypothetical walk-in guests'))
      .toHaveTextContent(presentation.draftAmount);
    expect(within(preview).getByText(
      'Expected whole-menu gross per 100 hypothetical walk-in guests.',
    )).toBeInTheDocument();
    expect(within(preview).getByText('Reference value $12.96 · Allowed price $9–$16'))
      .toBeInTheDocument();
    expect(within(preview).getByText(
      'Above-reference dish prices reduce expected walk-in demand because some guests decline them even when their budget can afford the dish.',
    )).toBeInTheDocument();
    expect(within(preview).getByText(
      'Expected gross is not profit. Excludes service capacity and booked contracts; actual purchases are not guaranteed.',
    )).toBeInTheDocument();
    expect(within(preview).getByText(
      'Affordable integer-budget-point shares by tier (current → draft).',
    )).toBeInTheDocument();
    expect(within(preview).getByText(
      'These shares describe budget fit only, not predicted purchases.',
    )).toBeInTheDocument();
    expect(within(preview).queryByText(/optimal|recommended price/i)).not.toBeInTheDocument();
  });

  it.each([
    [1, 'Reference value $12.00 · Allowed price $9–$15'],
    [10, 'Reference value $20.64 · Allowed price $9–$25'],
  ])('shows helper-derived toast pricing at quality %i', (quality, guidance) => {
    const state = withOwnedAuthoredDishes({
      restaurant: { reputation: 3 },
      dishes: [{ id: 'toast', cookbookId: 'toast', name: 'Toast', price: 12, quality }],
      unlockedDrinkIds: [],
    });
    const current = getMenuAnalysis(state);
    const presentation = createMenuPricePreviewPresentation({
      state, kind: 'dish', id: 'toast', name: 'Toast', price: 13,
      currentGrossPer100: current.expectedGrossPer100,
      currentAffordabilityByTier: current.affordabilityByTier,
    });
    render(<MenuPricePreview presentation={presentation} />);

    expect(screen.getByRole('group', { name: 'Price preview for Toast' }))
      .toHaveTextContent(guidance);
  });

  it('shows current-to-draft tier percentages for food and drink price overrides', () => {
    const dishMenu = withOwnedAuthoredDishes({
      restaurant: { reputation: 1 },
      dishes: [{ id: 'toast', cookbookId: 'toast', name: 'Toast', price: 18, quality: 10 }],
      unlockedDrinkIds: [],
    });
    const drinkMenu = {
      restaurant: { reputation: 1 },
      dishes: [],
      unlockedDrinkIds: ['water'],
      drinkOverrides: { water: { price: 18 } },
    };
    const rowsFor = (state, kind, id) => {
      const current = getMenuAnalysis(state);
      return createMenuPricePreviewPresentation({
        state, kind, id, name: kind === 'dish' ? 'Toast' : 'Water', price: 19,
        currentGrossPer100: current.expectedGrossPer100,
        currentAffordabilityByTier: current.affordabilityByTier,
      }).affordabilityRows;
    };

    expect(rowsFor(dishMenu, 'dish', 'toast')).toEqual([
      { tier: 'Budget', dishCurrent: '7.7%', dishDraft: '0%', anyOrderCurrent: '7.7%', anyOrderDraft: '0%' },
      { tier: 'Value', dishCurrent: '90.3%', dishDraft: '87.1%', anyOrderCurrent: '90.3%', anyOrderDraft: '87.1%' },
      { tier: 'Premium', dishCurrent: '100%', dishDraft: '100%', anyOrderCurrent: '100%', anyOrderDraft: '100%' },
    ]);
    expect(rowsFor(drinkMenu, 'drink', 'water')).toEqual([
      { tier: 'Budget', dishCurrent: '0%', dishDraft: '0%', anyOrderCurrent: '7.7%', anyOrderDraft: '0%' },
      { tier: 'Value', dishCurrent: '0%', dishDraft: '0%', anyOrderCurrent: '90.3%', anyOrderDraft: '87.1%' },
      { tier: 'Premium', dishCurrent: '0%', dishDraft: '0%', anyOrderCurrent: '100%', anyOrderDraft: '100%' },
    ]);
  });

  it('keeps a suspended item out of both current and draft whole-menu gross', () => {
    const suspendedMenu = {
      ...menu,
      restaurant: { ...menu.restaurant, suspendedDishIds: ['toast'] },
    };
    const currentGrossPer100 = getMenuAnalysis(suspendedMenu).expectedGrossPer100;
    const presentation = createMenuPricePreviewPresentation({
      state: suspendedMenu,
      kind: 'dish', id: 'toast', name: 'Toast', price: 70, currentGrossPer100,
    });
    expect(presentation.draftAmount).toBe(presentation.currentAmount);
  });

  it('keeps retained sizing content invisible, inert, and outside accessible role queries', () => {
    const presentation = {
      accessibleName: 'Price preview for Toast',
      itemLine: 'Toast · Draft price: $19',
      description: 'Expected whole-menu gross per 100 hypothetical walk-in guests.',
      currentLabel: 'Current expected whole-menu gross per 100 hypothetical walk-in guests',
      currentAmount: '$456.79',
      draftLabel: 'Draft expected whole-menu gross per 100 hypothetical walk-in guests',
      draftAmount: '$321.00',
      affordabilityHeading: 'Affordable integer-budget-point shares by tier (current → draft).',
      affordabilityRows: [
        { tier: 'Budget', dishCurrent: '7.7%', dishDraft: '0%', anyOrderCurrent: '7.7%', anyOrderDraft: '0%' },
        { tier: 'Value', dishCurrent: '90.3%', dishDraft: '87.1%', anyOrderCurrent: '90.3%', anyOrderDraft: '87.1%' },
        { tier: 'Premium', dishCurrent: '100%', dishDraft: '100%', anyOrderCurrent: '100%', anyOrderDraft: '100%' },
      ],
      affordabilityCaveat: 'These shares describe budget fit only, not predicted purchases.',
      caveat: 'Expected gross is not profit. Excludes service capacity and booked contracts; actual purchases are not guaranteed.',
    };
    const view = render(<MenuPricePreview presentation={presentation} inactive />);

    expect(screen.queryByRole('group', { name: 'Price preview for Toast' })).not.toBeInTheDocument();
    const retained = view.container.querySelector('[aria-hidden="true"]');
    expect(retained).toBeInTheDocument();
    expect(retained).toHaveAttribute('inert');
    expect(retained).toHaveStyle({ visibility: 'hidden', pointerEvents: 'none' });
    expect(retained).toHaveTextContent('Toast · Draft price: $19');
    expect(retained).toHaveTextContent('Budget: dish-containing orders 7.7% → 0%; any orders 7.7% → 0%');
    expect(retained).toHaveTextContent('These shares describe budget fit only, not predicted purchases.');
    expect(retained).toHaveTextContent('Expected gross is not profit. Excludes service capacity and booked contracts; actual purchases are not guaranteed.');
    expect(retained.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(retained.querySelector('a[href], button, input, select, textarea, [tabindex]')).toBeNull();
  });
});
