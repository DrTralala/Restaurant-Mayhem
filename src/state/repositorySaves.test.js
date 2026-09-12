import { describe, expect, it, vi } from 'vitest';
import { loadLatestRepositoryState, saveRepositoryState } from './repositorySaves';
import { hydrateState } from './persistence';
import { createInitialState } from './initialState';
import { createMovementCoordinator } from '../simulation/movement';
import { SAVE_VERSION } from './saveVersion';

describe('repository saves client', () => {
  it('omits the runtime coordinator even when it contains circular search state', async () => {
    const coordinator = { requests: new Map() };
    coordinator.circular = coordinator;
    const state = { version: 6, restaurant: { funds: 999 }, movementCoordinator: coordinator };
    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'test.json' }) };
    };
    await saveRepositoryState(state, fetchImpl);
    expect(body).toEqual({ version: 6, restaurant: { funds: 999 } });
    expect(state.movementCoordinator).toBe(coordinator);
  });
  it('never serialises or restores live plans through the REPOSITORY save transport', async () => {
    const coordinator = createMovementCoordinator();
    coordinator.plans.set('a', []);
    coordinator.plans.set('b', []);
    const state = { version: SAVE_VERSION, restaurant: { funds: 999 }, movementCoordinator: coordinator };
    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ filename: 'test.json' }) };
    };
    await saveRepositoryState(state, fetchImpl);
    expect(body).not.toHaveProperty('movementCoordinator');
    const restored = hydrateState(body, createInitialState());
    expect(restored.movementCoordinator.plans instanceof Map).toBe(true);
    expect(restored.movementCoordinator.plans.size).toBe(0);
    // The live coordinator is untouched by the transport.
    expect(state.movementCoordinator.plans.size).toBe(2);
  });
  it('posts the state to the development save endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ filename: '2026-08-13 2.36pm.json' }),
    });
    const state = { version: 2 };

    await expect(saveRepositoryState(state, fetchImpl)).resolves.toEqual({
      filename: '2026-08-13 2.36pm.json',
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  });

  it('loads the latest state from the development save endpoint', async () => {
    const payload = { filename: '2026-08-13 2.36pm.json', state: { version: 2 } };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });

    await expect(loadLatestRepositoryState(fetchImpl)).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith('/api/saves/latest');
  });
});
