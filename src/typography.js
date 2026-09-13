export const FONT_FAMILY = "'Segoe UI', system-ui, sans-serif";

export const TYPOGRAPHY = Object.freeze({
  heading: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.25,
  }),
  subheading: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.3,
  }),
  body: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.4,
  }),
  control: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.25,
  }),
  secondary: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.4,
  }),
  canvas: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1.2,
  }),
  icon: Object.freeze({
    fontFamily: FONT_FAMILY,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1,
  }),
});

export const CANVAS_FONT_ROLES = Object.freeze({
  label: Object.freeze({ size: 10, weight: 500 }),
  heading: Object.freeze({ size: 11, weight: 600 }),
  compact: Object.freeze({ size: 9, weight: 500 }),
  icon: Object.freeze({ size: 14, weight: 600 }),
  staff: Object.freeze({ size: 8, weight: 500 }),
  item: Object.freeze({ size: 12, weight: 400 }),
  tooltip: Object.freeze({ size: 12, weight: 400 }),
});

const LABEL_OVERRIDES = Object.freeze({
  cashierTable: 'Cashier',
});

export function getCanvasFont(role = 'label', sizeOverride) {
  const selectedRole = CANVAS_FONT_ROLES[role] || CANVAS_FONT_ROLES.label;
  const size = Number.isFinite(sizeOverride) ? sizeOverride : selectedRole.size;
  return `${selectedRole.weight} ${size}px ${FONT_FAMILY}`;
}

export function humaniseIdentifier(value) {
  if (value == null) return '';
  const identifier = String(value).trim();
  if (LABEL_OVERRIDES[identifier]) return LABEL_OVERRIDES[identifier];
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  const label = words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : '';
  return label.replace(/\bvip\b/gi, 'VIP');
}

export function sentenceCase(value) {
  if (value == null) return '';
  const text = String(value).trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1).toLowerCase()}` : '';
}
