export const STAFF_CLEANING_FOCUS_OPTIONS = Object.freeze([
  { value: 'balanced', label: 'Balanced', taskType: null },
  { value: 'tables', label: 'Tables', taskType: 'clean_table' },
  { value: 'floors', label: 'Floors', taskType: 'clean_floor' },
  { value: 'washing', label: 'Manual washing', taskType: 'wash_item' },
]);

export const STAFF_CLEANING_FOCUS_VALUES = new Set(
  STAFF_CLEANING_FOCUS_OPTIONS.map(option => option.value),
);

export function getStaffCleaningFocusTaskType(focus) {
  return STAFF_CLEANING_FOCUS_OPTIONS.find(option => option.value === focus)?.taskType ?? null;
}
