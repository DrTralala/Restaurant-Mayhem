import { useEffect, useRef, useState } from 'react';
import { GameProvider, useDispatch, useGameGeneration, useGameState } from './state/GameContext';
import SimulationRuntime, { useRuntimeFault } from './state/SimulationRuntime';
import RestaurantCanvas from './canvas/RestaurantCanvas';
import StatsBar from './components/StatsBar';
import BookIcon from './components/BookIcon';
import MenuIcon from './components/MenuIcon';
import SettingsMenu from './components/SettingsMenu';
import SpeedControls from './components/SpeedControls';
import Toast from './components/Toast';
import ManagementModal from './panels/ManagementModal';
import MenuModal from './panels/MenuModal';
import CareerResultDialog from './components/CareerResultDialog';
import { getCareerSummary, isCareerDecisionPending } from './simulation/careerRun';

function AppInner() {
  const generation = useGameGeneration();
  return <AppSession key={generation} />;
}

function AppSession() {
  const state = useGameState();
  const dispatch = useDispatch();
  const { fault } = useRuntimeFault();
  const decisionPending = isCareerDecisionPending(state);
  const summary = getCareerSummary(state.careerRun, state.restaurant);
  const managementEntry = useRef(null);
  const restoreEntry = useRef(false);
  const [managementTab, setManagementTab] = useState('upgrades');
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [placementRequest, setPlacementRequest] = useState(null);
  const closeTopLevelMenus = () => {
    setModalOpen(false);
    setMenuOpen(false);
    setSettingsOpen(false);
  };
  const startPlacement = request => {
    if (decisionPending) return;
    setModalOpen(false);
    setPlacementRequest(typeof request === 'string' ? { itemType: request } : request);
  };
  useEffect(() => {
    if (!decisionPending && restoreEntry.current) {
      restoreEntry.current = false;
      managementEntry.current?.querySelector('button')?.focus();
    }
    if (decisionPending) {
      setModalOpen(false);
      setMenuOpen(false);
      setPlacementRequest(null);
    }
  }, [decisionPending]);
  const openManagement = tab => {
    if (decisionPending) { setSettingsOpen(false); return; }
    setManagementTab(tab);
    setModalOpen(true);
    setMenuOpen(false);
    setSettingsOpen(false);
  };
  const startCareer = () => {
    if (!window.confirm('Start Opening Week? This replaces your current restaurant and its local autosave. '
      + 'No backup is created. Repository Save game is available only on the development server; '
      + 'if available, cancel and save first to keep a separate copy. Cancel keeps this restaurant.')) return;
    dispatch({ type: 'START_CAREER', scenarioId: 'opening-week', runId: crypto.randomUUID(), confirmedReplace: true });
  };
  const blockedReason = fault ? 'A technical error still requires Settings recovery.'
    : state.navigationFault ? 'Layout conflicts still require recovery; automatic saving is disabled.'
      : state.paused ? 'Your ordinary pause setting is still enabled.' : null;

  return (
    <div className="app">
      <StatsBar onOpenCareer={() => openManagement('career')} onOpenContracts={() => openManagement('contracts')} />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', transform: 'translateZ(0)' }}>
        <div inert={decisionPending ? '' : undefined}
          style={{ position: 'absolute', inset: 0, pointerEvents: decisionPending ? 'none' : 'auto' }}>
          <RestaurantCanvas
            managementOpen={modalOpen || menuOpen || settingsOpen || decisionPending}
            fitRequest={fitRequest}
            placementRequest={decisionPending ? null : placementRequest}
            onPlacementComplete={() => setPlacementRequest(null)}
            onEmptySpaceClick={closeTopLevelMenus}
          />
        </div>
        <MenuIcon
          onClick={() => {
            if (decisionPending) return;
            setModalOpen(false);
            setSettingsOpen(false);
            setMenuOpen(v => !v);
          }}
          isOpen={menuOpen}
        />
        <div ref={managementEntry}><BookIcon
          onClick={() => {
            if (decisionPending) return;
            setMenuOpen(false);
            setSettingsOpen(false);
            setModalOpen(v => !v);
          }}
          isOpen={modalOpen}
        /></div>
        <SettingsMenu
          isOpen={settingsOpen}
          modal={decisionPending}
          onToggle={() => {
            setModalOpen(false);
            setMenuOpen(false);
            setSettingsOpen(v => !v);
          }}
          onClose={closeTopLevelMenus}
        />
      </div>
      <SpeedControls onFit={() => setFitRequest(request => request + 1)} />
      <ManagementModal
        isOpen={modalOpen && !decisionPending}
        onClose={() => setModalOpen(false)}
        onStartPlacement={startPlacement}
        initialTab={managementTab}
        onStartCareer={startCareer}
        onShowCareerResult={() => setSettingsOpen(false)}
      />
      <MenuModal isOpen={menuOpen && !decisionPending} onClose={() => setMenuOpen(false)} />
      {!settingsOpen && <CareerResultDialog summary={summary} blockedReason={blockedReason}
        onStartNew={startCareer}
        onRetry={() => dispatch({ type: 'RETRY_CAREER', expectedRunId: state.careerRun.runId,
          runId: crypto.randomUUID(), confirmedReplace: true })}
        onContinue={() => {
          restoreEntry.current = true;
          dispatch({ type: 'CONTINUE_CAREER_AS_SANDBOX', expectedRunId: state.careerRun.runId });
        }}
        onOpenSettings={() => { setSettingsOpen(true); setModalOpen(false); setMenuOpen(false); }} />}
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <SimulationRuntime>
        <AppInner />
      </SimulationRuntime>
    </GameProvider>
  );
}
