import { describe, expect, it, vi } from 'vitest';
import { loadLatestRepositoryState, saveRepositoryState } from './repositorySaves';

describe('repository saves client', () => {
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
