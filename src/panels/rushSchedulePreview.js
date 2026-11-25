import { RUSH_PERIODS, isRestaurantOpen } from '../simulation/clock';
import { createScheduledRoleCounter } from './staffSchedulePreview';

export function getRushSchedulePreview(restaurant = {}, staffList) {
  const countScheduledRoles = staffList === undefined
    ? null
    : createScheduledRoleCounter(staffList);

  return RUSH_PERIODS.map(period => {
    let openHours = 0;
    const staffingGaps = countScheduledRoles ? [] : null;
    let currentGap = null;
    for (let hour = period.startHour; hour < period.endHour; hour += 0.5) {
      const gameTime = (hour + 0.25) * 3600;
      const open = isRestaurantOpen({ restaurant: { ...restaurant, gameTime } });
      if (!open) {
        currentGap = null;
        continue;
      }

      openHours += 0.5;
      if (!countScheduledRoles) continue;

      const counts = countScheduledRoles(gameTime);
      const missingRoles = ['cook', 'waiter'].filter(role => counts[role] === 0);
      if (missingRoles.length === 0) {
        currentGap = null;
        continue;
      }

      const sameMissingRoles = currentGap?.missingRoles.length === missingRoles.length
        && missingRoles.every((role, index) => currentGap.missingRoles[index] === role);
      if (currentGap && currentGap.endHour === hour && sameMissingRoles) {
        currentGap.endHour = hour + 0.5;
      } else {
        currentGap = { startHour: hour, endHour: hour + 0.5, missingRoles };
        staffingGaps.push(currentGap);
      }
    }
    const peakOpen = isRestaurantOpen({
      restaurant: { ...restaurant, gameTime: period.peakHour * 3600 },
    });
    return {
      ...period,
      openHours,
      peakOpen,
      ...(countScheduledRoles ? {
        roleCounts: peakOpen ? countScheduledRoles(period.peakHour * 3600) : null,
        staffingGaps,
      } : {}),
    };
  });
}
