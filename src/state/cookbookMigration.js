import { createCookbookState } from '../simulation/cookbook';

// The schema-1 cookbook written before Gazpacho existed. Migration recognises
// exactly this set so a missing, extra or unknown entry is an error rather than
// an invitation to invent progress.
const LEGACY_RECIPE_IDS = ['toast', 'cheese-toast', 'roast-vegetables',
  'baked-potato', 'fries', 'fried-chicken'];

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function isLegacyEntryMap(entries) {
  return isObject(entries)
    && Object.keys(entries).length === LEGACY_RECIPE_IDS.length
    && LEGACY_RECIPE_IDS.every(id => has(entries, id));
}

/**
 * Upgrade a recognised schema-1 cookbook before strict validation runs.
 * Only the root, cookbook and entry map are copied; original entries and every
 * other saved field are retained by reference. Absent or non-v1 cookbooks are
 * returned untouched for the existing strict validators to judge.
 */
export function migrateLegacyCookbook(saved) {
  if (!isObject(saved) || !has(saved, 'cookbook')) return saved;
  const cookbook = saved.cookbook;
  if (!isObject(cookbook) || cookbook.schemaVersion !== 1) return saved;
  if (!isLegacyEntryMap(cookbook.entries)) {
    throw new Error('Invalid cookbook: unsupported legacy entry map');
  }
  return {
    ...saved,
    cookbook: {
      ...cookbook,
      schemaVersion: 2,
      entries: { ...cookbook.entries, gazpacho: createCookbookState().entries.gazpacho },
    },
  };
}
