import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StaffScheduleEditor from './StaffScheduleEditor';

const allWork = () => Array.from({ length: 48 }, () => 'work');
const worker = { id: 's1', name: 'Marco' };

function ScheduleHarness({ initialSchedule = allWork(), onApply = vi.fn(), onCancel = vi.fn() }) {
  const [schedule, setSchedule] = useState(initialSchedule);
  return (
    <StaffScheduleEditor
      staff={worker}
      schedule={schedule}
      onChange={setSchedule}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

describe('StaffScheduleEditor', () => {
  it('renders exactly 48 semantic half-hour controls with a midnight-spanning label', () => {
    render(<ScheduleHarness />);

    expect(screen.getAllByRole('combobox')).toHaveLength(48);
    expect(screen.getByRole('combobox', { name: '00:00 to 00:30' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '23:30 to 00:00' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '23:30 to 00:00' })).toHaveAttribute(
      'aria-label',
      '23:30 to 00:00',
    );
  });

  it('applies an all-work schedule explicitly', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(allWork());
  });

  it('rejects a short PTO draft with an inline human-readable reason', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);

    fireEvent.change(screen.getByRole('combobox', { name: '00:00 to 00:30' }), {
      target: { value: 'pto' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/14 half-hour slots|7 in-game hours/i);
  });

  it('accepts a PTO run that crosses midnight when it has 14 slots', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);
    const midnightRun = [44, 45, 46, 47, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    for (const index of midnightRun) {
      const hour = String(Math.floor(index / 2)).padStart(2, '0');
      const minute = index % 2 === 0 ? '00' : '30';
      const endHour = String((Number(hour) + (index % 2 === 0 ? 0 : 1)) % 24).padStart(2, '0');
      fireEvent.change(screen.getByRole('combobox', { name: `${hour}:${minute} to ${endHour}:${index % 2 === 0 ? '30' : '00'}` }), {
        target: { value: 'pto' },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].slice(44).concat(onApply.mock.calls[0][0].slice(0, 10)))
      .toEqual(Array.from({ length: 14 }, () => 'pto'));
  });

  it('forwards Cancel without applying the draft', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<ScheduleHarness onApply={onApply} onCancel={onCancel} />);

    fireEvent.change(screen.getByRole('combobox', { name: '23:30 to 00:00' }), {
      target: { value: 'rest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
