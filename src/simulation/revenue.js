export function calculateRevenue(state) {
  const totalRevenue = state.completedCustomers.reduce((sum, c) => sum + c.revenue, 0);

  return {
    ...state,
    restaurant: {
      ...state.restaurant,
      funds: state.restaurant.funds + totalRevenue,
    },
    completedCustomers: [],
  };
}
