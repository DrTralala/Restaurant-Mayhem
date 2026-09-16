import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createSaveStore, formatSaveFilename, repositorySavePlugin } from './devSavePlugin';

const SAVE_BODY_LIMIT_BYTES = 5_000_000;

function createRequest(method, url, body = '') {
  const request = Readable.from([body]);
  request.method = method;
  request.url = url;
  return request;
}

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function invokeSavePlugin(rootDirectory, request) {
  let middleware;
  repositorySavePlugin(rootDirectory).configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  const response = createResponse();

  await middleware(request, response, vi.fn());

  return { response, payload: JSON.parse(response.body) };
}

async function withTemporaryRoot(callback) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'restaurant-mayhem-s4-'));
  try {
    return await callback(rootDirectory);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

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

describe('repositorySavePlugin middleware', () => {
  it('returns 200 and a filename for valid POST JSON', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const { response, payload } = await invokeSavePlugin(
        rootDirectory,
        createRequest('POST', '/api/saves', JSON.stringify({ version: 2 })),
      );

      expect(response.statusCode).toBe(200);
      expect(payload).toEqual({ filename: expect.any(String) });
    });
  });

  it('returns 400 for malformed POST JSON', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const { response, payload } = await invokeSavePlugin(
        rootDirectory,
        createRequest('POST', '/api/saves', '{"version":'),
      );

      expect(response.statusCode).toBe(400);
      expect(payload).toEqual({ error: 'Invalid JSON body' });
    });
  });

  it('returns 413 when an ASCII request body exceeds the byte limit', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const body = 'a'.repeat(SAVE_BODY_LIMIT_BYTES + 1);
      const { response, payload } = await invokeSavePlugin(
        rootDirectory,
        createRequest('POST', '/api/saves', body),
      );

      expect(response.statusCode).toBe(413);
      expect(payload).toEqual({ error: 'Save is too large' });
    });
  });

  it('counts multi-byte UTF-8 request bodies by bytes', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const body = 'é'.repeat(Math.floor(SAVE_BODY_LIMIT_BYTES / 2) + 1);
      expect(body.length).toBeLessThan(SAVE_BODY_LIMIT_BYTES);
      expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(SAVE_BODY_LIMIT_BYTES);

      const { response, payload } = await invokeSavePlugin(
        rootDirectory,
        createRequest('POST', '/api/saves', body),
      );

      expect(response.statusCode).toBe(413);
      expect(payload).toEqual({ error: 'Save is too large' });
    });
  });

  it('keeps corrupt latest save files as HTTP 500 responses', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      await mkdir(saveDirectory, { recursive: true });
      await writeFile(path.join(saveDirectory, 'corrupt.json'), '{not valid json', 'utf8');

      const { response, payload } = await invokeSavePlugin(
        rootDirectory,
        createRequest('GET', '/api/saves/latest'),
      );

      expect(response.statusCode).toBe(500);
      expect(payload.error).toEqual(expect.any(String));
    });
  });
});
