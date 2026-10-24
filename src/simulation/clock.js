const SECONDS_PER_DAY = 86400;
const HOURS_PER_DAY = 24;

export const DEFAULT_OPERATING_HOURS = Object.freeze({
  openHour: 0,
  closeHour: 0,
});

export function getDailyPayroll(staff = []) {
  return staff.reduce((total, worker) => {
    const salary = worker?.salary;
    return total + (Number.isFinite(salary) && salary >= 0 ? salary : 0);
  }, 0);
}

export function advanceClock(state, dt) {
  const newGameTime = state.restaurant.gameTime + dt;
  const crossedMidnights = Math.max(0, Math.floor(newGameTime / SECONDS_PER_DAY)
    - Math.floor(state.restaurant.gameTime / SECONDS_PER_DAY));
  const newDay = state.restaurant.day + crossedMidnights;

  let funds = state.restaurant.funds;
  let dailyRevenue = Number.isFinite(state.restaurant.dailyRevenue)
    ? state.restaurant.dailyRevenue
    : 0;
  let dailyHistory = [...(state.dailyHistory || [])];
  let notifications = [...(state.notifications || [])];
  const payroll = getDailyPayroll(state.staff || []);

  for (let offset = 0; offset < crossedMidnights; offset += 1) {
    const day = state.restaurant.day + offset;
    const revenue = offset === 0 ? dailyRevenue : 0;
    const profit = revenue - payroll;
    funds -= payroll;
    dailyHistory.push({ day, revenue, payroll, profit });
    notifications.push({
      id: `daily-summary-${day}-${state.restaurant.gameTime}-${offset}`,
      message: `Day ${day}: Revenue $${revenue.toFixed(2)}, payroll $${payroll.toFixed(2)}, profit $${profit.toFixed(2)}`,
      time: Date.now(),
    });
    dailyRevenue = 0;
  }

  return {
    ...state,
    restaurant: {
      ...state.restaurant,
      funds,
      dailyRevenue,
      gameTime: newGameTime,
      day: newDay,
    },
    dailyHistory: dailyHistory.slice(-30),
    notifications,
    ...(crossedMidnights > 0
      ? { menuSales: { day: newDay, dishes: [], drinks: [] } }
      : {}),
  };
}

export function normaliseOperatingHour(value, fallback) {
  if (value === HOURS_PER_DAY) return 0;
  return Number.isFinite(value) && value >= 0 && value < HOURS_PER_DAY
    && Number.isInteger(value * 2) ? value : fallback;
}

export function isRestaurantOpen(state) {
  const restaurant = state?.restaurant || {};
  const openHour = normaliseOperatingHour(
    restaurant.openHour,
    DEFAULT_OPERATING_HOURS.openHour,
  );
  const closeHour = normaliseOperatingHour(
    restaurant.closeHour,
    DEFAULT_OPERATING_HOURS.closeHour,
  );
  if (openHour === closeHour) return true;
  const seconds = ((Number(restaurant.gameTime) || 0) % SECONDS_PER_DAY + SECONDS_PER_DAY)
    % SECONDS_PER_DAY;
  const hour = seconds / 3600;
  return openHour < closeHour
    ? hour >= openHour && hour < closeHour
    : hour >= openHour || hour < closeHour;
}

export const RUSH_PERIODS = Object.freeze([
  Object.freeze({ name: 'Breakfast', startHour: 6, peakHour: 7, endHour: 8, peakMultiplier: 2 }),
  Object.freeze({ name: 'Lunch', startHour: 11, peakHour: 12.5, endHour: 14, peakMultiplier: 2.5 }),
  Object.freeze({ name: 'Dinner', startHour: 17, peakHour: 18.5, endHour: 20, peakMultiplier: 3 }),
]);

function ramp(secondsOfDay, start, peak, end, peakMultiplier) {
  if (secondsOfDay < start || secondsOfDay > end) return 1;
  if (secondsOfDay <= peak) {
    return 1 + (peakMultiplier - 1) * ((secondsOfDay - start) / (peak - start));
  }
  return peakMultiplier - (peakMultiplier - 1) * ((secondsOfDay - peak) / (end - peak));
}

export function getRushHourMultiplier(totalSeconds) {
  const time = ((totalSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  return Math.max(
    1,
    ...RUSH_PERIODS.map(period => ramp(
      time,
      period.startHour * 3600,
      period.peakHour * 3600,
      period.endHour * 3600,
      period.peakMultiplier,
    )),
  );
}

export function getClockHandAngles(totalSeconds) {
  const time = ((totalSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const hours = time / 3600;
  const minutes = (time % 3600) / 60;
  return { hourDegrees: (hours % 12) * 30, minuteDegrees: minutes * 6 };
}

export function secondsToGameTime(totalSeconds) {
  const seconds = Math.floor(totalSeconds % SECONDS_PER_DAY);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

export function formatOperatingHour(hour) {
  return secondsToGameTime(normaliseOperatingHour(hour, 0) * 3600);
}
