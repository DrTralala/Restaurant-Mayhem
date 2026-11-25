import { getNormalisedStaffSchedule, validateStaffSchedule } from '../simulation/staffSchedules';

// gap comes from the saved-schedule rush preview: its missing roles apply
// throughout the whole interval. A swap changes just one slot in that range.
export function getBreakChoices(gap, staff) {
  const choices = [];
  for (const worker of staff) {
    if (worker?.id == null || !gap.missingRoles.includes(worker.role)) continue;
    const schedule = getNormalisedStaffSchedule(worker);
    if (!schedule.includes('work')) continue;
    for (let slot = gap.startHour * 2; slot < gap.endHour * 2; slot++) {
      if (schedule[slot] === 'rest') {
        choices.push({ key: JSON.stringify([worker.id, worker.role, slot]), worker, schedule, slot });
      }
    }
  }
  return choices;
}

export function moveBreak(choice, destination) {
  if (!choice || !Number.isInteger(destination) || choice.schedule[destination] !== 'work') return null;
  const schedule = [...choice.schedule];
  schedule[choice.slot] = 'work';
  schedule[destination] = 'rest';
  return validateStaffSchedule(schedule).valid ? schedule : null;
}
