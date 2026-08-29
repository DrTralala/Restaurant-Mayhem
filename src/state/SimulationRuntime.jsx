import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { advanceFixedStep } from '../simulation/fixedStep';
import { runTick } from '../simulation/gameLoop';
import { interpolateSimulationState } from '../canvas/interpolation';
import { useDispatch, useGameState } from './GameContext';

const RenderStateContext = createContext(null);

export function useRenderState() {
  return useContext(RenderStateContext) || useGameState();
}

export default function SimulationRuntime({ children }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const canonicalRef = useRef(state);
  const previousRef = useRef(state);
  const accumulatorRef = useRef(0);
  const lastTimestampRef = useRef(null);
  const lastRuntimeStateRef = useRef(null);
  const [renderState, setRenderState] = useState(state);

  useEffect(() => {
    canonicalRef.current = state;
    if (state !== lastRuntimeStateRef.current) {
      previousRef.current = state;
      accumulatorRef.current = 0;
      lastTimestampRef.current = null;
      setRenderState(state);
    }
  }, [state]);

  useEffect(() => {
    let frameId;
    const frame = timestamp => {
      const previousTimestamp = lastTimestampRef.current;
      lastTimestampRef.current = timestamp;
      const elapsedSeconds = previousTimestamp == null ? 0 : (timestamp - previousTimestamp) / 1000;
      const result = advanceFixedStep({
        state: canonicalRef.current,
        previousState: previousRef.current,
        accumulator: accumulatorRef.current,
        elapsedSeconds,
      }, runTick);

      canonicalRef.current = result.state;
      previousRef.current = result.previousState;
      accumulatorRef.current = result.accumulator;
      if (result.steps > 0) {
        lastRuntimeStateRef.current = result.state;
        dispatch({ type: 'TICK', nextState: result.state });
      }
      setRenderState(interpolateSimulationState(result.previousState, result.state, result.alpha));
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [dispatch]);

  return <RenderStateContext.Provider value={renderState}>{children}</RenderStateContext.Provider>;
}
