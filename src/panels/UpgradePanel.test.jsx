import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpgradePanel from './UpgradePanel';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
  useDispatch: vi.fn(),
}));

import { useDispatch, useGameState } from '../state/GameContext';

afterEach(() => vi.restoreAllMocks());

describe('UpgradePanel', () => {
  it('displays finite equipment multipliers when state values are missing', () => {
    useGameState.mockReturnValue({
      upgrades: [],
      restaurant: { funds: 0, expansionLevel: 4 },
      serviceTables: [],
      equipment: [{
        id: 'eq1', name: 'Toaster', owned: true, level: 2,
        upgradeCosts: [100, 200], purchaseCost: 200,
      }],
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Speed: 110% · Quality: +5%')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('starts service-counter placement without charging immediately', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({
      upgrades: [],
      restaurant: { funds: 500, expansionLevel: 1 },
      serviceTables: [],
      equipment: [],
    });
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel onStartPlacement={startPlacement} />);

    expect(screen.getByRole('button', { name: 'Buy ($300)' })).toBeEnabled();
    screen.getByRole('button', { name: 'Buy ($300)' }).click();

    expect(startPlacement).toHaveBeenCalledWith('serviceTable');
  });

  it('starts oven placement without purchasing equipment immediately', () => {
    const dispatch = vi.fn();
    const startPlacement = vi.fn();
    useGameState.mockReturnValue({
      upgrades: [],
      restaurant: { funds: 500, expansionLevel: 1 },
      serviceTables: [],
      equipment: [{
        id: 'eq2', name: 'Oven', owned: false, level: 1,
        upgradeCosts: [250], purchaseCost: 500,
        speedMultiplier: 1, qualityBonus: 0,
      }],
    });
    useDispatch.mockReturnValue(dispatch);

    render(<UpgradePanel onStartPlacement={startPlacement} />);
    screen.getByRole('button', { name: 'Buy ($500)' }).click();

    expect(startPlacement).toHaveBeenCalledWith({
      itemType: 'equipmentStation', equipmentId: 'eq2',
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'BUY_EQUIPMENT' }));
  });
});
