import { RUSH_PERIODS, isRestaurantOpen } from '../simulation/clock';

export function getRushSchedulePreview(restaurant = {}) {
  return RUSH_PERIODS.map(period => {
    let openHours = 0;
    for (let hour = period.startHour; hour < period.endHour; hour += 0.5) {
      if (isRestaurantOpen({ restaurant: { ...restaurant, gameTime: (hour + 0.25) * 3600 } })) openHours += 0.5;
    }
    return { ...period, openHours };
  });
}
