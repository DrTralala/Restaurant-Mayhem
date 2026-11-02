export function buildPaymentReceipt({ customer, subtotal, day, gameTime, tipRate, reviewScore }) {
  const tip = Math.round(subtotal * tipRate * 100) / 100;
  return {
    customerId: customer.id,
    day: day || Math.floor(gameTime / 86400) + 1,
    dishId: customer.dishId,
    drinkId: customer.drinkId,
    revenue: subtotal + tip,
    tip,
    totalPaid: subtotal + tip,
    reviewScore,
  };
}
