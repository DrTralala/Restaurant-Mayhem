import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StaffScheduleEditor, { getTeamCoveragePeriods } from './StaffScheduleEditor';

const allWork = () => Array.from({ length: 48 }, () => 'work');
const worker = { id: 's1', name: 'Marco' };

function ScheduleHarness({
  initialSchedule = allWork(),
  staff = worker,
  staffList = [],
  openHour,
  closeHour,
  onApply = vi.fn(),
  onCancel = vi.fn(),
}) {
  const [schedule, setSchedule] = useState(initialSchedule);
  return (
    <StaffScheduleEditor
      staff={staff}
      staffList={staffList}
      schedule={schedule}
      openHour={openHour}
      closeHour={closeHour}
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

  it('labels colliding same-name teammates distinctly and copies each saved schedule', () => {
    const sourceA = Object.freeze(['rest', 'rest', ...Array(46).fill('work')]);
    const sourceB = Object.freeze(Array(48).fill('rest'));
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const alexA = { id: 's2', name: 'Alex', role: 'waiter', schedule: sourceA };
    const alexB = { id: 's3', name: 'Alex', role: 'waiter', schedule: sourceB };
    const anna = { id: 's4', name: 'Anna', role: 'waiter', schedule: allWork() };
    const onApply = vi.fn();
    render(<ScheduleHarness staff={cook} staffList={[cook, alexA, alexB, anna]} onApply={onApply} />);

    const select = screen.getByRole('combobox', { name: 'Copy from' });
    const options = within(select).getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([
      'Choose a staff member',
      'Alex (waiter, ID s2)',
      'Alex (waiter, ID s3)',
      'Anna',
    ]);
    expect(options.slice(1).map(option => option.value)).toEqual(['s2', 's3', 's4']);

    fireEvent.change(select, { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy schedule' }));
    expect(screen.getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*1 hour/);

    fireEvent.change(select, { target: { value: 's3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy schedule' }));
    expect(screen.getByRole('list', { name: 'Schedule totals' })).toHaveTextContent(/Rest:\s*24 hours/);

    expect(onApply).not.toHaveBeenCalled();
    expect(sourceA).toEqual(['rest', 'rest', ...Array(46).fill('work')]);
    expect(sourceB).toEqual(Array(48).fill('rest'));
  });

  it('distinguishes a name/id fallback collision with role and ID suffixes', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const nameless = { id: 'shared', schedule: allWork() };
    const named = { id: 's9', name: 'shared', role: 'waiter', schedule: allWork() };
    render(<ScheduleHarness staff={cook} staffList={[cook, nameless, named]} />);

    expect(within(screen.getByRole('combobox', { name: 'Copy from' }))
      .getAllByRole('option').map(option => option.textContent)).toEqual([
      'Choose a staff member',
      'shared (staff, ID shared)',
      'shared (waiter, ID s9)',
    ]);
  });

  it('removes collision suffixes when a rerender makes the label unique', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const alexA = { id: 's2', name: 'Alex', role: 'waiter', schedule: allWork() };
    const alexB = { id: 's3', name: 'Alex', role: 'waiter', schedule: allWork() };
    const { rerender } = render(<ScheduleHarness staff={cook} staffList={[cook, alexA, alexB]} />);

    const labels = () => within(screen.getByRole('combobox', { name: 'Copy from' }))
      .getAllByRole('option').map(option => option.textContent);
    expect(labels()).toEqual([
      'Choose a staff member',
      'Alex (waiter, ID s2)',
      'Alex (waiter, ID s3)',
    ]);

    rerender(<ScheduleHarness staff={cook} staffList={[cook, alexA, { ...alexB, name: 'Jordan' }]} />);

    expect(labels()).toEqual([
      'Choose a staff member',
      'Alex',
      'Jordan',
    ]);
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

  it('shows named coverage rows with open markers, counts and a midnight endpoint', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    render(<ScheduleHarness staff={cook} staffList={[cook, waiter]} openHour={8.5} closeHour={9} />);

    const preview = screen.getByRole('list', { name: 'Team coverage preview' });

    expect(within(preview).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '00:00 to 08:30 · Closed · Cooks 1, Waiters 1, Janitors 0',
      '08:30 to 09:00 · Open · Cooks 1, Waiters 1, Janitors 0',
      '09:00 to 24:00 (midnight) · Closed · Cooks 1, Waiters 1, Janitors 0',
    ]);
  });

  it('updates coverage counts from the draft before Apply', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const onApply = vi.fn();
    render(<ScheduleHarness staff={cook} staffList={[cook, waiter]} onApply={onApply} />);

    const preview = () => screen.getByRole('list', { name: 'Team coverage preview' });
    expect(preview()).toHaveTextContent(/Cooks 1.*Waiters 1.*Janitors 0/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));
    expect(preview()).toHaveTextContent(/Cooks 0.*Waiters 1.*Janitors 0/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'pto' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '44' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }));
    expect(preview()).toHaveTextContent(/Cooks 0.*Waiters 1.*Janitors 0/);

    expect(onApply).not.toHaveBeenCalled();
  });

  it('refreshes coverage when a saved teammate schedule is copied', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const restingWaiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: Array(48).fill('rest') };
    render(<ScheduleHarness staff={cook} staffList={[cook, restingWaiter]} />);

    const preview = () => screen.getByRole('list', { name: 'Team coverage preview' });
    expect(preview()).toHaveTextContent(/Cooks 1, Waiters 0/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Copy from' }), { target: { value: 'w1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy schedule' }));

    expect(preview()).toHaveTextContent(/Cooks 0, Waiters 0/);
  });

  it('keeps short PTO counts visible and notes the cannot-apply reason without applying', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const onApply = vi.fn();
    render(<ScheduleHarness staff={cook} staffList={[cook, waiter]} onApply={onApply} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'pto' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }));

    const preview = screen.getByRole('list', { name: 'Team coverage preview' });
    expect(preview).toHaveTextContent('00:00 to 01:00 · Open · Cooks 0, Waiters 1, Janitors 0');
    expect(preview).toHaveTextContent('01:00 to 24:00 (midnight) · Open · Cooks 1, Waiters 1, Janitors 0');
    expect(screen.getByText(/^Cannot apply this draft:/)).toHaveTextContent(
      'Cannot apply this draft: Every PTO run must last at least 7 in-game hours (14 half-hour slots), including across midnight.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/14 half-hour slots|7 in-game hours/i);
  });

  it('adds per-period Other counts only while an unknown-role worker is scheduled', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const manager = {
      id: 'm1', name: 'Ghost', role: 'manager',
      schedule: ['work', ...Array(47).fill('rest')],
    };
    const { rerender } = render(<ScheduleHarness staff={cook} staffList={[cook]} />);

    const preview = () => screen.getByRole('list', { name: 'Team coverage preview' });
    expect(preview()).not.toHaveTextContent(/Other/);

    rerender(<ScheduleHarness staff={cook} staffList={[cook, manager]} />);

    expect(within(preview()).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '00:00 to 00:30 · Open · Cooks 1, Waiters 0, Janitors 0, Other 1',
      '00:30 to 24:00 (midnight) · Open · Cooks 1, Waiters 0, Janitors 0, Other 0',
    ]);
  });

  it('lists only open zero-role periods as open-hours schedule gaps', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    render(<ScheduleHarness staff={cook} staffList={[cook]} openHour={8.5} closeHour={9} />);

    expect(screen.getByRole('heading', { name: 'Open-hours schedule gaps' })).toBeInTheDocument();
    const gaps = screen.getByRole('list', { name: 'Open-hours schedule gaps' });
    expect(within(gaps).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '08:30 to 09:00 · No waiters scheduled to Work.',
    ]);
    expect(screen.getByRole('button', { name: 'Apply schedule' })).toBeEnabled();
  });

  it('formats overnight and all-day gap ranges with boundary times', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: Array(48).fill('rest') };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: Array(48).fill('rest') };
    const { rerender } = render(
      <ScheduleHarness
        initialSchedule={Array(48).fill('rest')}
        staff={cook}
        staffList={[cook, waiter]}
        openHour={22}
        closeHour={2}
      />,
    );

    const gapRows = () => within(screen.getByRole('list', { name: 'Open-hours schedule gaps' }))
      .getAllByRole('listitem').map(item => item.textContent);

    expect(gapRows()).toEqual([
      '00:00 to 02:00 · No cooks scheduled to Work. No waiters scheduled to Work.',
      '22:00 to 24:00 (midnight) · No cooks scheduled to Work. No waiters scheduled to Work.',
    ]);

    rerender(
      <ScheduleHarness
        initialSchedule={Array(48).fill('rest')}
        staff={cook}
        staffList={[cook, waiter]}
        openHour={0}
        closeHour={0}
      />,
    );

    expect(gapRows()).toEqual([
      '00:00 to 24:00 (midnight) · No cooks scheduled to Work. No waiters scheduled to Work.',
    ]);
  });

  it('updates open-hours gaps from the draft and clears them when both roles are staffed', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const onApply = vi.fn();
    render(
      <ScheduleHarness
        initialSchedule={Array(48).fill('rest')}
        staff={cook}
        staffList={[cook, waiter]}
        openHour={0}
        closeHour={0}
        onApply={onApply}
      />,
    );

    expect(within(screen.getByRole('list', { name: 'Open-hours schedule gaps' }))
      .getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '00:00 to 24:00 (midnight) · No cooks scheduled to Work.',
    ]);
    expect(screen.getByRole('list', { name: 'Team coverage preview' })).toHaveTextContent('Cooks 0, Waiters 1');

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'work' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));

    expect(screen.getByText('No zero-cook or zero-waiter gaps in this preview.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Open-hours schedule gaps' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Team coverage preview' })).toHaveTextContent('Cooks 1, Waiters 1');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('reports the specific missing role for each gap', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const { rerender } = render(
      <ScheduleHarness staff={cook} staffList={[cook]} openHour={0} closeHour={0} />,
    );

    const gapRows = () => within(screen.getByRole('list', { name: 'Open-hours schedule gaps' }))
      .getAllByRole('listitem').map(item => item.textContent);

    expect(gapRows()).toEqual([
      '00:00 to 24:00 (midnight) · No waiters scheduled to Work.',
    ]);

    rerender(<ScheduleHarness staff={waiter} staffList={[waiter]} openHour={0} closeHour={0} />);

    expect(gapRows()).toEqual([
      '00:00 to 24:00 (midnight) · No cooks scheduled to Work.',
    ]);
  });

  it('shows the no-gaps copy and exact advisory context when both roles are staffed', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    render(<ScheduleHarness staff={cook} staffList={[cook, waiter]} openHour={8.5} closeHour={9} />);

    expect(screen.getByText('No zero-cook or zero-waiter gaps in this preview.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Open-hours schedule gaps' })).not.toBeInTheDocument();
    expect(screen.getByText(
      'Based on this draft and saved team schedules. Nonzero counts do not guarantee enough staff or actual availability.',
    )).toBeInTheDocument();
  });

  it('keeps existing coverage rows unchanged and accepts deeply frozen sources', () => {
    const cookSchedule = Object.freeze(Array(48).fill('work'));
    const waiterSchedule = Object.freeze(Array(48).fill('rest'));
    const cook = Object.freeze({ id: 'c1', name: 'Marco', role: 'cook', schedule: cookSchedule });
    const waiter = Object.freeze({ id: 'w1', name: 'Anna', role: 'waiter', schedule: waiterSchedule });
    const staffList = Object.freeze([cook, waiter]);
    render(<ScheduleHarness staff={cook} staffList={staffList} openHour={8.5} closeHour={9} />);

    expect(within(screen.getByRole('list', { name: 'Team coverage preview' }))
      .getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '00:00 to 08:30 · Closed · Cooks 1, Waiters 0, Janitors 0',
      '08:30 to 09:00 · Open · Cooks 1, Waiters 0, Janitors 0',
      '09:00 to 24:00 (midnight) · Closed · Cooks 1, Waiters 0, Janitors 0',
    ]);
    expect(within(screen.getByRole('list', { name: 'Open-hours schedule gaps' }))
      .getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '08:30 to 09:00 · No waiters scheduled to Work.',
    ]);
    expect(cookSchedule).toEqual(Array(48).fill('work'));
    expect(waiterSchedule).toEqual(Array(48).fill('rest'));
    expect(Object.isFrozen(cookSchedule)).toBe(true);
    expect(Object.isFrozen(waiterSchedule)).toBe(true);
    expect(Object.isFrozen(staffList)).toBe(true);
  });
});

