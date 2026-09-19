import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StaffScheduleEditor from './StaffScheduleEditor';

const allWork = () => Array.from({ length: 48 }, () => 'work');
const worker = { id: 's1', name: 'Marco' };

function ScheduleHarness({
  initialSchedule = allWork(),
  staff = worker,
  staffList = [],
  onApply = vi.fn(),
  onCancel = vi.fn(),
}) {
  const [schedule, setSchedule] = useState(initialSchedule);
  return (
    <StaffScheduleEditor
      staff={staff}
      staffList={staffList}
      schedule={schedule}
      onChange={setSchedule}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

describe('StaffScheduleEditor', () => {
  it('renders labelled range controls, a duty legend, and a midnight-labelled 24-hour summary', () => {
    render(<ScheduleHarness />);

    expect(screen.getByRole('combobox', { name: 'Duty' })).toHaveValue('work');
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('0');
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('16');
    expect(screen.getByRole('group', { name: 'Duty legend' })).toHaveTextContent(/Work.*Rest.*PTO/);
    expect(screen.getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Work:\s*24 hours/);
    expect(screen.getByRole('list', { name: 'Schedule periods' })).toHaveTextContent('00:00 to 24:00 (midnight)');
  });

  it('applies a selected non-wrapping range without changing other slots', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const expected = allWork();
    expected.splice(4, 4, 'rest', 'rest', 'rest', 'rest');
    expect(onApply).toHaveBeenCalledWith(expected);
  });

  it('applies an overnight PTO range cyclically', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'pto' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '44' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }));

    const periods = screen.getByRole('list', { name: 'Schedule periods' });
    expect(within(periods).getAllByText(/PTO/)).toHaveLength(1);
    expect(periods).toHaveTextContent(/22:00 to 05:00 \(overnight\).*PTO.*7 hours/);

    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply.mock.calls[0][0].slice(44).concat(onApply.mock.calls[0][0].slice(0, 10)))
      .toEqual(Array(14).fill('pto'));
  });

  it('keeps a short PTO range from applying and shows the authoritative validation reason', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'pto' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/14 half-hour slots|7 in-game hours/i);
  });

  it('rejects equal range endpoints and advises using All day', () => {
    render(<ScheduleHarness />);

    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/different times.*All day/i);
  });

  it('fills every slot with the selected duty when All day is clicked', () => {
    const onApply = vi.fn();
    render(<ScheduleHarness onApply={onApply} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).toHaveBeenCalledWith(Array(48).fill('rest'));
  });

  it('copies another employee schedule into the draft without applying or mutating the source', () => {
    const sourceSchedule = allWork();
    sourceSchedule[0] = 'rest';
    sourceSchedule[1] = 'rest';
    const staffList = [worker, { id: 's2', name: 'Anna', schedule: sourceSchedule }];
    const onApply = vi.fn();
    render(<ScheduleHarness staffList={staffList} onApply={onApply} />);

    const copyButton = screen.getByRole('button', { name: 'Copy schedule' });
    expect(copyButton).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Copy from' }), { target: { value: 's2' } });
    expect(copyButton).toBeEnabled();
    fireEvent.click(copyButton);

    expect(screen.getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*1 hour/);
    expect(sourceSchedule).toEqual(['rest', 'rest', ...Array(46).fill('work')]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('uses a staff schedule for an uncontrolled draft when no schedule prop is passed', () => {
    const sourceSchedule = allWork();
    sourceSchedule[3] = 'rest';
    const onApply = vi.fn();
    render(
      <StaffScheduleEditor
        staff={{ ...worker, schedule: sourceSchedule }}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).toHaveBeenCalledWith(sourceSchedule);
  });

  it('forwards Cancel without applying the draft', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<ScheduleHarness onApply={onApply} onCancel={onCancel} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
