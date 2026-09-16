import { useEffect, useLayoutEffect, useRef } from 'react';

export function useAnimationFrameLoop(callback, { enabled = true } = {}) {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;

    let active = true;
    let frameId = null;

    const frame = timestamp => {
      if (!active) return;
      const keepRunning = callbackRef.current(timestamp);
      if (active && keepRunning !== false) {
        frameId = requestAnimationFrame(frame);
      }
    };

    frameId = requestAnimationFrame(frame);

    return () => {
      active = false;
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, [enabled]);
}
