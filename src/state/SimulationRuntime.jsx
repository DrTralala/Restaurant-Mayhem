import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { advanceFixedStep } from '../simulation/fixedStep';
import { runTick } from '../simulation/gameLoop';
import { interpolateSimulationState } from '../canvas/interpolation';
import { useDispatch, useGameGeneration, useGameState } from './GameContext';
import { TYPOGRAPHY } from '../typography';
import { useAnimationFrameLoop } from '../hooks/useAnimationFrameLoop';

const RenderStateContext = createContext(null);
const RuntimeFaultContext = createContext({ fault: null, reportFault: () => {} });

export function useRuntimeFault() {
  return useContext(RuntimeFaultContext);
}

export function useRenderState() {
  return useContext(RenderStateContext) || useGameState();
}

export default function SimulationRuntime({ children }) {
  const state = useGameState();
  const dispatch = useDispatch();
  const generation = useGameGeneration();
  const canonicalRef = useRef(state);
  const previousRef = useRef(state);
  const accumulatorRef = useRef(0);
  const lastTimestampRef = useRef(null);
  const lastRuntimeStateRef = useRef(null);
  const [renderState, setRenderState] = useState(state);
  const faultRef = useRef(null);
  const [fault, setFault] = useState(null);

  const reportFault = useCallback((error, phase) => {
    if (faultRef.current) return;
    const detail = { phase, gameTime: canonicalRef.current.restaurant?.gameTime,
      speed: canonicalRef.current.speed };
    faultRef.current = detail;
    setFault(detail);
    // Keep the original Error (including its stack), not the entire game/save.
    console.error('Restaurant runtime stopped', detail, error);
  }, []);
  const faultContext = useMemo(() => ({ fault, reportFault }), [fault, reportFault]);

  useLayoutEffect(() => {
    faultRef.current = null;
    setFault(null);
    lastRuntimeStateRef.current = null;
  }, [generation]);

  useLayoutEffect(() => {
    canonicalRef.current = state;
    if (state !== lastRuntimeStateRef.current) {
      previousRef.current = state;
      accumulatorRef.current = 0;
      lastTimestampRef.current = null;
      setRenderState(state);
    }
  }, [state, generation]);

  useAnimationFrameLoop(timestamp => {
    let phase = 'simulation';
    try {
      if (faultRef.current) return false;

      const previousTimestamp = lastTimestampRef.current;
      lastTimestampRef.current = timestamp;
      const elapsedSeconds = previousTimestamp == null
        ? 0
        : (timestamp - previousTimestamp) / 1000;

      const result = advanceFixedStep({
        state: canonicalRef.current,
        previousState: previousRef.current,
        accumulator: accumulatorRef.current,
        elapsedSeconds,
      }, runTick, { now: () => performance.now(), maxWorkMs: 8 });

      phase = 'interpolation';
      const interpolated = interpolateSimulationState(
        result.previousState,
        result.state,
        result.alpha,
      );

      canonicalRef.current = result.state;
      previousRef.current = result.previousState;
      accumulatorRef.current = result.accumulator;
      if (result.steps > 0) {
        lastRuntimeStateRef.current = result.state;
        dispatch({ type: 'TICK', nextState: result.state });
      }
      setRenderState(interpolated);
      return true;
    } catch (error) {
      reportFault(error, phase);
      return false;
    }
  }, { enabled: !fault });

  return <RuntimeFaultContext.Provider value={faultContext}>
    <RenderStateContext.Provider value={renderState}>
      {children}
      {fault && <div role="alert" style={{
        position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)',
        zIndex: 200, maxWidth: '90vw', padding: '12px 20px', borderRadius: 8,
        ...TYPOGRAPHY.secondary, background: '#8b2525', color: '#fff',
      }}>
        Gameplay stopped after a {fault.phase} error. Open Settings to start a new game
        {' '}or load a saved game. Error details are in the browser console.
      </div>}
    </RenderStateContext.Provider>
  </RuntimeFaultContext.Provider>;
}
