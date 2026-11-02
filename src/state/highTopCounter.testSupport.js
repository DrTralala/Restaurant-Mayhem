import { createInitialState } from './initialState';
import { createHighTopCounterRecords } from '../data/highTopCounters';

export function createEmptyCounterTestState() {
  const state = createInitialState();
  return { ...state,
    restaurant: { ...state.restaurant, funds: 1000 },
    tables: [], chairs: [], highTopCounters: [], staff: [], customers: [],
    queue: [], queueSlots: [], queueDepartures: [], queueAdmissionGate: null,
    kitchenStations: [], serviceTables: [], cashierStations: [],
    washStations: [], staffAmenities: [], serviceItems: [], cookingBatches: [],
  };
}

export function createCounterTestState(rotation = 0) {
  const counter = { id: 'htc1', x: 300, y: 300, rotation };
  return { ...createEmptyCounterTestState(), highTopCounters: [counter], ...createHighTopCounterRecords(counter) };
}

export function counterParty(id, size = 1) {
  return { partyId: id, members: Array.from({ length: size }, (_, index) => ({
    id: `${id}-${index}`, partyId: id, partySize: size, archetype: 'regular', state: 'queued',
    queuePatience: 10000, queuePatienceMax: 10000, patience: 10000, patienceMax: 10000, happiness: 80,
  })) };
}