describe('janitor coverage observation', () => {
  const observationCopy = 'A schedule observation, not a staffing requirement. Scheduled Work does not guarantee availability.';
  const rowCopy = 'No janitors scheduled to Work in this period.';

  function janitorObservation() {
    const heading = screen.getByRole('heading', { name: 'Janitor schedule coverage' });
    const section = heading.parentElement;
    const list = within(section).getByRole('list', { name: 'Periods without scheduled janitors' });
    return { heading, section, list };
  }

  function observationRows() {
    return within(janitorObservation().list).getAllByRole('listitem').map(item => item.textContent);
  }

  it('lists only open periods without janitors in a separate neutral section after the cook and waiter gaps', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    render(<ScheduleHarness staff={cook} staffList={[cook, waiter]} openHour={8.5} closeHour={9} />);

    const gapsHeading = screen.getByRole('heading', { name: 'Open-hours schedule gaps' });
    const { heading, section, list } = janitorObservation();

    expect(gapsHeading.parentElement.contains(heading)).toBe(false);
    expect(gapsHeading.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(observationRows()).toEqual([`08:30 to 09:00 · ${rowCopy}`]);
    expect(within(section).getByText(observationCopy)).toBeInTheDocument();
    expect(section).toHaveStyle({ background: '#0d1528', border: '1px solid #223d62' });
    expect(within(section).getByText(observationCopy)).toHaveStyle({ color: '#9da9bd' });
    expect(list).toHaveStyle({ color: '#c9d7ec' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveStyle({ overflowWrap: 'anywhere' });
    expect(section.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('formats overnight and all-day observation ranges with boundary times', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const { rerender } = render(
      <ScheduleHarness staff={cook} staffList={[cook, waiter]} openHour={22} closeHour={2} />,
    );

    expect(observationRows()).toEqual([
      `00:00 to 02:00 · ${rowCopy}`,
      `22:00 to 24:00 (midnight) · ${rowCopy}`,
    ]);

    rerender(<ScheduleHarness staff={cook} staffList={[cook, waiter]} openHour={0} closeHour={0} />);

    expect(observationRows()).toEqual([`00:00 to 24:00 (midnight) · ${rowCopy}`]);
  });

  it('adds and removes the observation as the current draft janitor changes', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const janitor = { id: 'j1', name: 'Sam', role: 'janitor', schedule: allWork() };
    render(<ScheduleHarness staff={janitor} staffList={[cook, waiter, janitor]} openHour={0} closeHour={0} />);

    expect(screen.queryByRole('heading', { name: 'Janitor schedule coverage' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));

    expect(observationRows()).toEqual([`00:00 to 24:00 (midnight) · ${rowCopy}`]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'work' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));

    expect(screen.queryByRole('heading', { name: 'Janitor schedule coverage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Periods without scheduled janitors' })).not.toBeInTheDocument();
    expect(screen.queryByText(observationCopy)).not.toBeInTheDocument();
  });

  it('uses saved teammate janitor coverage and ignores the current draft when another role is edited', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const waiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: allWork() };
    const workingJanitor = { id: 'j1', name: 'Sam', role: 'janitor', schedule: allWork() };
    const { rerender } = render(
      <ScheduleHarness staff={cook} staffList={[cook, waiter, workingJanitor]} openHour={0} closeHour={0} />,
    );

    expect(screen.queryByRole('heading', { name: 'Janitor schedule coverage' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Duty' }), { target: { value: 'rest' } });
    fireEvent.click(screen.getByRole('button', { name: 'All day' }));

    expect(screen.queryByRole('heading', { name: 'Janitor schedule coverage' })).not.toBeInTheDocument();

    const restingJanitor = { ...workingJanitor, schedule: Array(48).fill('rest') };
    rerender(
      <ScheduleHarness staff={cook} staffList={[cook, waiter, restingJanitor]} openHour={0} closeHour={0} />,
    );

    expect(observationRows()).toEqual([`00:00 to 24:00 (midnight) · ${rowCopy}`]);
  });

  it('keeps coverage counts, cook and waiter gaps, advisory copy and Apply unchanged when janitors are zero', () => {
    const cook = { id: 'c1', name: 'Marco', role: 'cook', schedule: allWork() };
    const restingWaiter = { id: 'w1', name: 'Anna', role: 'waiter', schedule: Array(48).fill('rest') };
    const onApply = vi.fn();
    render(
      <ScheduleHarness
        staff={cook}
        staffList={[cook, restingWaiter]}
        openHour={0}
        closeHour={0}
        onApply={onApply}
      />,
    );

    const preview = screen.getByRole('list', { name: 'Team coverage preview' });
    expect(within(preview).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '00:00 to 24:00 (midnight) · Open · Cooks 1, Waiters 0, Janitors 0',
    ]);
    const gaps = screen.getByRole('list', { name: 'Open-hours schedule gaps' });
    expect(within(gaps).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '00:00 to 24:00 (midnight) · No waiters scheduled to Work.',
    ]);
    expect(screen.getByText(
      'Based on this draft and saved team schedules. Nonzero counts do not guarantee enough staff or actual availability.',
    )).toBeInTheDocument();
    expect(observationRows()).toEqual([`00:00 to 24:00 (midnight) · ${rowCopy}`]);

    fireEvent.click(screen.getByRole('button', { name: 'Apply schedule' }));

    expect(screen.getByRole('button', { name: 'Apply schedule' })).toBeEnabled();
    expect(onApply).toHaveBeenCalledWith(allWork());
  });

  it('does not modify deeply frozen inputs while deriving the observation', () => {
    const cookSchedule = Object.freeze(Array(48).fill('work'));
    const waiterSchedule = Object.freeze(Array(48).fill('work'));
    const janitorSchedule = Object.freeze(Array(48).fill('rest'));
    const cook = Object.freeze({ id: 'c1', name: 'Marco', role: 'cook', schedule: cookSchedule });
    const waiter = Object.freeze({ id: 'w1', name: 'Anna', role: 'waiter', schedule: waiterSchedule });
    const janitor = Object.freeze({ id: 'j1', name: 'Sam', role: 'janitor', schedule: janitorSchedule });
    const staffList = Object.freeze([cook, waiter, janitor]);
    render(
      <ScheduleHarness
        initialSchedule={janitorSchedule}
        staff={janitor}
        staffList={staffList}
        openHour={0}
        closeHour={0}
      />,
    );

    expect(observationRows()).toEqual([`00:00 to 24:00 (midnight) · ${rowCopy}`]);
    expect(cookSchedule).toEqual(Array(48).fill('work'));
    expect(waiterSchedule).toEqual(Array(48).fill('work'));
    expect(janitorSchedule).toEqual(Array(48).fill('rest'));
    expect(Object.isFrozen(cookSchedule)).toBe(true);
    expect(Object.isFrozen(waiterSchedule)).toBe(true);
    expect(Object.isFrozen(janitorSchedule)).toBe(true);
    expect(Object.isFrozen(staffList)).toBe(true);
  });
});

const SLOT_COUNT = 48;

function expandCoveragePeriods(periods) {
  const slots = Array(SLOT_COUNT).fill(null);
  for (const period of periods) {
    for (let index = period.start; index < period.end; index += 1) {
      expect(slots[index]).toBeNull();
      slots[index] = { open: period.open, ...period.counts };
    }
  }
  expect(slots).not.toContain(null);
  expect(periods[0]?.start).toBe(0);
  expect(periods[periods.length - 1]?.end).toBe(SLOT_COUNT);
  return slots;
}

describe('getTeamCoveragePeriods', () => {
  it('groups the edited draft and saved team into ordered coverage periods', () => {
    const cook = { id: 'c', role: 'cook', schedule: Array(48).fill('work') };
    const waiter = { id: 'w', role: 'waiter' };
    const draft = Array(48).fill('rest');
    draft[17] = 'work';
    const rows = getTeamCoveragePeriods({
      staffList: [cook, waiter], staff: cook, schedule: draft,
      openHour: 8.5, closeHour: 9,
    });

    expect(rows).toEqual([
      { start: 0, end: 17, open: false, counts: { cook: 0, waiter: 1, janitor: 0, other: 0 } },
      { start: 17, end: 18, open: true, counts: { cook: 1, waiter: 1, janitor: 0, other: 0 } },
      { start: 18, end: 48, open: false, counts: { cook: 0, waiter: 1, janitor: 0, other: 0 } },
    ]);
    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, (_slot, index) => ({
      open: index === 17, cook: index === 17 ? 1 : 0, waiter: 1, janitor: 0, other: 0,
    })));
  });

  it('excludes a fourteen-slot janitor PTO run from Work counts', () => {
    const ptoJanitor = {
      id: 'j',
      role: 'janitor',
      schedule: [...Array(14).fill('pto'), ...Array(34).fill('work')],
    };

    const rows = getTeamCoveragePeriods({ staffList: [ptoJanitor] });

    expect(rows).toEqual([
      { start: 0, end: 14, open: true, counts: { cook: 0, waiter: 0, janitor: 0, other: 0 } },
      { start: 14, end: 48, open: true, counts: { cook: 0, waiter: 0, janitor: 1, other: 0 } },
    ]);
    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, (_slot, index) => ({
      open: true, cook: 0, waiter: 0, janitor: index < 14 ? 0 : 1, other: 0,
    })));
  });

  it('resolves nested schedule.schedule and duty.schedule and defaults malformed slots to Work', () => {
    const nestedSchedule = { id: 'n1', role: 'cook', schedule: { schedule: Array(48).fill('rest') } };
    const dutySchedule = { id: 'n2', role: 'waiter', duty: { schedule: Array(48).fill('rest') } };
    const malformed = {
      id: 'n3',
      role: 'janitor',
      schedule: [undefined, 'lunch', null, ...Array(45).fill('rest')],
    };

    const rows = getTeamCoveragePeriods({ staffList: [nestedSchedule, dutySchedule, malformed] });

    expect(rows).toEqual([
      { start: 0, end: 3, open: true, counts: { cook: 0, waiter: 0, janitor: 1, other: 0 } },
      { start: 3, end: 48, open: true, counts: { cook: 0, waiter: 0, janitor: 0, other: 0 } },
    ]);
    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, (_slot, index) => ({
      open: true, cook: 0, waiter: 0, janitor: index < 3 ? 1 : 0, other: 0,
    })));
  });

  it('counts only scheduled Work and ignores effectiveDuty', () => {
    const restingWaiter = { id: 'r', role: 'waiter', effectiveDuty: 'work', schedule: Array(48).fill('rest') };
    const ptoCook = { id: 'p', role: 'cook', effectiveDuty: 'pto', schedule: Array(48).fill('work') };

    const rows = getTeamCoveragePeriods({ staffList: [restingWaiter, ptoCook] });

    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, () => ({
      open: true, cook: 1, waiter: 0, janitor: 0, other: 0,
    })));
  });

  it('includes an edited worker absent from the staff list exactly once', () => {
    const cook = { id: 'c', role: 'cook', schedule: Array(48).fill('work') };
    const draft = Array(48).fill('rest');
    draft[47] = 'work';
    const waiter = { id: 'w', role: 'waiter', schedule: Array(48).fill('work') };

    const rows = getTeamCoveragePeriods({ staffList: [waiter], staff: cook, schedule: draft });

    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, (_slot, index) => ({
      open: true, cook: index === 47 ? 1 : 0, waiter: 1, janitor: 0, other: 0,
    })));
  });

  it('does not double an active worker matched by ID through a copied object', () => {
    const cook = { id: 'c', role: 'cook', schedule: Array(48).fill('work') };
    const draft = Array(48).fill('rest');
    draft[0] = 'work';

    const rows = getTeamCoveragePeriods({
      staffList: [cook],
      staff: { id: 'c', name: 'Copied record' },
      schedule: draft,
    });

    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, (_slot, index) => ({
      open: true, cook: index === 0 ? 1 : 0, waiter: 0, janitor: 0, other: 0,
    })));
  });

  it('does not double an ID-less active worker matched by object identity', () => {
    const worker = { role: 'waiter', schedule: Array(48).fill('rest') };

    const rows = getTeamCoveragePeriods({
      staffList: [worker],
      staff: worker,
      schedule: Array(48).fill('work'),
    });

    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, () => ({
      open: true, cook: 0, waiter: 1, janitor: 0, other: 0,
    })));
  });

  it('ignores null staff-list entries', () => {
    const cook = { id: 'c', role: 'cook', schedule: Array(48).fill('rest') };

    const rows = getTeamCoveragePeriods({ staffList: [null, cook, undefined] });

    expect(rows).toEqual([
      { start: 0, end: 48, open: true, counts: { cook: 0, waiter: 0, janitor: 0, other: 0 } },
    ]);
  });

  it('returns one zero-count period for an empty team', () => {
    const expected = [
      { start: 0, end: 48, open: true, counts: { cook: 0, waiter: 0, janitor: 0, other: 0 } },
    ];

    expect(getTeamCoveragePeriods({})).toEqual(expected);
    expect(getTeamCoveragePeriods({ staffList: [] })).toEqual(expected);
  });

  it('counts unknown and missing roles as Other', () => {
    const manager = { id: 'm', role: 'manager', schedule: Array(48).fill('work') };
    const roleless = { id: 'x', schedule: Array(48).fill('work') };

    const rows = getTeamCoveragePeriods({ staffList: [manager, roleless] });

    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, () => ({
      open: true, cook: 0, waiter: 0, janitor: 0, other: 2,
    })));
  });

  it('does not modify deeply frozen inputs', () => {
    const saved = Object.freeze(Array(48).fill('work'));
    const cook = Object.freeze({ id: 'c', role: 'cook', schedule: saved });
    const staffList = Object.freeze([cook, null]);
    const draft = Object.freeze(Array(48).fill('rest'));

    const rows = getTeamCoveragePeriods({
      staffList, staff: cook, schedule: draft, openHour: 0, closeHour: 0,
    });

    expect(rows).toEqual([
      { start: 0, end: 48, open: true, counts: { cook: 0, waiter: 0, janitor: 0, other: 0 } },
    ]);
    expect(draft).toEqual(Array(48).fill('rest'));
    expect(saved).toEqual(Array(48).fill('work'));
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(saved)).toBe(true);
  });

  it.each([
    ['8.5 to 9 hours', 8.5, 9, index => index === 17],
    ['22 to 2 hours overnight', 22, 2, index => index >= 44 || index < 4],
    ['0 to 0 all day', 0, 0, () => true],
    ['24 to 0 all day', 24, 0, () => true],
    ['undefined hours', undefined, undefined, () => true],
    ['an invalid open hour with a valid close hour', 'eight', 9, index => index < 18],
  ])('marks %s with clock semantics', (_label, openHour, closeHour, openAt) => {
    const cook = { id: 'c', role: 'cook', schedule: Array(48).fill('work') };

    const rows = getTeamCoveragePeriods({ staffList: [cook], openHour, closeHour });

    expect(expandCoveragePeriods(rows)).toEqual(Array.from({ length: 48 }, (_slot, index) => ({
      open: openAt(index), cook: 1, waiter: 0, janitor: 0, other: 0,
    })));
  });
});
