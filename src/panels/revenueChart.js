const MAX_BARS = 7;
const LABEL_AND_PADDING_HEIGHT = 20;

function readValue(entry) {
  const revenue = entry?.revenue;
  return Number.isFinite(revenue) ? revenue : null;
}

function readDayLabel(entry) {
  return Number.isFinite(entry?.day) ? `D${entry.day}` : 'D?';
}

export function getRevenueChart(history, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const entries = Array.isArray(history) ? Array.from(history.slice(-MAX_BARS)) : [];
  const plotHeight = Math.max(0, height - LABEL_AND_PADDING_HEIGHT);
  const slotWidth = entries.length ? width / entries.length : 0;
  const barWidth = Math.max(0, slotWidth - 4);

  const values = entries.map(readValue);
  const finiteValues = values.filter(value => value !== null);
  const maxAbsolute = finiteValues.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    0,
  );
  const scale = maxAbsolute > 0 ? maxAbsolute : 1;
  const normalisedValues = values.map(value => (value === null ? null : value / scale));

  let positiveMax = 0;
  let negativeMin = 0;
  for (const value of normalisedValues) {
    if (value === null) continue;
    if (value > positiveMax) positiveMax = value;
    if (value < negativeMin) negativeMin = value;
  }
  if (positiveMax === 0 && negativeMin === 0) {
    positiveMax = 1;
    negativeMin = 0;
  }

  const span = positiveMax - negativeMin;
  const baselineY = (positiveMax / span) * plotHeight;
  const bars = entries.map((entry, index) => {
    const value = values[index];
    const x = index * slotWidth + 2;
    if (value === null) {
      return {
        x, y: baselineY, width: barWidth, height: 0, dayLabel: readDayLabel(entry), value: null,
      };
    }

    const valueY = ((positiveMax - normalisedValues[index]) / span) * plotHeight;
    return {
      x,
      y: Math.min(baselineY, valueY),
      width: barWidth,
      height: Math.abs(valueY - baselineY),
      dayLabel: readDayLabel(entry),
      value,
    };
  });

  return { baselineY, bars };
}
