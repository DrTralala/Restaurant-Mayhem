import { render, screen, within } from '@testing-library/react';
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

describe('UpgradePanel equipment upgrade safety', () => {
  const panelState = (equipment, funds = 1000) => ({
    upgrades: [],
    restaurant: { funds, expansionLevel: 1 },
    serviceTables: [],
    equipment,
  });

  const ownedToaster = (overrides = {}) => ({
    id: 'eq1', name: 'Toaster', owned: true, level: 1,
    upgradeCosts: [100], purchaseCost: 200, speedMultiplier: 1, qualityBonus: 0,
    ...overrides,
  });

  it.each([
    ['a fractional level', { level: 1.5, upgradeCosts: [100] }],
    ['a missing cost', { level: 1, upgradeCosts: [] }],
  ])('shows unavailable for owned equipment with %s instead of an Upgrade ($0) button', (_label, overrides) => {
    useGameState.mockReturnValue(panelState([ownedToaster(overrides)]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Upgrade unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Upgrade ($0)' })).not.toBeInTheDocument();
    expect(screen.queryByText(/After upgrade:/)).not.toBeInTheDocument();
  });

  it('treats an above-cap level as unavailable rather than maxed', () => {
    useGameState.mockReturnValue(panelState([ownedToaster({ level: 11 })]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Upgrade unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Max' })).not.toBeInTheDocument();
  });

  it('disables a valid upgrade with nonfinite funds while showing its real terms', () => {
    useGameState.mockReturnValue(panelState([ownedToaster()], Number.NaN));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Level 1 → $100')).toBeVisible();
    expect(screen.getByText('After upgrade: Speed 110% · Quality +5%')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upgrade ($100)' })).toBeDisabled();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText('Upgrade unavailable.')).not.toBeInTheDocument();
  });

  it('recomputes the upgrade quote when funds change on rerender and keeps the action payload', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(panelState([ownedToaster()], 99));
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<UpgradePanel />);
    expect(screen.getByRole('button', { name: 'Upgrade ($100)' })).toBeDisabled();

    useGameState.mockReturnValue(panelState([ownedToaster()], 100));
    rerender(<UpgradePanel />);

    const button = screen.getByRole('button', { name: 'Upgrade ($100)' });
    expect(button).toBeEnabled();
    button.click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_EQUIPMENT', id: 'eq1', cost: 100 });
  });

  it('gates the unowned purchase on finite funds and explains the placement charge', () => {
    const startPlacement = vi.fn();
    useGameState.mockReturnValue(panelState([{
      id: 'eq2', name: 'Oven', owned: false, level: 1,
      upgradeCosts: [250], purchaseCost: 500,
    }], Number.NaN));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel onStartPlacement={startPlacement} />);

    expect(screen.getByText('Place the station to purchase. Charged only after valid placement; cancelling costs nothing.')).toBeVisible();
    const button = screen.getByRole('button', { name: 'Buy ($500)' });
    expect(button).toBeDisabled();
    button.click();
    expect(startPlacement).not.toHaveBeenCalled();
  });

  it('does not fabricate an unowned price when the purchase cost is malformed', () => {
    useGameState.mockReturnValue(panelState([{
      id: 'eq2', name: 'Oven', owned: false, level: 1,
      upgradeCosts: [250], purchaseCost: Number.NaN,
    }]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('UpgradePanel expansion preview', () => {
  const expansionState = (expansionLevel, funds) => ({
    upgrades: [],
    restaurant: { funds, expansionLevel },
    serviceTables: [],
    equipment: [],
  });

  it('shows canonical level 1 copy, affordable funds and dispatches the exact EXPAND action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(expansionState(1, 1000));
    useDispatch.mockReturnValue(dispatch);

    render(<UpgradePanel />);

    expect(screen.getByText('Level 1 / 4')).toBeVisible();
    expect(screen.getByText('Floor: 43 × 31 → 52 × 37 grid tiles.')).toBeVisible();
    expect(screen.getByText('Adds 1 empty kitchen station at no extra cost. Equipment is purchased separately.')).toBeVisible();
    expect(screen.getByText('Station placement is checked on purchase. If no valid space is available, nothing is charged.')).toBeVisible();
    expect(screen.getByText('Funds after purchase: $0.')).toBeVisible();

    const button = screen.getByRole('button', { name: 'Expand ($1000)' });
    expect(button).toBeEnabled();
    button.click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'EXPAND' });
  });

  it.each([
    [1, 1000, '43 × 31 → 52 × 37', 1000],
    [2, 3000, '52 × 37 → 61 × 43', 3000],
    [3, 6000, '61 × 43 → 70 × 49', 6000],
  ])('shows the next-purchase terms for level %i', (level, funds, floorCopy, cost) => {
    useGameState.mockReturnValue(expansionState(level, funds));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText(`Floor: ${floorCopy} grid tiles.`)).toBeVisible();
    expect(screen.getByText('Adds 1 empty kitchen station at no extra cost. Equipment is purchased separately.')).toBeVisible();
    expect(screen.getByText('Station placement is checked on purchase. If no valid space is available, nothing is charged.')).toBeVisible();
    expect(screen.getByText('Funds after purchase: $0.')).toBeVisible();
    expect(screen.getByRole('button', { name: `Expand ($${cost})` })).toBeEnabled();
  });

  it('associates the guidance with the button using a per-panel unique id', () => {
    useGameState.mockReturnValue(expansionState(1, 1000));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);
    render(<UpgradePanel />);

    const buttons = screen.getAllByRole('button', { name: 'Expand ($1000)' });
    expect(buttons).toHaveLength(2);
    const firstId = buttons[0].getAttribute('aria-describedby');
    const secondId = buttons[1].getAttribute('aria-describedby');

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    const description = document.getElementById(firstId);
    expect(description).toHaveTextContent('Floor: 43 × 31 → 52 × 37 grid tiles.');
    expect(description).toHaveTextContent('Adds 1 empty kitchen station at no extra cost. Equipment is purchased separately.');
    expect(description).toHaveTextContent('Station placement is checked on purchase. If no valid space is available, nothing is charged.');
  });

  it('states the shortfall for finite funds below the cost and disables the button', () => {
    useGameState.mockReturnValue(expansionState(1, 999.5));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Needs $1000 in available funds.')).toBeVisible();
    expect(screen.queryByText(/Funds after purchase/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand ($1000)' })).toBeDisabled();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['missing', undefined],
  ])('reports unavailable funds without fabricating a balance for %s funds', (_label, funds) => {
    useGameState.mockReturnValue(expansionState(1, funds));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Funds unavailable.')).toBeVisible();
    expect(screen.queryByText(/Funds after purchase|Needs \$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand ($1000)' })).toBeDisabled();
  });

  it('uses actual subtraction for fractional balances', () => {
    useGameState.mockReturnValue(expansionState(2, 3050.5));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Floor: 52 × 37 → 61 × 43 grid tiles.')).toBeVisible();
    expect(screen.getByText('Funds after purchase: $50.5.')).toBeVisible();
  });

  it('shows the maximum state with a disabled Max button and no next-purchase terms', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(expansionState(4, 20000));
    useDispatch.mockReturnValue(dispatch);

    render(<UpgradePanel />);

    expect(screen.getByText('Level 4 / 4')).toBeVisible();
    expect(screen.getByText('Maximum expansion reached.')).toBeVisible();
    expect(screen.queryByText(/Floor:|empty kitchen station|Funds/)).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Max' });
    expect(button).toBeDisabled();
    button.click();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['fractional', 2.5],
    ['string', '1'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['above maximum', 5],
  ])('shows an unavailable expansion for a %s level', (_label, expansionLevel) => {
    useGameState.mockReturnValue(expansionState(expansionLevel, 20000));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Expansion unavailable.')).toBeVisible();
    expect(screen.queryByText(/Floor:|Funds|Level /)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|undefined/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  });

  it('recomputes the quote when funds change on rerender', () => {
    useGameState.mockReturnValue(expansionState(1, 999));
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<UpgradePanel />);

    expect(screen.getByText('Needs $1000 in available funds.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand ($1000)' })).toBeDisabled();

    useGameState.mockReturnValue(expansionState(1, 1000));
    rerender(<UpgradePanel />);

    expect(screen.getByText('Funds after purchase: $0.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Expand ($1000)' })).toBeEnabled();
  });
});

describe('UpgradePanel global upgrade quotes', () => {
  const panelState = (upgrades, funds = 1000) => ({
    upgrades,
    restaurant: { funds, expansionLevel: 1 },
    serviceTables: [],
    equipment: [],
  });

  const globalUpgrade = (overrides = {}) => ({
    id: 'u3',
    name: 'Faster Oven',
    description: 'All cooking 10% faster',
    level: 0,
    costs: [400, 800],
    ...overrides,
  });

  it('shows the real next cost and dispatches BUY_UPGRADE without a caller price', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(panelState([globalUpgrade()], 1000));
    useDispatch.mockReturnValue(dispatch);

    render(<UpgradePanel />);

    expect(screen.getByText('Level 0 → $400')).toBeVisible();
    expect(screen.queryByText(/After upgrade/)).not.toBeInTheDocument();
    const card = screen.getByText('Faster Oven').closest('div');
    const button = within(card).getByRole('button', { name: 'Buy' });
    expect(button).toBeEnabled();
    expect(within(card).queryByRole('button', { name: /Buy \(\$/ })).not.toBeInTheDocument();
    button.click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'BUY_UPGRADE', id: 'u3' });
  });

  it('shows Max only at the exact cap', () => {
    useGameState.mockReturnValue(panelState([globalUpgrade({ level: 2, costs: [400, 800] })], 0));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Level 2 (Max)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
    expect(screen.queryByText(/→ \$/)).not.toBeInTheDocument();
  });

  it('treats an above-cap level as unavailable rather than maxed', () => {
    useGameState.mockReturnValue(panelState([globalUpgrade({ level: 3, costs: [400, 800] })]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Upgrade unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Max' })).not.toBeInTheDocument();
  });

  it.each([
    ['missing costs', { costs: undefined }],
    ['empty costs', { costs: [] }],
    ['non-array costs', { costs: 'expensive' }],
    ['a negative current cost', { costs: [-100, 200] }],
    ['a NaN current cost', { costs: [Number.NaN] }],
    ['a fractional level', { level: 0.5 }],
    ['a negative level', { level: -1 }],
  ])('shows a disabled Unavailable instead of a fabricated $0 for %s', (_label, overrides) => {
    useGameState.mockReturnValue(panelState([globalUpgrade(overrides)]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Upgrade unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Buy ($300)' })).toBeEnabled();
    const card = screen.getByText('Faster Oven').closest('div');
    expect(within(card).queryByRole('button', { name: /Buy/ })).not.toBeInTheDocument();
    expect(within(card).queryByText(/\$0/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('shows unavailable for a sparse cost array at the current level', () => {
    const sparse = [400];
    sparse[2] = 1600;
    useGameState.mockReturnValue(panelState([globalUpgrade({ level: 1, costs: sparse })]));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Upgrade unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  });

  it('disables a valid upgrade with nonfinite funds while showing its real terms', () => {
    useGameState.mockReturnValue(panelState([globalUpgrade()], Number.NaN));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Level 0 → $400')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText('Upgrade unavailable.')).not.toBeInTheDocument();
  });

  it('enables a genuine zero-cost purchase with zero funds', () => {
    useGameState.mockReturnValue(panelState([globalUpgrade({ costs: [0] })], 0));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    expect(screen.getByText('Level 0 → $0')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Buy' })).toBeEnabled();
  });

  it('treats exact funds as affordable and one cent short as unaffordable', () => {
    useGameState.mockReturnValue(panelState([globalUpgrade()], 400));
    useDispatch.mockReturnValue(vi.fn());

    const { rerender } = render(<UpgradePanel />);
    expect(screen.getByRole('button', { name: 'Buy' })).toBeEnabled();

    useGameState.mockReturnValue(panelState([globalUpgrade()], 399.99));
    rerender(<UpgradePanel />);

    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
  });
});

describe('UpgradePanel cash shortfalls', () => {
  const panelState = ({ upgrades = [], equipment = [], funds }) => ({
    upgrades,
    restaurant: { funds, expansionLevel: 1 },
    serviceTables: [],
    equipment,
  });

  const globalUpgrade = (overrides = {}) => ({
    id: 'u3',
    name: 'Faster Oven',
    description: 'All cooking 10% faster',
    level: 0,
    costs: [400, 800],
    ...overrides,
  });

  const ownedToaster = (overrides = {}) => ({
    id: 'eq1', name: 'Toaster', owned: true, level: 1,
    upgradeCosts: [100], purchaseCost: 200, speedMultiplier: 1, qualityBonus: 0,
    ...overrides,
  });

  const describeButton = (button) => {
    const descriptionId = button.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    return document.getElementById(descriptionId);
  };

  it('links the global shortfall, removes it at exact funds and keeps the Buy action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(panelState({ upgrades: [globalUpgrade()], funds: 399.99 }));
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<UpgradePanel />);

    const button = screen.getByRole('button', { name: 'Buy' });
    expect(button).toBeDisabled();
    expect(describeButton(button)).toHaveTextContent('Needs $0.01 more.');

    useGameState.mockReturnValue(panelState({ upgrades: [globalUpgrade()], funds: 400 }));
    rerender(<UpgradePanel />);

    expect(screen.queryByText(/Needs \$.* more\./)).not.toBeInTheDocument();
    const enabled = screen.getByRole('button', { name: 'Buy' });
    expect(enabled).toBeEnabled();
    expect(enabled).not.toHaveAttribute('aria-describedby');
    enabled.click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'BUY_UPGRADE', id: 'u3' });
  });

  it.each([
    ['negative funds', -5, 'Needs $405 more.'],
    ['fractional funds', 100.5, 'Needs $299.50 more.'],
  ])('formats the global shortfall for %s as an integer or two decimals', (_label, funds, expected) => {
    useGameState.mockReturnValue(panelState({ upgrades: [globalUpgrade()], funds }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const button = screen.getByRole('button', { name: 'Buy' });
    expect(button).toBeDisabled();
    expect(describeButton(button)).toHaveTextContent(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['missing', undefined],
  ])('reports unavailable global funds for %s funds without a fabricated amount', (_label, funds) => {
    useGameState.mockReturnValue(panelState({ upgrades: [globalUpgrade()], funds }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const card = screen.getByText('Faster Oven').closest('div');
    const button = within(card).getByRole('button', { name: 'Buy' });
    expect(button).toBeDisabled();
    expect(describeButton(button)).toHaveTextContent('Funds unavailable.');
    expect(within(card).queryByText(/Needs \$.* more\./)).not.toBeInTheDocument();
    expect(within(card).queryByText(/NaN|undefined/)).not.toBeInTheDocument();
  });

  it.each([
    ['maxed', { level: 2, costs: [400, 800] }],
    ['above cap', { level: 3, costs: [400, 800] }],
    ['invalid cost', { costs: [-100, 200] }],
  ])('shows no misleading shortfall for a %s global upgrade', (_label, overrides) => {
    useGameState.mockReturnValue(panelState({ upgrades: [globalUpgrade(overrides)], funds: 0 }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const card = screen.getByText('Faster Oven').closest('div');
    expect(within(card).queryByText(/Needs \$|Funds unavailable|\$0 more/)).not.toBeInTheDocument();
  });

  it('uses unique useId-derived global shortfall descriptions across two panels', () => {
    useGameState.mockReturnValue(panelState({ upgrades: [globalUpgrade()], funds: 399.99 }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);
    render(<UpgradePanel />);

    const buttons = screen.getAllByRole('button', { name: 'Buy' });
    expect(buttons).toHaveLength(2);
    const descriptionIds = buttons.map(button => button.getAttribute('aria-describedby'));
    expect(new Set(descriptionIds).size).toBe(2);
    descriptionIds.forEach(id => {
      expect(document.getElementById(id)).toHaveTextContent('Needs $0.01 more.');
    });
  });

  it('links the owned equipment shortfall, removes it at exact funds and keeps the upgrade action', () => {
    const dispatch = vi.fn();
    useGameState.mockReturnValue(panelState({ equipment: [ownedToaster()], funds: 99.99 }));
    useDispatch.mockReturnValue(dispatch);

    const { rerender } = render(<UpgradePanel />);

    const button = screen.getByRole('button', { name: 'Upgrade ($100)' });
    expect(button).toBeDisabled();
    expect(describeButton(button)).toHaveTextContent('Needs $0.01 more.');

    useGameState.mockReturnValue(panelState({ equipment: [ownedToaster()], funds: 100 }));
    rerender(<UpgradePanel />);

    expect(screen.queryByText(/Needs \$.* more\./)).not.toBeInTheDocument();
    const enabled = screen.getByRole('button', { name: 'Upgrade ($100)' });
    expect(enabled).toBeEnabled();
    expect(enabled).not.toHaveAttribute('aria-describedby');
    enabled.click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'UPGRADE_EQUIPMENT', id: 'eq1', cost: 100 });
  });

  it.each([
    ['negative funds', -5, 'Needs $105 more.'],
    ['fractional funds', 99.5, 'Needs $0.50 more.'],
  ])('formats the equipment shortfall for %s as an integer or two decimals', (_label, funds, expected) => {
    useGameState.mockReturnValue(panelState({ equipment: [ownedToaster()], funds }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const card = screen.getByText('Toaster').closest('div');
    const button = within(card).getByRole('button', { name: 'Upgrade ($100)' });
    expect(button).toBeDisabled();
    expect(describeButton(button)).toHaveTextContent(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('reports unavailable equipment funds for %s funds without a fabricated amount', (_label, funds) => {
    useGameState.mockReturnValue(panelState({ equipment: [ownedToaster()], funds }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const card = screen.getByText('Toaster').closest('div');
    const button = within(card).getByRole('button', { name: 'Upgrade ($100)' });
    expect(button).toBeDisabled();
    expect(describeButton(button)).toHaveTextContent('Funds unavailable.');
    expect(within(card).queryByText(/Needs \$.* more\./)).not.toBeInTheDocument();
    expect(within(card).queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it.each([
    ['maxed', { level: 10 }],
    ['fractional level', { level: 1.5 }],
    ['missing cost', { upgradeCosts: [] }],
  ])('shows no misleading shortfall for %s owned equipment', (_label, overrides) => {
    useGameState.mockReturnValue(panelState({ equipment: [ownedToaster(overrides)], funds: 0 }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const card = screen.getByText('Toaster').closest('div');
    expect(within(card).queryByText(/Needs \$|Funds unavailable|\$0 more/)).not.toBeInTheDocument();
  });

  it('uses unique useId-derived equipment shortfall descriptions across two panels', () => {
    useGameState.mockReturnValue(panelState({ equipment: [ownedToaster()], funds: 99.99 }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);
    render(<UpgradePanel />);

    const buttons = screen.getAllByRole('button', { name: 'Upgrade ($100)' });
    expect(buttons).toHaveLength(2);
    const descriptionIds = buttons.map(button => button.getAttribute('aria-describedby'));
    expect(new Set(descriptionIds).size).toBe(2);
    descriptionIds.forEach(id => {
      expect(document.getElementById(id)).toHaveTextContent('Needs $0.01 more.');
    });
  });

  it('leaves unowned equipment purchase guidance unchanged below its price', () => {
    useGameState.mockReturnValue(panelState({
      equipment: [{
        id: 'eq2', name: 'Oven', owned: false, level: 1,
        upgradeCosts: [250], purchaseCost: 500,
      }],
      funds: 0,
    }));
    useDispatch.mockReturnValue(vi.fn());

    render(<UpgradePanel />);

    const card = screen.getByText('Oven').closest('div');
    expect(within(card).getByRole('button', { name: 'Buy ($500)' })).toBeDisabled();
    expect(within(card).queryByText(/Needs \$|Funds unavailable|\$0 more/)).not.toBeInTheDocument();
  });
});
