let active = null;

export function noteNavigation(key, value = 1) {
  if (!active) return;
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid navigation metric ${key}`);
  active.counters[key] = (active.counters[key] || 0) + value;
  const bucket = active.phases[active.phase] ||= { counters: {}, milliseconds: 0 };
  bucket.counters[key] = (bucket.counters[key] || 0) + value;
}

export function navigationPhase(name, run) {
  if (!active) return run();
  const capture = active;
  const prior = capture.phase;
  capture.phase = name;
  const start = performance.now();
  try { return run(); } finally {
    const bucket = capture.phases[name] ||= { counters: {}, milliseconds: 0 };
    bucket.milliseconds += performance.now() - start;
    capture.phase = prior;
  }
}

export function captureNavigation(run) {
  if (active) throw new Error('Navigation captures cannot be nested');
  const capture = { phase: 'tick', counters: {}, phases: {} };
  active = capture;
  const start = performance.now();
  try {
    const value = run();
    const totalExpansions = (capture.counters.routeExpansions || 0)
      + (capture.counters.localExpansions || 0) + (capture.counters.yieldExpansions || 0);
    return { value, report: { counters: { ...capture.counters, totalExpansions },
      phases: capture.phases, tickMilliseconds: performance.now() - start } };
  } finally { active = null; }
}
