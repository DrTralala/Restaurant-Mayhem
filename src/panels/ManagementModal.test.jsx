import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ManagementModal from './ManagementModal';

vi.mock('./MenuPanel', () => ({ default: () => <div>Menu panel</div> }));
vi.mock('./UpgradePanel', () => ({ default: () => <div>Upgrade panel</div> }));
vi.mock('./ItemsPanel', () => ({ default: () => <div>Items panel</div> }));
vi.mock('./StaffPanel', () => ({ default: () => <div>Staff panel</div> }));
vi.mock('./MilestonePanel', () => ({ default: () => <div>Milestone panel</div> }));
vi.mock('./StatsPanel', () => ({ default: () => <div>Stats panel</div> }));

describe('ManagementModal', () => {
  it('opens physical furniture in a separate Items tab', () => {
    render(<ManagementModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Items' }));

    expect(screen.getByText('Items panel')).toBeInTheDocument();
  });
});
