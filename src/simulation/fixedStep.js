export const FIXED_STEP_SECONDS = 1 / 30;
export const MAX_FRAME_SECONDS = 0.25;
export const MAX_CATCH_UP_STEPS = 8;

export function normaliseSpeed(value) {
  return [1, 2, 4].includes(value) ? value : 1;
}

function boundedElapsed(value) {
  return Number.isFinite(value) ? Math.min(MAX_FRAME_SECONDS, Math.max(0, value)) : 0;
}

export function advanceFixedStep(frame, runStep, { now = null, maxWorkMs = Infinity } = {}) {
  const initial = frame.state;
  if (initial.paused) {
    return { state: initial, previousState: initial, accumulator: 0, alpha: 0, steps: 0 };
  }

  const speed = normaliseSpeed(initial.speed);
  const startedAt = now && Number.isFinite(maxWorkMs) ? now() : null;
  let accumulator = Math.max(0, Number(frame.accumulator) || 0) + boundedElapsed(frame.elapsedSeconds);
  let current = initial;
  let previous = frame.previousState || initial;
  let steps = 0;
  let workLimitReached = false;

  while (accumulator + Number.EPSILON >= FIXED_STEP_SECONDS && steps < MAX_CATCH_UP_STEPS) {
    previous = current;
    current = runStep(current, {
      movementDt: FIXED_STEP_SECONDS * speed,
      gameDt: FIXED_STEP_SECONDS * speed * 60,
    });
    accumulator -= FIXED_STEP_SECONDS;
    steps += 1;
    if (startedAt !== null && now() - startedAt >= maxWorkMs) {
      workLimitReached = true;
      break;
    }
  }

  // Slow down under sustained load instead of carrying a growing catch-up debt.
  // Only frame scheduling uses wall time; each completed simulation tick is unchanged.
  if ((workLimitReached || steps === MAX_CATCH_UP_STEPS) && accumulator >= FIXED_STEP_SECONDS) {
    accumulator %= FIXED_STEP_SECONDS;
  }

  return {
    state: current,
    previousState: previous,
    accumulator: Math.max(0, accumulator),
    alpha: Math.min(1, Math.max(0, accumulator / FIXED_STEP_SECONDS)),
    steps,
  };
}
