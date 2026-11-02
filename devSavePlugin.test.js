import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
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
  it('preserves sequential same-minute saves and loads the second as latest', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      const store = createSaveStore({
        saveDirectory,
        now: () => new Date(2026, 7, 13, 14, 36),
      });
      const firstState = { version: 2, restaurant: { funds: 500 } };
      const secondState = { version: 2, restaurant: { funds: 425 } };

      const first = await store.save(firstState);
      const second = await store.save(secondState);

      expect(await readFile(path.join(saveDirectory, first.filename), 'utf8'))
        .toBe(JSON.stringify(firstState, null, 2));
      expect(await readFile(path.join(saveDirectory, second.filename), 'utf8'))
        .toBe(JSON.stringify(secondState, null, 2));
      expect(first.filename).toBe('2026-08-13 2.36pm.json');
      expect(second.filename).toBe('2026-08-13 2.36pm (2).json');
      expect(await store.loadLatest()).toEqual({ filename: second.filename, state: secondState });
    });
  });

  it('does not overwrite a same-minute save when the store is recreated', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      const now = () => new Date(2026, 7, 13, 14, 36);
      const firstState = { version: 2, restaurant: { funds: 500 } };
      const secondState = { version: 2, restaurant: { funds: 425 } };
      const first = await createSaveStore({ saveDirectory, now }).save(firstState);
      const second = await createSaveStore({ saveDirectory, now }).save(secondState);

      expect(first.filename).toBe('2026-08-13 2.36pm.json');
      expect(second.filename).toBe('2026-08-13 2.36pm (2).json');
      expect(JSON.parse(await readFile(path.join(saveDirectory, first.filename), 'utf8')))
        .toEqual(firstState);
      expect(JSON.parse(await readFile(path.join(saveDirectory, second.filename), 'utf8')))
        .toEqual(secondState);
    });
  });

  it('preserves every save from concurrent stores using the same minute', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      const states = [
        { session: 'one', funds: 500 },
        { session: 'two', funds: 425 },
        { session: 'three', funds: 350 },
        { session: 'four', funds: 275 },
      ];
      const saves = await Promise.all(states.map(state => createSaveStore({
        saveDirectory,
        now: () => new Date(2026, 7, 13, 14, 36),
      }).save(state)));

      expect(new Set(saves.map(save => save.filename)).size).toBe(states.length);
      for (const [index, save] of saves.entries()) {
        expect(JSON.parse(await readFile(path.join(saveDirectory, save.filename), 'utf8')))
          .toEqual(states[index]);
      }
    });
  });

  it('selects the highest numeric suffix when same-minute saves have equal mtimes', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      const filenames = [
        '2026-08-13 2.36pm.json',
        '2026-08-13 2.36pm (2).json',
        '2026-08-13 2.36pm (3).json',
        '2026-08-13 2.36pm (4).json',
        '2026-08-13 2.36pm (5).json',
        '2026-08-13 2.36pm (6).json',
        '2026-08-13 2.36pm (7).json',
        '2026-08-13 2.36pm (8).json',
        '2026-08-13 2.36pm (9).json',
        '2026-08-13 2.36pm (10).json',
      ];
      const modifiedAt = new Date(2026, 7, 13, 14, 36);
      await mkdir(saveDirectory, { recursive: true });

      for (const [index, filename] of filenames.entries()) {
        const filePath = path.join(saveDirectory, filename);
        await writeFile(filePath, JSON.stringify({ number: index + 1 }), 'utf8');
        await utimes(filePath, modifiedAt, modifiedAt);
      }

      expect(await createSaveStore({ saveDirectory }).loadLatest()).toEqual({
        filename: '2026-08-13 2.36pm (10).json',
        state: { number: 10 },
      });
    });
  });

  it('prefers a newer save mtime over a higher collision suffix', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      const olderPath = path.join(saveDirectory, '2026-08-13 2.36pm (10).json');
      const newerPath = path.join(saveDirectory, '2026-08-13 2.36pm (2).json');
      const olderTime = new Date(2026, 7, 13, 14, 36);
      const newerTime = new Date(2026, 7, 13, 14, 37);
      await mkdir(saveDirectory, { recursive: true });
      await writeFile(olderPath, JSON.stringify({ save: 'older' }), 'utf8');
      await utimes(olderPath, olderTime, olderTime);
      await writeFile(newerPath, JSON.stringify({ save: 'newer' }), 'utf8');
      await utimes(newerPath, newerTime, newerTime);

      expect(await createSaveStore({ saveDirectory }).loadLatest()).toEqual({
        filename: '2026-08-13 2.36pm (2).json',
        state: { save: 'newer' },
      });
    });
  });

  it('loads legacy unsuffixed JSON saves', async () => {
    await withTemporaryRoot(async rootDirectory => {
      const saveDirectory = path.join(rootDirectory, 'saves');
      const state = { version: 1, restaurant: { funds: 125 } };
      await mkdir(saveDirectory, { recursive: true });
      await writeFile(path.join(saveDirectory, 'legacy-save.json'), JSON.stringify(state), 'utf8');

      expect(await createSaveStore({ saveDirectory }).loadLatest()).toEqual({
        filename: 'legacy-save.json',
        state,
      });
    });
  });

  it('uses filename ordering to break equal-mtime ties for unrelated saves', async () => {
    const fs = {
      mkdir: vi.fn().mockResolvedValue(),
      readdir: vi.fn().mockResolvedValue(['zeta.json', 'alpha.json']),
      stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
      readFile: vi.fn(async filePath => JSON.stringify({ filename: path.basename(filePath) })),
    };
    const store = createSaveStore({ saveDirectory: '/repo/saves', fs });

    expect(await store.loadLatest()).toEqual({
      filename: 'alpha.json',
      state: { filename: 'alpha.json' },
    });
  });

  it.each([
    { filenames: ['a (3).json', 'a (2).json', 'a (2)x.json'] },
    { filenames: ['a (3).json', 'a (2)x.json', 'a (2).json'] },
    { filenames: ['a (2).json', 'a (3).json', 'a (2)x.json'] },
    { filenames: ['a (2).json', 'a (2)x.json', 'a (3).json'] },
    { filenames: ['a (2)x.json', 'a (3).json', 'a (2).json'] },
    { filenames: ['a (2)x.json', 'a (2).json', 'a (3).json'] },
  ])('orders mixed equal-mtime filenames consistently for permutation %#', async ({ filenames }) => {
    const fs = {
      mkdir: vi.fn().mockResolvedValue(),
      readdir: vi.fn().mockResolvedValue(filenames),
      stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
      readFile: vi.fn(async filePath => JSON.stringify({ filename: path.basename(filePath) })),
    };
    const store = createSaveStore({ saveDirectory: '/repo/saves', fs });

    expect(await store.loadLatest()).toEqual({
      filename: 'a (2)x.json',
      state: { filename: 'a (2)x.json' },
    });
  });

  it('uses deterministic filename ordering when collision suffixes overflow Number', async () => {
    const smallerFilename = `a (${'8'.repeat(309)}).json`;
    const largerFilename = `a (${'9'.repeat(309)}).json`;
    const fs = {
      mkdir: vi.fn().mockResolvedValue(),
      readdir: vi.fn().mockResolvedValue([largerFilename, smallerFilename]),
      stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
      readFile: vi.fn(async filePath => JSON.stringify({ filename: path.basename(filePath) })),
    };
    const store = createSaveStore({ saveDirectory: '/repo/saves', fs });

    expect(await store.loadLatest()).toEqual({
      filename: smallerFilename,
      state: { filename: smallerFilename },
    });
  });

  it('uses raw filename ordering when collision suffixes exceed safe integer precision', async () => {
    const smallestFilename = 'a (9007199254740992).json';
    const middleFilename = 'a (9007199254740993).json';
    const largestFilename = 'a (9007199254740994).json';
    const fs = {
      mkdir: vi.fn().mockResolvedValue(),
      readdir: vi.fn().mockResolvedValue([largestFilename, middleFilename, smallestFilename]),
      stat: vi.fn().mockResolvedValue({ mtimeMs: 1000 }),
      readFile: vi.fn(async filePath => JSON.stringify({ filename: path.basename(filePath) })),
    };
    const store = createSaveStore({ saveDirectory: '/repo/saves', fs });

    expect(await store.loadLatest()).toEqual({
      filename: smallestFilename,
      state: { filename: smallestFilename },
    });
  });

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
      { encoding: 'utf8', flag: 'wx' },
    );
    expect(result).toEqual({ filename: '2026-08-13 2.36pm.json' });
  });

  it('propagates non-collision write errors without retrying', async () => {
    const diskError = Object.assign(new Error('Disk is full'), { code: 'ENOSPC' });
    const fs = {
      mkdir: vi.fn().mockResolvedValue(),
      writeFile: vi.fn().mockRejectedValue(diskError),
    };
    const store = createSaveStore({
      saveDirectory: '/repo/saves',
      fs,
      now: () => new Date(2026, 7, 13, 14, 36),
    });

    await expect(store.save({ version: 2 })).rejects.toBe(diskError);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/repo/saves/2026-08-13 2.36pm.json',
      JSON.stringify({ version: 2 }, null, 2),
      { encoding: 'utf8', flag: 'wx' },
    );
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
