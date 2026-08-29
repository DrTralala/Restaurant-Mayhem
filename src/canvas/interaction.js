import { screenToWorld } from './camera';
import { getDefaultStaffPosition } from '../simulation/world';
import { getWashStationCapacity, getWashStationOccupancy } from '../simulation/dishwashing';

export function findClickedEntity(state, camera, screenX, screenY) {
  const world = screenToWorld(camera, screenX, screenY);

  for (const [index, staff] of state.staff.entries()) {
    const position = Number.isFinite(staff.x) && Number.isFinite(staff.y)
      ? staff
      : getDefaultStaffPosition(staff.role, index, state, staff.id);
    if (Math.hypot(world.x - position.x, world.y - position.y) <= 12) {
      return {
        type: 'staff',
        data: staff,
        text: `${staff.name} · ${staff.role} · ${Math.round(staff.morale)}% morale`,
      };
    }
  }

  // Chairs first — they sit inside table hitboxes
  for (const chair of state.chairs) {
    if (world.x >= chair.x && world.x <= chair.x + 20
      && world.y >= chair.y && world.y <= chair.y + 20) {
      return {
        type: 'chair',
        data: chair,
        text: 'Chair',
      };
    }
  }

  for (const table of state.tables) {
    if (world.x >= table.x - 20 && world.x <= table.x + 60
      && world.y >= table.y - 20 && world.y <= table.y + 60) {
      const customer = state.customers.find(c => c.tableId === table.id);
      return {
        type: 'table',
        data: table,
        text: `Dining table · ${table.seats} seats · ${table.status}${customer ? ` · ${customer.archetype}` : ''}`,
      };
    }
  }

  for (const station of state.kitchenStations) {
    if (world.x >= station.x && world.x <= station.x + 40
      && world.y >= station.y && world.y <= station.y + 40) {
      return {
        type: 'kitchen',
        data: station,
        text: `Station ${station.id} · ${station.equipmentId || 'Empty'}`,
      };
    }
  }

  for (const st of state.serviceTables) {
    if (world.x >= st.x && world.x <= st.x + 120
      && world.y >= st.y && world.y <= st.y + 40) {
      return {
        type: 'serviceTable',
        data: st,
        text: `Service Counter · ${(Array.isArray(state.serviceItems) ? state.serviceItems : [])
          .filter(item => item.state === 'on_service' && item.serviceTableId === st.id).length} items waiting`,
      };
    }
  }

  for (const station of state.washStations || []) {
    if (world.x >= station.x && world.x <= station.x + (station.w || 40)
      && world.y >= station.y && world.y <= station.y + (station.h || 40)) {
      const occupancy = getWashStationOccupancy(state, station);
      const capacity = getWashStationCapacity(station);
      return {
        type: 'washStation', data: station,
        text: `${station.type === 'automatic' ? 'Automatic Dishwasher' : 'Sink'} · ${occupancy} / ${capacity}`,
      };
    }
  }

  return null;
}
