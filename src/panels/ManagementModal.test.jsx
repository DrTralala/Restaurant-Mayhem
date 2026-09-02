import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ManagementModal from './ManagementModal';

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
vi.mock('./StaffPanel', () => ({ default: () => <div>Staff panel</div> }));
vi.mock('./MilestonePanel', () => ({ default: () => <div>Milestone panel</div> }));
vi.mock('./StatsPanel', () => ({ default: () => <div>Stats panel</div> }));
vi.mock('./HoursPanel', () => ({ default: () => <div>Hours panel</div> }));

describe('ManagementModal', () => {
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
});
