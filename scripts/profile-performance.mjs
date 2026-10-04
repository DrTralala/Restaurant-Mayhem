import { existsSync, statSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync, fork } from 'node:child_process';
import { posix as pathPosix, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deterministicProjection } from './profile-navigation.mjs';

function defaultRoot() {
  try {
    return fileURLToPath(new URL('../', import.meta.url));
  } catch {
    return resolve(process.cwd());
  }
}

const DEFAULT_ROOT = defaultRoot();
const DEFAULT_BASELINE = 'ad2c9aa';
const DEFAULT_MODES = ['fresh', 'congested', 'edited', 'restored'];
const DEFAULT_SPEEDS = [1, 4];
const MODES = new Set(DEFAULT_MODES);
const SPEEDS = new Set([1, 2, 4]);
const RANDOM_SEED = 20260920;
const SAMPLE_TIMEOUT_MILLISECONDS = 120_000;

function invalidArgument(argument) {
  throw new Error(`Invalid performance argument: ${argument}`);
}

function parseList(value, allowed, argument) {
  const entries = value.split(',');
  if (entries.some(entry => !allowed.has(entry)) || new Set(entries).size !== entries.length) {
    invalidArgument(argument);
  }
  return entries;
}

function isSafeRevisionName(value) {
  return /^(?:[0-9a-fA-F]{4,64}|[A-Za-z0-9_][A-Za-z0-9._/-]*)$/.test(value)
    && !value.includes('..')
    && !value.includes('//')
    && !value.endsWith('/')
    && !value.endsWith('.');
}

function validateOptions(options) {
  if (!options || typeof options !== 'object') throw new Error('Performance options are required');
  if (typeof options.root !== 'string' || options.root.length === 0) {
    invalidArgument(`--root=${options.root ?? ''}`);
  }
  const root = resolve(options.root);
  const baseline = options.baseline ?? DEFAULT_BASELINE;
  if (typeof baseline !== 'string' || !isSafeRevisionName(baseline)) {
    invalidArgument(`--baseline=${baseline ?? ''}`);
  }
  const modes = options.modes ?? DEFAULT_MODES;
  if (!Array.isArray(modes) || modes.length === 0
    || modes.some(mode => !MODES.has(mode)) || new Set(modes).size !== modes.length) {
    invalidArgument(`--modes=${Array.isArray(modes) ? modes.join(',') : String(modes)}`);
  }
  const speeds = options.speeds ?? DEFAULT_SPEEDS;
  if (!Array.isArray(speeds) || speeds.length === 0
    || speeds.some(speed => !SPEEDS.has(speed)) || new Set(speeds).size !== speeds.length) {
    invalidArgument(`--speeds=${Array.isArray(speeds) ? speeds.join(',') : String(speeds)}`);
  }
  for (const key of ['ticks', 'runs', 'warmups']) {
    const value = options[key] ?? (key === 'ticks' ? 900 : key === 'runs' ? 4 : 1);
    if (!Number.isSafeInteger(value)
      || (key === 'ticks' && value < 2)
      || (key === 'runs' && value < 1)
      || (key === 'warmups' && value < 0)) {
      invalidArgument(`--${key}=${value}`);
    }
  }
  return {
    root,
    baseline,
    modes: [...modes],
    speeds: [...speeds],
    ticks: options.ticks ?? 900,
    runs: options.runs ?? 4,
    warmups: options.warmups ?? 1,
  };
}

export function parsePerformanceArguments(args) {
  const options = {
    root: DEFAULT_ROOT,
    baseline: DEFAULT_BASELINE,
    modes: [...DEFAULT_MODES],
    speeds: [...DEFAULT_SPEEDS],
    ticks: 900,
    // Four pairs give equal AB/BA positions without adding hidden samples.
    runs: 4,
    warmups: 1,
  };
  const seen = new Set();

  for (const argument of args) {
    const match = /^--([a-z]+)=(.*)$/.exec(argument);
    if (!match) invalidArgument(argument);
    const [, key, value] = match;
    const group = key === 'mode' || key === 'modes' ? 'modes'
      : key === 'speed' || key === 'speeds' ? 'speeds' : key;
    if (seen.has(group)) invalidArgument(argument);
    seen.add(group);

    if (key === 'root') {
      if (!value) invalidArgument(argument);
      options.root = resolve(value);
    } else if (key === 'baseline') {
      if (!isSafeRevisionName(value)) invalidArgument(argument);
      options.baseline = value;
    } else if (key === 'mode' || key === 'modes') {
      options.modes = parseList(value, MODES, argument);
    } else if (key === 'speed' || key === 'speeds') {
      const values = parseList(value, new Set([...SPEEDS].map(String)), argument)
        .map(Number);
      options.speeds = values;
    } else if (key === 'ticks' || key === 'runs' || key === 'warmups') {
      const minimum = key === 'warmups' ? 0 : key === 'ticks' ? 2 : 1;
      const pattern = key === 'warmups' ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/;
      if (!pattern.test(value)) invalidArgument(argument);
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < minimum) invalidArgument(argument);
      options[key] = number;
    } else {
      invalidArgument(argument);
    }
  }

  return validateOptions(options);
}

