const FEMALE_NAMES = new Set(['Anna', 'Sofia', 'Isabella', 'Elena']);

export const CHARACTER_PALETTES = {
  male: { figure: '#39a9db', staffName: '#8edcff' },
  female: { figure: '#e66a9c', staffName: '#ffadd0' },
};

function stableParity(value = '') {
  let hash = 0;
  for (const character of String(value)) hash = ((hash * 31) + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2;
}

export function inferGender(character) {
  if (character.gender === 'male' || character.gender === 'female') return character.gender;
  if (character.name && FEMALE_NAMES.has(character.name)) return 'female';
  return stableParity(character.id || character.name) === 0 ? 'male' : 'female';
}

export function getCharacterPalette(character) {
  return CHARACTER_PALETTES[inferGender(character)];
}

export function getNameGender(name) {
  return FEMALE_NAMES.has(name) ? 'female' : 'male';
}
