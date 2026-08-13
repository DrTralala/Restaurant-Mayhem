import { describe, expect, it, vi } from 'vitest';
import { createSaveStore, formatSaveFilename } from './devSavePlugin';

describe('formatSaveFilename', () => {
  it('uses the requested local date and twelve-hour timestamp format', () => {
    const date = new Date(2026, 7, 13, 14, 36);

    expect(formatSaveFilename(date)).toBe('2026-08-13 2.36pm.json');
  });
});

describe('createSaveStore', () => {
  it('writes formatted JSON beneath the configured saves directory', async () => {
    const fs = {
      mkdir: vi.fn().mockResolvedValue(),
      writeFile: vi.fn().mockResolvedValue(),
    };
    const store = createSaveStore({
      saveDirectory: '/repo/saves',
      fs,
      now: () => new Date(2026, 7, 13, 14, 36),
    });
    const state = { version: 2, restaurant: { funds: 500 } };

    const result = await store.save(state);

    expect(fs.mkdir).toHaveBeenCalledWith('/repo/saves', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/repo/saves/2026-08-13 2.36pm.json',
      JSON.stringify(state, null, 2),
      'utf8',
    );
    expect(result).toEqual({ filename: '2026-08-13 2.36pm.json' });
  });
});
