import path from 'node:path';
import { promises as nodeFs } from 'node:fs';

export function formatSaveFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = date.getHours() >= 12 ? 'pm' : 'am';
  const hour = date.getHours() % 12 || 12;
  return `${year}-${month}-${day} ${hour}.${minutes}${period}.json`;
}

export function createSaveStore({ saveDirectory, fs = nodeFs, now = () => new Date() }) {
  return {
    async save(state) {
      await fs.mkdir(saveDirectory, { recursive: true });
      const filename = formatSaveFilename(now());
      await fs.writeFile(path.join(saveDirectory, filename), JSON.stringify(state, null, 2), 'utf8');
      return { filename };
    },

    async loadLatest() {
      await fs.mkdir(saveDirectory, { recursive: true });
      const files = (await fs.readdir(saveDirectory))
        .filter(filename => filename.endsWith('.json'));
      if (!files.length) return null;

      const candidates = await Promise.all(files.map(async filename => ({
        filename,
        modified: (await fs.stat(path.join(saveDirectory, filename))).mtimeMs,
      })));
      candidates.sort((a, b) => b.modified - a.modified);
      const latest = candidates[0].filename;
      const state = JSON.parse(await fs.readFile(path.join(saveDirectory, latest), 'utf8'));
      return { filename: latest, state };
    },
  };
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 5_000_000) reject(new Error('Save is too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

export function repositorySavePlugin(rootDirectory = process.cwd()) {
  const store = createSaveStore({ saveDirectory: path.join(rootDirectory, 'saves') });

  return {
    name: 'repository-save-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          if (request.method === 'POST' && request.url === '/api/saves') {
            const state = JSON.parse(await readRequestBody(request));
            sendJson(response, 200, await store.save(state));
            return;
          }
          if (request.method === 'GET' && request.url === '/api/saves/latest') {
            const saved = await store.loadLatest();
            sendJson(response, saved ? 200 : 404, saved || { error: 'No repository save found' });
            return;
          }
          next();
        } catch (error) {
          sendJson(response, 500, { error: error.message });
        }
      });
    },
  };
}