function assertProfileRoot(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Performance root is not a directory: ${root}`);
  }
  const topLevel = git(root, ['rev-parse', '--show-toplevel']);
  if (resolve(topLevel) !== resolve(root)) {
    throw new Error(`Performance root must be the Git repository root: ${root}`);
  }
}

function gitOutput(root, args, options = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Git command failed (${args[0]}): ${detail}`);
  }
}

function git(root, args, options = {}) {
  return gitOutput(root, args, options).trim();
}

function resolveBaselineCommit(root, revision) {
  if (!isSafeRevisionName(revision)) {
    throw new Error(`Invalid baseline revision: ${revision}`);
  }
  let commit;
  try {
    commit = execFileSync('git', [
      '-C', root, 'rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Unable to resolve baseline revision "${revision}" to a Git commit: ${detail}`);
  }
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new Error(`Baseline revision did not resolve to a full Git commit: ${revision}`);
  }
  return commit;
}

function repositoryMetadata(root) {
  const status = git(root, ['status', '--porcelain', '--untracked-files=all']);
  return {
    root,
    sha: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['branch', '--show-current']),
    clean: status === '',
  };
}

// Guard dirty and untracked sources too, not just HEAD or git diff. Checks run
// outside timing, before/after each child pass and before/after trajectory work.
export function sourceFingerprint(root) {
  const hash = createHash('sha256');
  function visit(path) {
    const absolute = resolve(root, path);
    hash.update(JSON.stringify(path));
    if (!existsSync(absolute)) { hash.update('missing'); return; }
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Source guard does not accept symlinks: ${path}`);
    if (stat.isDirectory()) {
      hash.update('directory');
      for (const entry of readdirSync(absolute).sort()) visit(`${path}/${entry}`);
    } else {
      hash.update(createHash('sha256').update(readFileSync(absolute)).digest());
    }
  }
  for (const path of ['src', 'scripts', 'package.json', 'package-lock.json']) visit(path);
  return hash.digest('hex');
}

export function assertSourceFingerprint(root, expected) {
  if (sourceFingerprint(root) !== expected) throw new Error('Profile source changed during measurement; discard all samples');
}

export function runIsolatedSample(request, {
  workerURL = new URL('./profile-performance-worker.mjs', import.meta.url),
  timeoutMilliseconds = SAMPLE_TIMEOUT_MILLISECONDS,
} = {}) {
  return new Promise((resolveSample, reject) => {
    const env = { ...process.env };
    // Do not inherit inspector/preload/profiler/coverage or Vitest Node flags.
    delete env.NODE_OPTIONS;
    delete env.NODE_V8_COVERAGE;
    const launchedAtMilliseconds = performance.now();
    const child = fork(fileURLToPath(workerURL), [], {
      execPath: process.execPath, execArgv: [], env,
      serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const messages = [];
    let stderr = '';
    let failure;
    let killTimer;
    function stop(error) {
      failure ||= error;
      child.kill('SIGTERM');
      killTimer ||= setTimeout(() => child.kill('SIGKILL'), 1_000);
    }
    const timer = setTimeout(() => stop(new Error(`Sample child timed out after ${timeoutMilliseconds}ms`)), timeoutMilliseconds);
    // Drain output; IPC is the only result channel, and success requires exit 0.
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); });
    child.on('message', message => {
      messages.push(message);
      if (messages.length > 1) stop(new Error('Sample child sent multiple protocol results'));
    });
    child.on('error', stop);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const closedAtMilliseconds = performance.now();
      const message = messages[0];
      if (!failure && (code !== 0 || signal)) {
        failure = new Error(`Sample child exit ${code} (${signal || 'no signal'}): ${message?.error || stderr.trim()}`);
      }
      const result = message?.result;
      if (!failure && (messages.length !== 1 || message?.type !== 'sample'
        || result?.side !== request.side || result?.provenance?.pid !== child.pid
        || result?.provenance?.execPath !== process.execPath
        || JSON.stringify(result?.provenance?.execArgv) !== '[]'
        || result?.provenance?.sourceFingerprint !== request.sourceFingerprint
        || !Number.isFinite(result?.totalCpuMilliseconds)
        || !Array.isArray(result?.tickTimingsMilliseconds)
        || result.tickTimingsMilliseconds.length !== request.ticks
        || typeof result?.gameplayDigest !== 'string' || !result?.projection)) {
        failure = new Error('Sample child returned a missing or invalid protocol result');
      }
      if (failure) {
        failure.pid = child.pid;
        reject(failure);
      } else {
        result.provenance.launchedAtMilliseconds = launchedAtMilliseconds;
        result.provenance.closedAtMilliseconds = closedAtMilliseconds;
        resolveSample(result);
      }
    });
    child.send(request, error => { if (error) stop(error); });
  });
}

export async function executeSample(request, signal) {
  const { root, side, baselineCommit, warmups, sourceFingerprint: fingerprint } = request;
  if (!['baseline', 'candidate'].includes(side)) throw new Error('Invalid sample side');
  validateOptions({ root, modes: [request.mode], speeds: [request.speed], ticks: request.ticks, runs: 1, warmups });
  if (side === 'baseline' && !/^[0-9a-f]{40,64}$/i.test(baselineCommit)) throw new Error('Sample requires resolved baseline commit');
  const passes = [];
  let measured;
  for (let index = 0; index <= warmups; index += 1) {
    signal?.throwIfAborted();
    assertSourceFingerprint(root, fingerprint);
    const result = await withFreshSimulationContext({ root, side, baselineCommit }, context => {
      signal?.throwIfAborted();
      return runScenario(context, request);
    });
    assertSourceFingerprint(root, fingerprint);
    signal?.throwIfAborted();
    if (result.invariantFailures || result.expansionBudget.overBudgetBatches || result.unsafeActors.length) {
      throw new Error(`Unsafe ${side} sample pass ${index + 1}`);
    }
    if (passes.length && passes[0].gameplayDigest !== result.gameplayDigest) {
      throw new Error(`Non-deterministic ${side} warmup/measured sample`);
    }
    passes.push({ kind: index < warmups ? 'warmup' : 'measured', side, graphIndex: index + 1, gameplayDigest: result.gameplayDigest });
    measured = result;
  }
  return {
    ...measured,
    provenance: { pid: process.pid, execPath: process.execPath, execArgv: process.execArgv, sourceFingerprint: fingerprint, warmups, passes },
  };
}

const BASELINE_VIRTUAL_PREFIX = '\0restaurant-mayhem-baseline:';
const BASELINE_SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json'];

export function createGitTreeSourcePlugin({ root, treePaths, readSource, revision = 'baseline' }) {
  if (typeof root !== 'string' || !Array.isArray(treePaths) || typeof readSource !== 'function') {
    throw new Error('A Git tree, root and source reader are required');
  }
  const sourceRoot = resolve(root, 'src');
  const trackedPaths = new Set(treePaths.map(path => path.replaceAll('\\', '/')));

  function resolveTreePath(path) {
    const normalized = pathPosix.normalize(path).replace(/^\.\//, '');
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/')) return null;
    const extension = pathPosix.extname(normalized);
    if (extension && !BASELINE_SOURCE_EXTENSIONS.includes(extension)) return null;
    const candidates = extension ? [normalized] : [
      normalized,
      ...BASELINE_SOURCE_EXTENSIONS.map(candidate => `${normalized}${candidate}`),
      ...BASELINE_SOURCE_EXTENSIONS.map(candidate => pathPosix.join(normalized, `index${candidate}`)),
    ];
    return candidates.find(candidate => trackedPaths.has(candidate)) || null;
  }

  function parseSpecifier(source, importer) {
    const suffixStart = source.search(/[?#]/);
    const specifier = suffixStart === -1 ? source : source.slice(0, suffixStart);
    const suffix = suffixStart === -1 ? '' : source.slice(suffixStart);
    let target;
    let baselineRelativeImport = false;

    if (specifier === '/src' || specifier.startsWith('/src/')) {
      target = specifier.slice(1);
    } else if (specifier.startsWith('src/')) {
      target = specifier;
    } else if (specifier.startsWith('/@fs/')) {
      const absolutePath = resolve('/', specifier.slice('/@fs/'.length));
      const localPath = relative(sourceRoot, absolutePath);
      if (localPath === '' || (!localPath.startsWith(`..${sep}`) && localPath !== '..')) {
        target = `src/${localPath.split(sep).join('/')}`;
      }
    } else if (specifier.startsWith('/') && resolve(specifier).startsWith(`${sourceRoot}${sep}`)) {
      target = `src/${relative(sourceRoot, resolve(specifier)).split(sep).join('/')}`;
    } else if (specifier.startsWith('.') && importer?.startsWith(BASELINE_VIRTUAL_PREFIX)) {
      const importerPath = importer.slice(BASELINE_VIRTUAL_PREFIX.length).split(/[?#]/)[0];
      target = pathPosix.normalize(pathPosix.join(pathPosix.dirname(importerPath), specifier));
      baselineRelativeImport = true;
    } else {
      return null;
    }

    return { target, suffix, baselineRelativeImport };
  }

  return {
    name: 'profile-performance-git-tree-source',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.startsWith(BASELINE_VIRTUAL_PREFIX)) return null;
      const request = parseSpecifier(source, importer);
      if (!request) return null;
      const trackedPath = resolveTreePath(request.target);
      if (trackedPath) return `${BASELINE_VIRTUAL_PREFIX}${trackedPath}${request.suffix}`;
      if (request.target?.startsWith('src/')) {
        throw new Error(`Baseline revision ${revision} cannot resolve source import ${source}`);
      }
      if (request.baselineRelativeImport) {
        throw new Error(`Baseline revision ${revision} cannot resolve source import ${source}`);
      }
      return null;
    },
    load(id) {
      if (!id.startsWith(BASELINE_VIRTUAL_PREFIX)) return null;
      const relativePath = id.slice(BASELINE_VIRTUAL_PREFIX.length).split(/[?#]/)[0];
      if (!trackedPaths.has(relativePath)) {
        throw new Error(`Baseline revision ${revision} has no tracked source ${relativePath}`);
      }
      const source = readSource(relativePath);
      if (typeof source !== 'string') throw new Error(`Baseline source ${relativePath} is not text`);
      return source;
    },
  };
}

function gitSourcePlugin(root, commit) {
  const treePaths = gitOutput(root, ['ls-tree', '-r', '-z', '--name-only', commit])
    .split('\0').filter(Boolean);
  const sourceCache = new Map();
  return createGitTreeSourcePlugin({
    root,
    revision: commit,
    treePaths,
    readSource(relativePath) {
      if (!sourceCache.has(relativePath)) {
        sourceCache.set(relativePath, gitOutput(root, ['show', `${commit}:${relativePath}`]));
      }
      return sourceCache.get(relativePath);
    },
  });
}

function hasGitFile(root, commit, path) {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${commit}:${path}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function createSimulationContext({ root, side, baselineCommit }) {
  const { createServer } = await import('vite');
  const plugins = side === 'baseline' ? [gitSourcePlugin(root, baselineCommit)] : [];
  const server = await createServer({
    root,
    configFile: false,
    plugins,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const [initialState, gameLoop, movementPersistence, persistence, fixtureMoves, coordinator, customers] = await Promise.all([
      server.ssrLoadModule('/src/state/initialState.js'),
      server.ssrLoadModule('/src/simulation/gameLoop.js'),
      server.ssrLoadModule('/src/state/movementPersistence.js'),
      server.ssrLoadModule('/src/state/persistence.js'),
      server.ssrLoadModule('/src/state/fixtureMoves.js'),
      server.ssrLoadModule('/src/simulation/navigation/coordinator.js'),
      server.ssrLoadModule('/src/simulation/customers.js'),
    ]);
    const telemetryPath = 'src/simulation/navigation/telemetry.js';
    const telemetryExists = side === 'baseline'
      ? hasGitFile(root, baselineCommit, telemetryPath)
      : existsSync(resolve(root, telemetryPath));
    const telemetry = telemetryExists
      ? await server.ssrLoadModule('/src/simulation/navigation/telemetry.js') : null;
    const captureNavigation = telemetry?.captureNavigation || (run => {
      const started = performance.now();
      const value = run();
      return { value, report: { counters: {}, phases: {}, tickMilliseconds: performance.now() - started } };
    });
    let captureNavigationCalls = 0;
    const countedCaptureNavigation = run => {
      captureNavigationCalls += 1;
      return captureNavigation(run);
    };
    const expansionBudget = coordinator.MAX_EXPANSIONS_PER_TICK;
    if (!Number.isSafeInteger(expansionBudget) || expansionBudget < 1) {
      throw new Error(`${side} source does not export a valid MAX_EXPANSIONS_PER_TICK`);
    }
    return {
      server,
      side,
      createInitialState: initialState.createInitialState,
      runTick: gameLoop.runTick,
      movementSaveSnapshot: movementPersistence.movementSaveSnapshot,
      hydrateState: persistence.hydrateState,
      moveFixtures: fixtureMoves.moveFixtures,
      spawnCustomers: customers.spawnCustomers,
      captureNavigation: countedCaptureNavigation,
      get captureNavigationCalls() { return captureNavigationCalls; },
      expansionBudget,
      telemetryAvailable: Boolean(telemetry),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function withFreshSimulationContext(contextOptions, run) {
  const context = await createSimulationContext(contextOptions);
  try {
    return await run(context);
  } finally {
    await context.server.close();
  }
}

function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, min: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function addCounters(totals, counters) {
  for (const [key, value] of Object.entries(counters || {})) {
    if (Number.isFinite(value)) totals[key] = (totals[key] || 0) + value;
  }
}

function addPhaseTotals(totals, phases) {
  for (const [phase, report] of Object.entries(phases || {})) {
    if (Number.isFinite(report?.milliseconds)) {
      totals[phase] = (totals[phase] || 0) + report.milliseconds;
    }
  }
}

function prepareState(context, mode, speed) {
  let state = context.createInitialState();
  state = { ...state, speed };
  if (mode === 'congested') {
    state = {
      ...state,
      staff: [...state.staff, ...state.staff.map((worker, index) => ({
        ...worker,
        id: `profile-extra-${index}`,
        x: 560 + index * 30,
        y: 500,
        task: null,
        navigationGoal: undefined,
      }))],
    };
  }
  if (mode === 'edited') {
    const moved = context.moveFixtures(state, [{ type: 'table', id: 't1', x: 560, y: 240 }]);
    if (moved === state) throw new Error('Edited workload was rejected; profile would be meaningless');
    state = moved;
  }
  if (mode === 'restored') {
    state = context.hydrateState(context.movementSaveSnapshot(state), context.createInitialState());
  }
  return state;
}

function gameplayDigest(projection) {
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

export function gameplayProjection(snapshot, state) {
  const projection = deterministicProjection(snapshot, state);
  const diagnostics = projection.navigationRuntime?.diagnostics;
  if (!diagnostics) return projection;
  const {
    expansionsThisTick: _expansionsThisTick,
    actorExpansions: _actorExpansions,
    ...gameplayDiagnostics
  } = diagnostics;
  return {
    ...projection,
    navigationRuntime: {
      ...projection.navigationRuntime,
      diagnostics: gameplayDiagnostics,
    },
  };
}

function differenceValue(value) {
  if (value === undefined) return '<undefined>';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return String(value);
  if (serialized.length > 240) return `${serialized.slice(0, 237)}...`;
  return JSON.parse(serialized);
}

function propertyPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

export function firstGameplayDifference(baseline, candidate, path = '$') {
  if (Object.is(baseline, candidate)) return null;
  const baselineIsObject = baseline !== null && typeof baseline === 'object';
  const candidateIsObject = candidate !== null && typeof candidate === 'object';
  if (!baselineIsObject || !candidateIsObject || Array.isArray(baseline) !== Array.isArray(candidate)) {
    return { path, baseline: differenceValue(baseline), candidate: differenceValue(candidate) };
  }

  if (Array.isArray(baseline)) {
    const sharedLength = Math.min(baseline.length, candidate.length);
    for (let index = 0; index < sharedLength; index += 1) {
      const difference = firstGameplayDifference(baseline[index], candidate[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return baseline.length === candidate.length ? null : {
      path: `${path}.length`, baseline: baseline.length, candidate: candidate.length,
    };
  }

  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
  for (const key of keys) {
    const baselineHasKey = Object.hasOwn(baseline, key);
    const candidateHasKey = Object.hasOwn(candidate, key);
    const child = propertyPath(path, key);
    if (baselineHasKey !== candidateHasKey) {
      return {
        path: child,
        baseline: baselineHasKey ? differenceValue(baseline[key]) : '<missing>',
        candidate: candidateHasKey ? differenceValue(candidate[key]) : '<missing>',
      };
    }
    const difference = firstGameplayDifference(baseline[key], candidate[key], child);
    if (difference) return difference;
  }
  return null;
}

export function compareTrajectoryHashes(baselineHashes, candidateHashes) {
  if (!Array.isArray(baselineHashes) || !Array.isArray(candidateHashes)) {
    throw new Error('Trajectory hashes must be arrays');
  }
  const sharedTicks = Math.min(baselineHashes.length, candidateHashes.length);
  for (let tick = 0; tick < sharedTicks; tick += 1) {
    if (baselineHashes[tick] !== candidateHashes[tick]) {
      return {
        equivalent: false,
        comparedTicks: Math.max(baselineHashes.length, candidateHashes.length),
        firstDifference: {
          tick,
          baselineHash: baselineHashes[tick],
          candidateHash: candidateHashes[tick],
        },
      };
    }
  }
  if (baselineHashes.length !== candidateHashes.length) {
    return {
      equivalent: false,
      comparedTicks: Math.max(baselineHashes.length, candidateHashes.length),
      firstDifference: {
        tick: sharedTicks,
        baselineHash: baselineHashes[sharedTicks] ?? null,
        candidateHash: candidateHashes[sharedTicks] ?? null,
      },
    };
  }
  return {
    equivalent: true,
    comparedTicks: sharedTicks,
    firstDifference: null,
  };
}

export async function runScenario(context, { mode, speed, ticks }) {
  const originalRandom = Math.random;
  const tickTimingsMilliseconds = [];
  let invariantFailures = 0;
  let overBudgetBatches = 0;
  let totalExpansions = 0;
  let maxExpansionsPerTick = 0;
  const unsafeActors = new Set();
  let cpu;
  let totalElapsedMilliseconds;
  let state;

  try {
    Math.random = randomSource(RANDOM_SEED);
    state = prepareState(context, mode, speed);
    const cpuStart = process.cpuUsage();
    const elapsedStart = performance.now();
    for (let tick = 0; tick < ticks; tick += 1) {
      const tickStarted = performance.now();
      state = context.runTick(state, {
        gameDt: speed * 2,
        movementDt: speed / 30,
      });
      const tickMilliseconds = performance.now() - tickStarted;
      const diagnostics = state.movementCoordinator?.diagnostics;
      const expansions = diagnostics?.expansionsThisTick ?? 0;
      if (diagnostics?.invariantFailure) invariantFailures += 1;
      if (expansions > context.expansionBudget) overBudgetBatches += 1;
      totalExpansions += expansions;
      maxExpansionsPerTick = Math.max(maxExpansionsPerTick, expansions);
      for (const actor of diagnostics?.unsafeActors || []) unsafeActors.add(String(actor));
      if (state.navigationFault) throw new Error(`Quarantined ${context.side} workload at tick ${tick}`);
      tickTimingsMilliseconds.push(tickMilliseconds);
    }
    totalElapsedMilliseconds = performance.now() - elapsedStart;
    cpu = process.cpuUsage(cpuStart);
  } finally {
    Math.random = originalRandom;
  }

  const totalCpuMilliseconds = (cpu.user + cpu.system) / 1000;
  const snapshot = context.movementSaveSnapshot(state);
  const projection = gameplayProjection(snapshot, state);
  return {
    side: context.side,
    telemetryAvailable: context.telemetryAvailable,
    telemetryEnabled: false,
    telemetryCaptured: false,
    telemetryCaptureCalls: context.captureNavigationCalls,
    totalCpuMilliseconds,
    totalElapsedMilliseconds,
    tickTimingsMilliseconds,
    tickLatencyMilliseconds: distribution(tickTimingsMilliseconds),
    phaseTotalsMilliseconds: null,
    counters: null,
    invariantFailures,
    unsafeActors: [...unsafeActors].sort(),
    expansionBudget: {
      limit: context.expansionBudget,
      totalExpansions,
      maxPerTick: maxExpansionsPerTick,
      overBudgetBatches,
    },
    gameplayDigest: gameplayDigest(projection),
    projection,
  };
}

function firstRepeatedDifference(runResults) {
  if (runResults.length < 2) return null;
  const first = runResults[0];
  for (const compared of runResults.slice(1)) {
    if (compared.gameplayDigest === first.gameplayDigest) continue;
    return {
      firstRun: first.index,
      comparedRun: compared.index,
      difference: firstGameplayDifference(first.projection, compared.projection),
    };
  }
  return null;
}

function publicRunResult(result) {
  const { projection: _projection, ...visible } = result;
  return visible;
}

function summariseSide(runResults) {
  const allTickTimings = runResults.flatMap(result => result.tickTimingsMilliseconds);
  return {
    totalCpuMilliseconds: distribution(runResults.map(result => result.totalCpuMilliseconds)),
    totalElapsedMilliseconds: distribution(runResults.map(result => result.totalElapsedMilliseconds)),
    tickLatencyMilliseconds: distribution(allTickTimings),
    runP95TickMilliseconds: distribution(runResults.map(result => result.tickLatencyMilliseconds.p95)),
    telemetryAvailable: runResults.every(result => result.telemetryAvailable),
    telemetryEnabled: false,
    telemetryCaptured: false,
    telemetryCaptureCalls: runResults.reduce((sum, result) => sum + result.telemetryCaptureCalls, 0),
    phaseTotalsMilliseconds: null,
    counters: null,
    invariantFailures: runResults.reduce((sum, result) => sum + result.invariantFailures, 0),
    unsafeActors: [...new Set(runResults.flatMap(result => result.unsafeActors))].sort(),
    expansionBudget: {
      limit: runResults[0]?.expansionBudget.limit ?? null,
      totalExpansions: runResults.reduce((sum, result) => sum + result.expansionBudget.totalExpansions, 0),
      maxPerTick: Math.max(0, ...runResults.map(result => result.expansionBudget.maxPerTick)),
      overBudgetBatches: runResults.reduce((sum, result) => sum + result.expansionBudget.overBudgetBatches, 0),
    },
  };
}

async function runWorkload({ root, baselineCommit, mode, speed, options, fingerprint }) {
  const sideResults = { baseline: [], candidate: [] };
  const firstOrder = ['baseline', 'candidate'];

  const runs = [];
  for (let index = 0; index < options.runs; index += 1) {
    const order = index % 2 === 0 ? firstOrder : [...firstOrder].reverse();
    const results = {};
    for (const side of order) {
      assertSourceFingerprint(root, fingerprint);
      results[side] = await runIsolatedSample({
        root, side, ...(side === 'baseline' ? { baselineCommit } : {}),
        mode, speed, ticks: options.ticks, warmups: options.warmups, sourceFingerprint: fingerprint,
      });
      assertSourceFingerprint(root, fingerprint);
      sideResults[side].push({ index: index + 1, ...results[side] });
    }
    runs.push({
      index: index + 1,
      order: [...order],
      baseline: publicRunResult(results.baseline),
      candidate: publicRunResult(results.candidate),
      gameplayEquivalent: results.baseline.gameplayDigest === results.candidate.gameplayDigest,
      endpointEquivalent: results.baseline.gameplayDigest === results.candidate.gameplayDigest,
    });
  }

  const baselineRuns = sideResults.baseline;
  const candidateRuns = sideResults.candidate;
  const baselineDeterministic = baselineRuns.every(run => run.gameplayDigest === baselineRuns[0].gameplayDigest);
  const candidateDeterministic = candidateRuns.every(run => run.gameplayDigest === candidateRuns[0].gameplayDigest);
  return {
    mode,
    speed,
    ticks: options.ticks,
    runs,
    summary: {
      baseline: summariseSide(baselineRuns),
      candidate: summariseSide(candidateRuns),
    },
    baselineDeterministic,
    candidateDeterministic,
    baselineDifference: firstRepeatedDifference(baselineRuns),
    candidateDifference: firstRepeatedDifference(candidateRuns),
    endpointEquivalent: runs.every(run => run.endpointEquivalent),
    equivalent: runs.every(run => run.gameplayEquivalent),
  };
}

async function compareWorkloadTrajectory({ root, baselineCommit, mode, speed, ticks }) {
  return withFreshSimulationContext({ root, side: 'baseline', baselineCommit }, baselineContext =>
    withFreshSimulationContext({ root, side: 'candidate' }, candidateContext => {
      const originalRandom = Math.random;
      const baselineHashes = [];
      const candidateHashes = [];
      const baselineCounters = {};
      const candidateCounters = {};
      const baselinePhaseTotalsMilliseconds = {};
      const candidatePhaseTotalsMilliseconds = {};
      const baselineDiagnosticTicksMilliseconds = [];
      const candidateDiagnosticTicksMilliseconds = [];
      let firstProjectionDifference = null;
      let baselineState;
      let candidateState;
      let baselineRandom;
      let candidateRandom;

      try {
        Math.random = randomSource(RANDOM_SEED);
        baselineState = prepareState(baselineContext, mode, speed);
        baselineRandom = Math.random;
        Math.random = randomSource(RANDOM_SEED);
        candidateState = prepareState(candidateContext, mode, speed);
        candidateRandom = Math.random;

        for (let tick = 0; tick < ticks; tick += 1) {
          Math.random = baselineRandom;
          const baselineTick = baselineContext.captureNavigation(() => baselineContext.runTick(baselineState, {
            gameDt: speed * 2,
            movementDt: speed / 30,
          }));
          baselineState = baselineTick.value;
          if (baselineState.navigationFault) {
            throw new Error(`Quarantined baseline trajectory at tick ${tick}`);
          }
          const baselineReport = baselineTick.report || {};
          if (baselineContext.telemetryAvailable) {
            addCounters(baselineCounters, baselineReport.counters);
            addPhaseTotals(baselinePhaseTotalsMilliseconds, baselineReport.phases);
            if (Number.isFinite(baselineReport.tickMilliseconds)) {
              baselineDiagnosticTicksMilliseconds.push(baselineReport.tickMilliseconds);
            }
          }

          Math.random = candidateRandom;
          const candidateTick = candidateContext.captureNavigation(() => candidateContext.runTick(candidateState, {
            gameDt: speed * 2,
            movementDt: speed / 30,
          }));
          candidateState = candidateTick.value;
          if (candidateState.navigationFault) {
            throw new Error(`Quarantined candidate trajectory at tick ${tick}`);
          }
          const candidateReport = candidateTick.report || {};
          if (candidateContext.telemetryAvailable) {
            addCounters(candidateCounters, candidateReport.counters);
            addPhaseTotals(candidatePhaseTotalsMilliseconds, candidateReport.phases);
            if (Number.isFinite(candidateReport.tickMilliseconds)) {
              candidateDiagnosticTicksMilliseconds.push(candidateReport.tickMilliseconds);
            }
          }

          const baselineProjection = gameplayProjection(
            baselineContext.movementSaveSnapshot(baselineState), baselineState,
          );
          const candidateProjection = gameplayProjection(
            candidateContext.movementSaveSnapshot(candidateState), candidateState,
          );
          const baselineHash = gameplayDigest(baselineProjection);
          const candidateHash = gameplayDigest(candidateProjection);
          baselineHashes.push(baselineHash);
          candidateHashes.push(candidateHash);
          if (baselineHash !== candidateHash && firstProjectionDifference === null) {
            firstProjectionDifference = firstGameplayDifference(baselineProjection, candidateProjection);
          }
        }
      } finally {
        Math.random = originalRandom;
      }

      const comparison = compareTrajectoryHashes(baselineHashes, candidateHashes);
      if (comparison.firstDifference && firstProjectionDifference) {
        comparison.firstDifference.projectionDifference = firstProjectionDifference;
      }
      const telemetryDiagnostics = (context, counters, phases, ticksMilliseconds) => ({
        telemetryAvailable: context.telemetryAvailable,
        telemetryEnabled: context.telemetryAvailable,
        telemetryCaptured: context.telemetryAvailable,
        captureNavigationCalls: context.captureNavigationCalls,
        counters: context.telemetryAvailable ? counters : null,
        phaseTotalsMilliseconds: context.telemetryAvailable ? phases : null,
        tickLatencyMilliseconds: context.telemetryAvailable ? distribution(ticksMilliseconds) : null,
      });
      return {
        comparedTicks: comparison.comparedTicks,
        baselineFinalDigest: baselineHashes.at(-1) ?? null,
        candidateFinalDigest: candidateHashes.at(-1) ?? null,
        equivalent: comparison.equivalent,
        firstDifference: comparison.firstDifference,
        diagnostics: {
          source: 'captureNavigation during this separate untimed trajectory pass',
          baseline: telemetryDiagnostics(
            baselineContext,
            baselineCounters,
            baselinePhaseTotalsMilliseconds,
            baselineDiagnosticTicksMilliseconds,
          ),
          candidate: telemetryDiagnostics(
            candidateContext,
            candidateCounters,
            candidatePhaseTotalsMilliseconds,
            candidateDiagnosticTicksMilliseconds,
          ),
        },
      };
    }));
}

export function performanceReportExitCode(report) {
  const failed = !report.deterministic || !report.endpointEquivalent
    || !report.trajectoryEquivalent || report.workloads.some(workload =>
      ['baseline', 'candidate'].some(side => workload.summary[side].invariantFailures > 0
        || workload.summary[side].expansionBudget.overBudgetBatches > 0));
  return failed ? 1 : 0;
}

export async function profilePerformance(rawOptions) {
  const options = validateOptions(rawOptions);
  assertProfileRoot(options.root);
  const baselineCommit = resolveBaselineCommit(options.root, options.baseline);
  const candidate = repositoryMetadata(options.root);
  const fingerprint = sourceFingerprint(options.root);
  candidate.sourceFingerprint = fingerprint;
  const workloads = [];
  for (const mode of options.modes) {
    for (const speed of options.speeds) {
      workloads.push(await runWorkload({
        root: options.root, baselineCommit, mode, speed, options, fingerprint,
      }));
    }
  }
  // Run trajectory checks only after all timing samples so validation work cannot affect them.
  for (const workload of workloads) {
    assertSourceFingerprint(options.root, fingerprint);
    workload.trajectory = await compareWorkloadTrajectory({
      root: options.root,
      baselineCommit,
      mode: workload.mode,
      speed: workload.speed,
      ticks: options.ticks,
    });
    workload.trajectoryEquivalent = workload.trajectory.equivalent;
    workload.equivalent = workload.endpointEquivalent && workload.trajectoryEquivalent;
    assertSourceFingerprint(options.root, fingerprint);
  }
  const endpointEquivalent = workloads.every(workload => workload.endpointEquivalent);
  const trajectoryEquivalent = workloads.every(workload => workload.trajectoryEquivalent);
  return {
    options,
    node: process.version,
    baseline: { revision: options.baseline, commit: baselineCommit },
    candidate,
    sequentialMeasurements: true,
    measurementIsolation: {
      kind: 'fresh-node-child-per-sample', execPath: process.execPath, execArgv: [],
      environment: 'inherited identically except NODE_OPTIONS and NODE_V8_COVERAGE removed',
      timeoutMilliseconds: SAMPLE_TIMEOUT_MILLISECONDS,
      sourceGuard: 'SHA-256 of all src/ and scripts/ files plus package.json/package-lock.json before/after every child pass, sample and trajectory',
      timing: 'child process.cpuUsage over runScenario tick loop including existing per-tick diagnostics; excludes state setup, SSR loading/closing, warmups, projection and IPC',
      limitation: 'process CPU includes background runtime work during the tick interval; fresh children isolate revision history, not host noise',
    },
    orderBalance: {
      balanced: options.runs % 2 === 0,
      baselineFirst: Math.ceil(options.runs / 2), candidateFirst: Math.floor(options.runs / 2),
      scope: 'paired order per workload: AB, BA, repeated; counts are pairs, no extra samples',
    },
    warnings: options.runs % 2 ? ['Odd --runs produces order imbalance: baseline is first once more per workload; use an even count (default 4) for balanced AB/BA.'] : [],
    warmupPolicy: {
      passesPerSample: options.warmups,
      process: 'each child warms only its own revision/workload before one measured pass; never loads the other revision',
      moduleGraphs: 'fresh Vite SSR graph per warm-up and measured pass; module state is discarded',
    },
    comparisonScope: {
      endpoint: 'final gameplay projection of each measured run',
      trajectory: 'every per-tick gameplay projection in a separate untimed pass',
      timingIncludesTrajectory: false,
      primaryTimingTelemetryEnabled: false,
      diagnosticTelemetry: 'captured only during the separate untimed trajectory pass',
    },
    deterministic: workloads.every(workload => workload.baselineDeterministic
      && workload.candidateDeterministic),
    endpointEquivalent,
    trajectoryEquivalent,
    equivalent: endpointEquivalent && trajectoryEquivalent,
    workloads,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await profilePerformance(parsePerformanceArguments(process.argv.slice(2)));
    for (const warning of report.warnings) console.error(`Warning: ${warning}`);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = performanceReportExitCode(report);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
