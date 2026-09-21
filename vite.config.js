import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';
import { repositorySavePlugin } from './devSavePlugin';

export default defineConfig({
  plugins: [react(), repositorySavePlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    exclude: [...configDefaults.exclude, 'docs/**', '.worktrees/**'],
  },
});
