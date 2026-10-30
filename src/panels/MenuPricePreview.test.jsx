import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getMenuAnalysis } from '../simulation/menuEconomy';
import MenuPricePreview, { createMenuPricePreviewPresentation } from './MenuPricePreview';

const menu = {
  dishes: [{
    id: 'toast', name: 'Toast', price: 12, prepTime: 60, quality: 2, popularity: 45,
  }],
  unlockedDrinkIds: ['water'],
  drinkOverrides: { water: { price: 8, quality: 3 } },
  restaurant: { reputation: 3 },
};

describe('MenuPricePreview', () => {
  it('shows the item price and current-versus-draft whole-menu gross with caveats', () => {
    const currentGrossPer100 = 456.789;
    const presentation = createMenuPricePreviewPresentation({
      state: menu, kind: 'dish', id: 'toast', name: 'Toast', price: 19, currentGrossPer100,
    });
    render(
      <MenuPricePreview presentation={presentation} />,
    );

    const preview = screen.getByRole('group', { name: 'Price preview for Toast' });
    expect(within(preview).getByText(/Draft price: \$19/)).toBeInTheDocument();
    expect(within(preview).getByLabelText('Current whole-menu gross per 100 hypothetical walk-in guests'))
      .toHaveTextContent('$456.79');
    expect(within(preview).getByLabelText('Draft whole-menu gross per 100 hypothetical walk-in guests'))
      .toHaveTextContent(presentation.draftAmount);
    expect(within(preview).getByText(
      'Modelled whole-menu gross per 100 hypothetical walk-in guests.',
    )).toBeInTheDocument();
    expect(within(preview).getByText(
      'Not profit. Excludes service capacity and booked contracts; actual sales are not guaranteed.',
    )).toBeInTheDocument();
    expect(within(preview).queryByText(/optimal|recommended price/i)).not.toBeInTheDocument();
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
      description: 'Modelled whole-menu gross per 100 hypothetical walk-in guests.',
      currentLabel: 'Current whole-menu gross per 100 hypothetical walk-in guests',
      currentAmount: '$456.79',
      draftLabel: 'Draft whole-menu gross per 100 hypothetical walk-in guests',
      draftAmount: '$321.00',
      caveat: 'Not profit. Excludes service capacity and booked contracts; actual sales are not guaranteed.',
    };
    const view = render(<MenuPricePreview presentation={presentation} inactive />);

    expect(screen.queryByRole('group', { name: 'Price preview for Toast' })).not.toBeInTheDocument();
    const retained = view.container.querySelector('[aria-hidden="true"]');
    expect(retained).toBeInTheDocument();
    expect(retained).toHaveAttribute('inert');
    expect(retained).toHaveStyle({ visibility: 'hidden', pointerEvents: 'none' });
    expect(retained).toHaveTextContent('Toast · Draft price: $19');
    expect(retained).toHaveTextContent('Not profit. Excludes service capacity and booked contracts; actual sales are not guaranteed.');
    expect(retained.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(retained.querySelector('a[href], button, input, select, textarea, [tabindex]')).toBeNull();
  });
});
