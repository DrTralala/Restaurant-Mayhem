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

describe('UpgradePanel equipment upgrade preview', () => {
  const baseState = (equipment, funds = 1000) => ({
    upgrades: [],
    restaurant: { funds, expansionLevel: 1 },
    serviceTables: [],
    equipment,
  });

  it('shows canonical next-level preview for owned level 1 equipment', () => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq1', name: 'Toaster', owned: true, level: 1,
      upgradeCosts: [100], purchaseCost: 200, speedMultiplier: 1, qualityBonus: 0,
    }]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Speed: 100% · Quality: +0%')).toBeVisible();
    expect(screen.getByText('After upgrade: Speed 110% · Quality +5%')).toBeVisible();
  });

  it('shows level 9 to 10 next-level preview', () => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq2', name: 'Oven', owned: true, level: 9,
      upgradeCosts: [250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000],
      purchaseCost: 500,
    }], 100000));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Speed: 180% · Quality: +40%')).toBeVisible();
    expect(screen.getByText('After upgrade: Speed 190% · Quality +45%')).toBeVisible();
  });

  it('omits next-level preview for unowned equipment', () => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq3', name: 'Fryer', owned: false, level: 1,
      upgradeCosts: [200], purchaseCost: 400,
    }]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText(/Not owned/)).toBeVisible();
    expect(screen.queryByText(/After upgrade:/)).not.toBeInTheDocument();
  });

  it('omits next-level preview for maxed equipment', () => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq1', name: 'Toaster', owned: true, level: 10,
      upgradeCosts: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600],
      purchaseCost: 200,
    }]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
    expect(screen.queryByText(/After upgrade:/)).not.toBeInTheDocument();
  });

  it('keeps legacy current overrides while previewing canonical next level', () => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq4', name: 'Blender', owned: true, level: 3,
      upgradeCosts: [150, 300, 600], purchaseCost: 300,
      speedMultiplier: 1.5, qualityBonus: 0.2,
    }]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Speed: 150% · Quality: +20%')).toBeVisible();
    expect(screen.getByText('After upgrade: Speed 130% · Quality +15%')).toBeVisible();
  });

  it('keeps the next-level preview visible when the upgrade is unaffordable', () => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq1', name: 'Toaster', owned: true, level: 1,
      upgradeCosts: [100], purchaseCost: 200, speedMultiplier: 1, qualityBonus: 0,
    }], 0));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('After upgrade: Speed 110% · Quality +5%')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upgrade ($100)' })).toBeDisabled();
  });

  it('dispatches the unchanged equipment upgrade action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(baseState([{
      id: 'eq1', name: 'Toaster', owned: true, level: 1,
      upgradeCosts: [100], purchaseCost: 200, speedMultiplier: 1, qualityBonus: 0,
    }]));
    useDispatch.mockReturnValue(dispatch);

    render(<UpgradePanel />);
    screen.getByRole('button', { name: 'Upgrade ($100)' }).click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_EQUIPMENT', id: 'eq1', cost: 100 });
  });

  it.each([
    ['missing', undefined],
    ['NaN', NaN],
    ['fractional', 2.5],
    ['zero', 0],
  ])('suppresses next-level preview and NaN text for owned equipment with %s level', (label, level) => {
    useGameState.mockReturnValue(baseState([{
      id: 'eq5', name: 'Coffee Machine', owned: true, level,
      upgradeCosts: [175, 350, 700], purchaseCost: 350,
    }]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Speed: 100% · Quality: +0%')).toBeVisible();
    expect(screen.queryByText(/After upgrade:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN%/)).not.toBeInTheDocument();
  });
});
