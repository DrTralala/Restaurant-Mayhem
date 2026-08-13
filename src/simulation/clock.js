const SECONDS_PER_DAY = 86400;

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
  const payroll = (state.staff || []).reduce((total, staff) => {
    const salary = staff?.salary;
    return total + (Number.isFinite(salary) && salary >= 0 ? salary : 0);
  }, 0);

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
  };
}

export function isRestaurantOpen(state) {
  const secondsOfDay = state.restaurant.gameTime % SECONDS_PER_DAY;
  return secondsOfDay >= state.restaurant.openHour * 3600 && secondsOfDay < state.restaurant.closeHour * 3600;
}

export function secondsToGameTime(totalSeconds) {
  const seconds = Math.floor(totalSeconds % SECONDS_PER_DAY);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`;
}
