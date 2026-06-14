import { useState, useEffect, useRef } from 'react';
import { GameProvider, useGameState, useDispatch } from './state/GameContext';
import { runTick } from './simulation/gameLoop';
import RestaurantCanvas from './canvas/RestaurantCanvas';
import StatsBar from './components/StatsBar';
import BookIcon from './components/BookIcon';
import SpeedControls from './components/SpeedControls';
import Toast from './components/Toast';
import ManagementModal from './panels/ManagementModal';

function GameLoopEngine() {
  const state = useGameState();
  const dispatch = useDispatch();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let lastTime = performance.now();
    let animId;

    function loop(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const current = stateRef.current;
      if (current && !current.paused) {
        const nextState = runTick(current, dt);
        if (nextState !== current) {
          dispatch({ type: 'TICK', nextState });
        }
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [dispatch]);

  return null;
}

function AppInner() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="app">
      <GameLoopEngine />
      <StatsBar />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <RestaurantCanvas />
        <BookIcon onClick={() => setModalOpen(v => !v)} isOpen={modalOpen} />
      </div>
      <SpeedControls />
      <ManagementModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <AppInner />
    </GameProvider>
  );
}
