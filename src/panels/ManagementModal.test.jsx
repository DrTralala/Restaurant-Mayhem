import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagementModal from './ManagementModal';
import SpeedControls from '../components/SpeedControls';

const { dispatch, gameState } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  gameState: { current: { paused: false, speed: 1 } },
}));
vi.mock('../state/GameContext', () => ({
  useGameState: () => gameState.current,
  useDispatch: () => dispatch,
}));

vi.mock('./MenuPanel', () => ({ default: () => <div>Menu panel</div> }));
vi.mock('./UpgradePanel', () => ({ default: () => <div>Upgrade panel</div> }));
vi.mock('./ItemsPanel', () => ({
  default: ({ onStartPlacement }) => (
    <>
      <button onClick={() => onStartPlacement('cashierTable')}>Items panel</button>
      <button onClick={() => onStartPlacement('automaticDishwasher')}>Buy automaticDishwasher ($600)</button>
    </>
  ),
}));
vi.mock('./StaffPanel', () => ({ default: ({ onLocateStaff, locateDisabled, locateMessage }) => (
  <div>
    <div>Staff panel</div>
    <button onClick={() => onLocateStaff?.('s1')} disabled={locateDisabled}>Locate staff</button>
    {locateMessage && <output>{locateMessage}</output>}
  </div>
) }));
vi.mock('./MilestonePanel', () => ({ default: () => <div>Milestone panel</div> }));
vi.mock('./StatsPanel', () => ({ default: () => <div>Stats panel</div> }));
vi.mock('./HoursPanel', () => ({ default: () => <div>Hours panel</div> }));
vi.mock('./ServiceContractsPanel', () => ({ default: () => <div>Contracts panel</div> }));
vi.mock('./CareerPanel', () => ({ default: () => <div>Career panel</div> }));

const SECTION_LABELS = ['Upgrades', 'Items', 'Staff', 'Milestones', 'Stats', 'Hours', 'Contracts', 'Opening Week'];

function pressedSectionLabels() {
  return SECTION_LABELS.filter(label => (
    screen.getByRole('button', { name: label }).getAttribute('aria-pressed') === 'true'
  ));
}

function ManagementHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open management</button>
      <ManagementModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe('ManagementModal', () => {
  beforeEach(() => {
    dispatch.mockClear();
    gameState.current = { paused: false, speed: 1 };
  });

  it('opens on Upgrades without a Menu tab', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
    expect(screen.getByText('Upgrade panel')).toBeInTheDocument();
  });

  it('opens physical furniture in a separate Items tab', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Items' }));

    expect(screen.getByText('Items panel')).toBeInTheDocument();
  });

  it('forwards the placement callback to the items panel', () => {
    const startPlacement = vi.fn();
    render(<ManagementModal isOpen onClose={vi.fn()} onStartPlacement={startPlacement} />);

    fireEvent.click(screen.getByRole('button', { name: 'Items' }));
    fireEvent.click(screen.getByRole('button', { name: 'Items panel' }));

    expect(startPlacement).toHaveBeenCalledWith('cashierTable');
  });

  it('opens operating hours in a dedicated Hours tab', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hours' }));

    expect(screen.getByText('Hours panel')).toBeInTheDocument();
  });

  it('marks exactly one section pressed initially and after each section', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    expect(pressedSectionLabels()).toEqual(['Upgrades']);

    for (const label of SECTION_LABELS.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(pressedSectionLabels()).toEqual([label]);
      expect(SECTION_LABELS.filter(section => section !== label).every(section => (
        screen.getByRole('button', { name: section }).getAttribute('aria-pressed') === 'false'
      ))).toBe(true);
    }

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves pause and close unpressed and preserves the selected section on rerender', () => {
    const onClose = vi.fn();
    const view = render(<ManagementModal isOpen onClose={onClose} />);

    expect(screen.getByRole('button', { name: 'Pause game' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'Close management' })).not.toHaveAttribute('aria-pressed');

    fireEvent.click(screen.getByRole('button', { name: 'Hours' }));
    expect(pressedSectionLabels()).toEqual(['Hours']);

    view.rerender(<ManagementModal isOpen onClose={onClose} />);

    expect(pressedSectionLabels()).toEqual(['Hours']);
    expect(screen.getByText('Hours panel')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('never toggles pause when opening, closing or switching tabs', () => {
    const onClose = vi.fn();
    const view = render(<ManagementModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Items' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close management' }));

    view.rerender(<ManagementModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Pause game' })).not.toBeInTheDocument();

    view.rerender(<ManagementModal isOpen onClose={onClose} />);

    expect(onClose).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reads the paused flag for its visible pause label and toggles once on click', () => {
    const view = render(<ManagementModal isOpen onClose={vi.fn()} />);
    const pause = screen.getByRole('button', { name: 'Pause game' });

    expect(pause).not.toHaveAttribute('aria-pressed');

    fireEvent.click(pause);
    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);

    gameState.current = { paused: true, speed: 1 };
    view.rerender(<ManagementModal isOpen onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Pause game' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume game' })).toBeInTheDocument();
  });

  it('disables the management pause action while a career decision is pending', () => {
    gameState.current = { paused: false, speed: 1, careerRun: { needsDecision: true } };
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Pause game' })).toBeDisabled();
  });

  it('does not double-toggle when Space activates the focused management pause button', () => {
    render(<SpeedControls />);
    const modal = render(<ManagementModal isOpen onClose={vi.fn()} />);
    const pause = within(modal.container).getByRole('button', { name: 'Pause game' });
    pause.focus();
    expect(pause).toHaveFocus();

    fireEvent.keyDown(pause, { key: ' ', code: 'Space' });
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(pause);
    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);
  });

  it('forwards locate requests from the staff panel', () => {
    const onLocateStaff = vi.fn();
    render(<ManagementModal isOpen onClose={vi.fn()} initialTab="staff" onLocateStaff={onLocateStaff} />);

    fireEvent.click(screen.getByRole('button', { name: 'Locate staff' }));

    expect(onLocateStaff).toHaveBeenCalledWith('s1');
  });

  it('exposes a named modal dialog and focuses the named close control on entry', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Restaurant management' });
    const close = screen.getByRole('button', { name: 'Close management' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(close).toHaveTextContent('✕');
    expect(close).toHaveFocus();
  });

  it('restores the opener after an unconsumed Escape and re-enters on reopen', () => {
    render(<ManagementHarness />);
    const opener = screen.getByRole('button', { name: 'Open management' });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole('button', { name: 'Close management' })).toHaveFocus();
    const result = fireEvent.keyDown(document, { key: 'Escape' });

    expect(result).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Restaurant management' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close management' })).toHaveFocus();
  });

  it('closes once on repeated unconsumed Escape presses', () => {
    const onClose = vi.fn();
    render(<ManagementModal isOpen onClose={onClose} />);
    const close = screen.getByRole('button', { name: 'Close management' });

    fireEvent.keyDown(close, { key: 'Escape' });
    fireEvent.keyDown(close, { key: 'Escape' });
    fireEvent.keyDown(close, { key: 'Escape', repeat: true });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('contains Tab within the current management controls in both directions', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);
    const first = screen.getByRole('button', { name: 'Upgrades' });
    const close = screen.getByRole('button', { name: 'Close management' });

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  it('recalculates tab order when switching to a tab with dynamic controls', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);
    const first = screen.getByRole('button', { name: 'Upgrades' });

    fireEvent.click(screen.getByRole('button', { name: 'Items' }));
    const last = screen.getByRole('button', { name: 'Buy automaticDishwasher ($600)' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('forwards the placement block state and message to the staff panel', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} initialTab="staff"
      onLocateStaff={vi.fn()} locateDisabled locateMessage="Finish or cancel placement before locating staff." />);

    expect(screen.getByRole('button', { name: 'Locate staff' })).toBeDisabled();
    expect(screen.getByText('Finish or cancel placement before locating staff.')).toBeInTheDocument();
  });
});
