// @vitest-environment node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';
import { createVitest } from 'vitest/node';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Vitest test discovery', () => {
  it('keeps defaults, ignores local trees, and discovers checkout tests', async () => {
    const vitest = await createVitest('test', { root: repositoryRoot, run: true });

    try {
      const discoveredFiles = (await vitest.listFiles()).map(({ moduleId }) =>
        path.relative(repositoryRoot, moduleId),
      );

      expect(vitest.config.exclude).toEqual(expect.arrayContaining(configDefaults.exclude));
      expect(vitest.config.exclude).toEqual(expect.arrayContaining(['docs/**', '.worktrees/**']));
      expect(discoveredFiles).toContain('src/typography.test.js');
      expect(discoveredFiles).not.toContain(
        'docs/superpowers v2/20260917/expansion-save-diagnostic.test.jsx',
      );
      expect(discoveredFiles.some(file => file.startsWith('.worktrees/'))).toBe(false);
    } finally {
      await vitest.close();
    }
  });
});
