export function getRecentFinanceSummary(history) {
  const records = Array.isArray(history) ? history.slice(-7) : [];
  const summary = {
    recordCount: records.length,
    revenue: { count: 0, total: 0 },
    payroll: { count: 0, total: 0 },
    profit: { count: 0, total: 0, average: null, positiveCount: 0 },
  };

  for (const record of records) {
    const revenue = record?.revenue;
    if (Number.isFinite(revenue)) {
      summary.revenue.count += 1;
      summary.revenue.total += revenue;
    }

    const payroll = record?.payroll;
    if (Number.isFinite(payroll)) {
      summary.payroll.count += 1;
      summary.payroll.total += payroll;
    }

    const profit = record?.profit;
    if (Number.isFinite(profit)) {
      summary.profit.count += 1;
      summary.profit.total += profit;
      if (profit > 0) summary.profit.positiveCount += 1;
    }
  }

  for (const field of [summary.revenue, summary.payroll, summary.profit]) {
    if (field.count === 0) field.total = null;
  }
  if (summary.profit.count > 0) {
    summary.profit.average = summary.profit.total / summary.profit.count;
  }

  return summary;
}
