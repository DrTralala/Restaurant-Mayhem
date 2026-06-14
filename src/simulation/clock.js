const SECONDS_PER_DAY = 86400;

export function advanceClock(state, dt) {
  const newGameTime = state.restaurant.gameTime + dt;
  const dayChange = Math.floor(newGameTime / SECONDS_PER_DAY);
  const newDay = state.restaurant.day + (dayChange - Math.floor(state.restaurant.gameTime / SECONDS_PER_DAY));

  let dailyHistory = state.dailyHistory;
  if (newDay !== state.restaurant.day) {
    dailyHistory = [...state.dailyHistory, { day: state.restaurant.day, revenue: 0 }].slice(-30);
  }

  return {
    ...state,
    restaurant: { ...state.restaurant, gameTime: newGameTime, day: newDay },
    dailyHistory,
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
