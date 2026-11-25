import { useState } from 'react';
import { formatOperatingHour } from '../simulation/clock';
import { getScheduledRoleCounts } from './staffSchedulePreview';
import { getBreakChoices, moveBreak } from './rushBreakChoices';

const time = slot => formatOperatingHour(slot / 2);

export default function RushBreakSwap({ gap, staff, dispatch }) {
  const [draft, setDraft] = useState(null);
  const choices = getBreakChoices(gap, staff);
  if (!choices.length) return null;
  if (!draft) return <button type="button" style={{ marginLeft: 8 }} onClick={() => setDraft({ key: '', to: null })}>Move break</button>;

  const choice = choices.find(option => option.key === draft.key);
  const schedule = moveBreak(choice, draft.to);
  const count = schedule && getScheduledRoleCounts(staff, draft.to * 1800)[choice.worker.role];
  return (
    <fieldset style={{ display: 'grid', gap: 6, margin: '6px 0' }}>
      <legend>Move a half-hour break on the daily schedule</legend>
      <label>Cover rush slot{' '}
        <select value={choice?.key ?? ''} onChange={e => setDraft({ key: e.target.value, to: null })}>
          <option value="">Choose time and employee</option>
          {choices.map(({ key, worker, slot }) => <option key={key} value={key}>{time(slot)} · {worker.name ?? worker.id} ({worker.role})</option>)}
        </select>
      </label>
      <label>New break time{' '}
        <select disabled={!choice} value={schedule ? draft.to : ''} onChange={e => setDraft({ ...draft, to: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">Choose a work slot</option>
          {choice?.schedule.map((mode, slot) => mode === 'work' && <option key={slot} value={slot}>{time(slot)}</option>)}
        </select>
      </label>
      {schedule && <div role="status">Scheduled {choice.worker.role}s: {time(choice.slot)}: 0 → 1; {time(draft.to)}: {count} → {count - 1}.</div>}
      <div>
        <button type="button" disabled={!schedule} onClick={() => {
          if (!schedule) return;
          dispatch({ type: 'SET_STAFF_SCHEDULE', id: choice.worker.id, schedule });
          setDraft(null);
        }}>Apply</button>{' '}
        <button type="button" onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </fieldset>
  );
}
