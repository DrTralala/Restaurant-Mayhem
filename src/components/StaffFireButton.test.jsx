import { useLayoutEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffFireButton from './StaffFireButton';

const { mockGameState, mockGameGeneration } = vi.hoisted(() => ({
  mockGameState: { current: null },
  mockGameGeneration: { current: 0 },
}));

vi.mock('../state/GameContext', () => ({
  useGameState: () => mockGameState.current,
  useGameGeneration: () => mockGameGeneration.current,
}));

const worker = {
  id: 'w1', name: 'Sofia', role: 'waiter', morale: 80, salary: 150,
  skill: 3, task: { type: 'take_order' }, x: 120, y: 80,
};

function renderFire({ worker: initial = worker, onConfirm = vi.fn() } = {}) {
  const view = render(
    <StaffFireButton worker={initial} onConfirm={onConfirm}>Fire employee</StaffFireButton>,
  );
  return { ...view, onConfirm };
}

// Clicks the rendered confirmation region during the commit phase, before the
// component's passive invalidation effect has run.
function LayoutPhaseHarness({ worker: current, onConfirm, clickOnLayout = false }) {
  useLayoutEffect(() => {
    if (!clickOnLayout) return;
    const confirm = screen.queryByRole('button', { name: `Confirm fire ${current.name}` });
    confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, [clickOnLayout, current]);

  return <StaffFireButton worker={current} onConfirm={onConfirm}>Fire employee</StaffFireButton>;
}

const openConfirmation = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Fire Sofia' }));
  return screen.getByRole('region', { name: 'Fire Sofia?' });
};

describe('StaffFireButton', () => {
  beforeEach(() => {
    mockGameState.current = null;
    mockGameGeneration.current = 0;
  });

  it('retains the caller text on a trigger that only arms the confirmation', () => {
    const { onConfirm } = renderFire();

    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    expect(trigger).toHaveTextContent('Fire employee');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Fire Sofia?' })).toBeInTheDocument();
  });

  it('shows the exact consequence copy with a humanised role and focuses Cancel', () => {
    renderFire();
    const region = openConfirmation();

    expect(region).toHaveTextContent(
      "Fire Sofia (Waiter)? This removes the employee and releases their assigned work. Hiring again does not restore this employee's training.",
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Confirm fire Sofia' })).not.toHaveFocus();
  });

  it('cancel closes the confirmation, restores trigger focus and dispatches nothing', () => {
    const { onConfirm } = renderFire();
    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    openConfirmation();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Escape cancels once, prevents the default and stops propagation', () => {
    const parentKeyDown = vi.fn();
    const onConfirm = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <StaffFireButton worker={worker} onConfirm={onConfirm}>Fire employee</StaffFireButton>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    openConfirmation();

    const dispatchResult = fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });

    expect(dispatchResult).toBe(false);
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('confirms once, closes the pending region and passes the raw id value', () => {
    const numericWorker = { ...worker, id: 7, name: 'Nico' };
    const onConfirm = vi.fn();
    render(<StaffFireButton worker={numericWorker} onConfirm={onConfirm}>Fire</StaffFireButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Fire Nico' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Nico' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBe(7);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('calls onConfirm exactly once even when confirm is re-entered synchronously', () => {
    const onConfirm = vi.fn();
    renderFire({ onConfirm });
    openConfirmation();
    const confirm = screen.getByRole('button', { name: 'Confirm fire Sofia' });
    onConfirm.mockImplementationOnce(() => { confirm.click(); });

    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('w1');
  });

  it('leaves success focus to the caller instead of pulling it back to the trigger', () => {
    const onConfirm = vi.fn();
    renderFire({ onConfirm });
    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    openConfirmation();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Sofia' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveFocus();
  });

  it('keeps consent across an ordinary tick that replaces the worker object', () => {
    const { rerender, onConfirm } = renderFire();
    openConfirmation();

    const ticked = { ...worker, morale: 42, task: { type: 'clean_table' }, x: 10, y: 20 };
    rerender(<StaffFireButton worker={ticked} onConfirm={onConfirm}>Fire employee</StaffFireButton>);

    expect(screen.getByRole('region', { name: 'Fire Sofia?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Sofia' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('w1');
  });

  it('drops consent when the visible identity changes between renders', () => {
    const { rerender, onConfirm } = renderFire();
    openConfirmation();

    rerender(
      <StaffFireButton worker={{ ...worker, name: 'Anna' }} onConfirm={onConfirm}>Fire employee</StaffFireButton>,
    );

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('drops consent when the game generation changes between renders', () => {
    const { rerender, onConfirm } = renderFire();
    openConfirmation();

    mockGameGeneration.current = 1;
    rerender(<StaffFireButton worker={worker} onConfirm={onConfirm}>Fire employee</StaffFireButton>);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('synchronously rejects a stale confirm when the visible identity changed before the effect ran', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<LayoutPhaseHarness worker={worker} onConfirm={onConfirm} />);
    openConfirmation();

    rerender(<LayoutPhaseHarness worker={{ ...worker, name: 'Anna' }} onConfirm={onConfirm} clickOnLayout />);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    // The stale-rejection path still restores focus to the surviving trigger.
    expect(screen.getByRole('button', { name: 'Fire Anna' })).toHaveFocus();
  });

  it('synchronously rejects a stale confirm when the generation changed before the effect ran', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<LayoutPhaseHarness worker={worker} onConfirm={onConfirm} />);
    openConfirmation();

    mockGameGeneration.current = 1;
    rerender(<LayoutPhaseHarness worker={worker} onConfirm={onConfirm} clickOnLayout />);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('synchronously rejects a stale confirm when a career decision becomes pending', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<LayoutPhaseHarness worker={worker} onConfirm={onConfirm} />);
    openConfirmation();

    mockGameState.current = { careerRun: { needsDecision: true } };
    rerender(<LayoutPhaseHarness worker={worker} onConfirm={onConfirm} clickOnLayout />);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('blocks the trigger and any confirmation while a career decision is pending', () => {
    mockGameState.current = { careerRun: { needsDecision: true } };
    const { onConfirm } = renderFire();

    const trigger = screen.getByRole('button', { name: 'Fire Sofia' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing and never fires when the worker is missing', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <StaffFireButton worker={worker} onConfirm={onConfirm}>Fire employee</StaffFireButton>,
    );
    openConfirmation();

    rerender(<StaffFireButton worker={null} onConfirm={onConfirm}>Fire employee</StaffFireButton>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('discards an open confirmation on unmount without firing', () => {
    const { unmount, onConfirm } = renderFire();
    openConfirmation();

    unmount();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never falls back to window.confirm', () => {
    const browserConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onConfirm } = renderFire();
    openConfirmation();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm fire Sofia' }));

    expect(browserConfirm).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith('w1');
  });
});
