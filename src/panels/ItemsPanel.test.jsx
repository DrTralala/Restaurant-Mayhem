import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ItemsPanel from './ItemsPanel';
import { useDispatch, useGameState } from '../state/GameContext';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

describe('ItemsPanel', () => {
  it('offers physical tables and chairs as items', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Dining table')).toBeInTheDocument();
    expect(screen.getByText('Dining chair')).toBeInTheDocument();
    expect(screen.getByText('Additional door')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
    expect(screen.getByText('A four-seat dining table. Add chairs separately before seating guests.'))
      .toBeInTheDocument();
    expect(screen.getByText('Adds one movable chair next to a table with an available seat.'))
      .toBeInTheDocument();
    expect(screen.getByText('Adds a new entrance door. Change its role from the canvas when needed.'))
      .toBeInTheDocument();
    expect(screen.getByText('A cashier station assigned to an available waiter when placed.'))
      .toBeInTheDocument();
  });

  it('offers the automatic dishwasher at $2000 with its level and capacity description', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 1000 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Automatic dishwasher')).toBeInTheDocument();
    expect(screen.getByText('$2000')).toBeInTheDocument();
    expect(screen.getByText(/10 levels.*600 seconds.*12 items/i))
      .toBeInTheDocument();
  });

  it('offers the couch, arcade, and bed with their staff wellbeing policies', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 3000 } });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('Couch')).toBeInTheDocument();
    expect(screen.getByText(/Two staff seats.*15 minutes.*\+6 morale per hour/i)).toBeInTheDocument();
    expect(screen.getByText('Arcade')).toBeInTheDocument();
    expect(screen.getByText(/One staff seat.*10 minutes.*\+8 morale per hour/i)).toBeInTheDocument();
    expect(screen.getByText('Bed')).toBeInTheDocument();
    expect(screen.getByText(/minimum 7 in-game hours.*restores full morale.*reduces morale drain during recovery/i))
      .toBeInTheDocument();
  });

  it('starts placement for every shop item without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 3000 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    for (const [name, type] of [
      ['Dining table', 'table'],
      ['Dining chair', 'chair'],
      ['Additional door', 'door'],
      ['Cashier', 'cashierTable'],
      ['Automatic dishwasher', 'automaticDishwasher'],
      ['Couch', 'couch'],
      ['Arcade', 'arcade'],
      ['Bed', 'bed'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Buy ${name}`) }));
    }

    expect(startPlacement.mock.calls).toEqual([
      ['table'],
      ['chair'],
      ['door'],
      ['cashierTable'],
      ['automaticDishwasher'],
      ['couch'],
      ['arcade'],
      ['bed'],
    ]);
  });

  it('starts placement for each staff amenity without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 3000 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Couch ($400)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Arcade ($800)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Bed ($500)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Automatic dishwasher ($2000)' }));

    expect(startPlacement.mock.calls).toEqual([
      ['couch'],
      ['arcade'],
      ['bed'],
      ['automaticDishwasher'],
    ]);
  });

  it('starts chair placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Dining chair ($50)' }));

    expect(startPlacement).toHaveBeenCalledWith('chair');
  });

  it('starts additional-door placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 500 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Additional door ($400)' }));

    expect(startPlacement).toHaveBeenCalledWith('door');
  });

  it('lists installed staff amenities in order with canonical labels, ids and slot counts', () => {
    useGameState.mockReturnValue({
      restaurant: { funds: 3000 },
      staffAmenities: [
        {
          id: 'couch-1', type: 'couch', x: 100, y: 100, rotation: 0,
          slots: [
            { index: 0, reservedBy: null, occupiedBy: 'staff-1' },
            { index: 1, reservedBy: 'staff-2', occupiedBy: null },
          ],
        },
        {
          id: 'arcade-1', type: 'arcade', x: 200, y: 100, rotation: 0,
          slots: [{ index: 0, reservedBy: null, occupiedBy: null }],
        },
        {
          id: 'bed-1', type: 'bed', x: 300, y: 100, rotation: 0,
          slots: [{ index: 0, reservedBy: 'staff-3', occupiedBy: null }],
        },
      ],
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    const rows = within(screen.getByRole('list', { name: 'Installed staff amenities' }))
      .getAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Couch');
    expect(rows[0]).toHaveTextContent('couch-1');
    expect(rows[0]).toHaveTextContent('Occupied 1 · Reserved 1 · Unclaimed 0 · Capacity 2');
    expect(rows[1]).toHaveTextContent('Arcade');
    expect(rows[1]).toHaveTextContent('arcade-1');
    expect(rows[1]).toHaveTextContent('Occupied 0 · Reserved 0 · Unclaimed 1 · Capacity 1');
    expect(rows[2]).toHaveTextContent('Bed');
    expect(rows[2]).toHaveTextContent('bed-1');
    expect(rows[2]).toHaveTextContent('Occupied 0 · Reserved 1 · Unclaimed 0 · Capacity 1');
    expect(screen.getByText(/Current slot ownership only\. Reserved slots are not yet occupied; unclaimed slots do not guarantee access or immediate use\./))
      .toBeInTheDocument();
    expect(screen.queryByText(/staff-[123]/)).not.toBeInTheDocument();
  });

  it('reports when no staff amenities are installed', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 500 }, staffAmenities: [] });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(screen.getByText('No staff amenities installed.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Installed staff amenities' })).not.toBeInTheDocument();
  });

  it('marks malformed and unknown staff amenities as unavailable', () => {
    useGameState.mockReturnValue({
      restaurant: { funds: 500 },
      staffAmenities: [
        { id: 'couch-bad', type: 'couch', slots: [{ index: 0, reservedBy: null, occupiedBy: null }] },
        { id: 'sauna-1', type: 'sauna', slots: [] },
      ],
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    const rows = within(screen.getByRole('list', { name: 'Installed staff amenities' }))
      .getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Couch');
    expect(rows[0]).toHaveTextContent('couch-bad');
    expect(rows[0]).toHaveTextContent('Usage unavailable.');
    expect(rows[1]).toHaveTextContent('Unknown amenity');
    expect(rows[1]).toHaveTextContent('sauna-1');
    expect(rows[1]).toHaveTextContent('Usage unavailable.');
    expect(screen.getAllByText('Usage unavailable.')).toHaveLength(2);
  });

  it('updates the staff amenity rows when game state changes on rerender', () => {
    useDispatch.mockReturnValue(vi.fn());
    useGameState.mockReturnValue({
      restaurant: { funds: 500 },
      staffAmenities: [
        { id: 'bed-1', type: 'bed', slots: [{ index: 0, reservedBy: null, occupiedBy: null }] },
      ],
    });

    const { rerender } = render(<ItemsPanel onStartPlacement={vi.fn()} />);

    expect(within(screen.getByRole('list', { name: 'Installed staff amenities' }))
      .getAllByRole('listitem')[0])
      .toHaveTextContent('Occupied 0 · Reserved 0 · Unclaimed 1 · Capacity 1');

    useGameState.mockReturnValue({
      restaurant: { funds: 500 },
      staffAmenities: [
        { id: 'bed-1', type: 'bed', slots: [{ index: 0, reservedBy: null, occupiedBy: 'staff-9' }] },
        { id: 'arcade-1', type: 'arcade', slots: [{ index: 0, reservedBy: null, occupiedBy: null }] },
      ],
    });
    rerender(<ItemsPanel onStartPlacement={vi.fn()} />);

    const rows = within(screen.getByRole('list', { name: 'Installed staff amenities' }))
      .getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Occupied 1 · Reserved 0 · Unclaimed 0 · Capacity 1');
    expect(rows[1]).toHaveTextContent('Occupied 0 · Reserved 0 · Unclaimed 1 · Capacity 1');
  });

  it('keeps the Buy callbacks unchanged while staff amenities are listed', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({
      restaurant: { funds: 3000 },
      staffAmenities: [
        {
          id: 'couch-1', type: 'couch',
          slots: [
            { index: 0, reservedBy: null, occupiedBy: null },
            { index: 1, reservedBy: null, occupiedBy: null },
          ],
        },
      ],
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Couch ($400)' }));

    expect(startPlacement).toHaveBeenCalledWith('couch');
  });

  it('disables Buy for missing, non-finite or negative funds and allows exact funds', () => {
    useDispatch.mockReturnValue(vi.fn());
    const startPlacement = vi.fn();

    for (const restaurant of [
      {},
      { funds: Number.NaN },
      { funds: Number.POSITIVE_INFINITY },
      { funds: Number.NEGATIVE_INFINITY },
      { funds: -5 },
    ]) {
      useGameState.mockReturnValue({ restaurant });
      const { unmount } = render(<ItemsPanel onStartPlacement={startPlacement} />);
      const buttons = screen.getAllByRole('button', { name: /^Buy / });
      expect(buttons).toHaveLength(8);
      for (const button of buttons) {
        expect(button).toBeDisabled();
      }
      unmount();
    }

    useGameState.mockReturnValue({ restaurant: { funds: 50 } });
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    expect(screen.getByRole('button', { name: 'Buy Dining chair ($50)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Buy Additional door ($400)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Buy Dining chair ($50)' }));
    expect(startPlacement).toHaveBeenCalledWith('chair');
  });

  it('shows canonical default and quarter-turn footprints without grid rounding', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 5000 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    const expected = [
      ['Buy Dining table', 'Default footprint: 40 × 40 world units.', null],
      ['Buy Dining chair', 'Default footprint: 20 × 20 world units.', 'Quarter-turn footprint: 20 × 20 world units.'],
      ['Buy Additional door', 'Default footprint: 6 × 40 world units.', null],
      ['Buy Cashier', 'Default footprint: 40 × 40 world units.', null],
      ['Buy Automatic dishwasher', 'Default footprint: 40 × 40 world units.', null],
      ['Buy Couch', 'Default footprint: 40 × 20 world units.', 'Quarter-turn footprint: 20 × 40 world units.'],
      ['Buy Arcade', 'Default footprint: 20 × 20 world units.', 'Quarter-turn footprint: 20 × 20 world units.'],
      ['Buy Bed', 'Default footprint: 20 × 40 world units.', 'Quarter-turn footprint: 40 × 20 world units.'],
    ];

    for (const [buttonName, defaultText, quarterText] of expected) {
      const button = screen.getByRole('button', { name: new RegExp(`^${buttonName} \\(\\$`) });
      const card = button.parentElement;
      expect(within(card).getByText(defaultText)).toBeInTheDocument();
      if (quarterText) {
        expect(within(card).getByText(quarterText)).toBeInTheDocument();
      } else {
        expect(within(card).queryByText(/Quarter-turn footprint:/)).not.toBeInTheDocument();
      }
    }
  });

  it('links placement copy, description and footprint with unique useId targets across two panels', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 5000 } });
    useDispatch.mockReturnValue(vi.fn());
    render(
      <>
        <ItemsPanel onStartPlacement={vi.fn()} />
        <ItemsPanel onStartPlacement={vi.fn()} />
      </>,
    );

    const copyText = 'Buy starts placement. Charged only after valid placement; cancelling costs nothing. Footprints exclude access space and do not guarantee a valid position.';
    const copyNodes = screen.getAllByText(copyText);
    expect(copyNodes).toHaveLength(2);
    const copyIds = copyNodes.map(node => node.id);
    expect(copyIds.every(Boolean)).toBe(true);
    expect(new Set(copyIds).size).toBe(2);

    const buttons = screen.getAllByRole('button', { name: /^Buy / });
    expect(buttons).toHaveLength(16);
    const describedby = buttons.map(button => button.getAttribute('aria-describedby'));
    expect(new Set(describedby).size).toBe(16);
    for (const [index, value] of describedby.entries()) {
      const ids = value.split(/\s+/);
      expect(ids).toContain(copyIds[index < 8 ? 0 : 1]);
      const card = buttons[index].parentElement;
      const quarter = within(card).queryByText(/^Quarter-turn footprint: .* world units\.$/);
      expect(new Set(ids).size).toBe(quarter ? 4 : 3);
      for (const id of ids) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });

  it('links each visible quarter-turn footprint into the rotatable card aria-describedby', () => {
    useGameState.mockReturnValue({ restaurant: { funds: 5000 } });
    useDispatch.mockReturnValue(vi.fn());
    render(<ItemsPanel onStartPlacement={vi.fn()} />);

    for (const buttonName of ['Buy Dining chair', 'Buy Couch', 'Buy Arcade', 'Buy Bed']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${buttonName} \\(\\$`) });
      const quarter = within(button.parentElement).getByText(/^Quarter-turn footprint: .* world units\.$/);
      expect(quarter.id).toBeTruthy();
      expect(button.getAttribute('aria-describedby').split(/\s+/)).toContain(quarter.id);
    }

    for (const buttonName of ['Buy Dining table', 'Buy Additional door', 'Buy Cashier', 'Buy Automatic dishwasher']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${buttonName} \\(\\$`) });
      const card = button.parentElement;
      expect(within(card).queryByText(/^Quarter-turn footprint: .* world units\.$/)).not.toBeInTheDocument();
      const ids = button.getAttribute('aria-describedby').split(/\s+/);
      expect(ids).toHaveLength(3);
      expect(ids.some(id => id.includes('quarter'))).toBe(false);
    }
  });

  it('only starts placement on Buy without dispatching a charge', () => {
    const startPlacement = vi.fn();
    const dispatch = vi.fn();
    useGameState.mockReturnValue({ restaurant: { funds: 50 } });
    useDispatch.mockReturnValue(dispatch);
    render(<ItemsPanel onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buy Dining chair ($50)' }));

    expect(startPlacement).toHaveBeenCalledTimes(1);
    expect(startPlacement).toHaveBeenCalledWith('chair');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
