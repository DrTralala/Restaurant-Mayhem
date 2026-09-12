import { movementSaveSnapshot } from './movementPersistence';

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Save request failed');
  return payload;
}

export function saveRepositoryState(state, fetchImpl = fetch) {
  return fetchImpl('/api/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(movementSaveSnapshot(state)),
  }).then(readJson);
}

export function loadLatestRepositoryState(fetchImpl = fetch) {
  return fetchImpl('/api/saves/latest').then(readJson);
}
