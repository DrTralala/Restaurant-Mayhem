import { executeSample } from './profile-performance.mjs';

// One IPC request, one revision, one measured sample, then natural process exit.
// SIGTERM allows active SSR resources to close between synchronous passes; the
// parent escalates to SIGKILL if a stuck child cannot finish within one second.
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort(new Error('Sample child terminated')));
process.once('message', async request => {
  try {
    const result = await executeSample(request, controller.signal);
    await new Promise((resolve, reject) => process.send({ type: 'sample', result }, error => error ? reject(error) : resolve()));
  } catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.stack : String(error));
  } finally {
    if (process.connected) process.disconnect();
  }
});
