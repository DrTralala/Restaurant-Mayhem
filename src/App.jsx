import { useState } from 'react';
import { GameProvider } from './state/GameContext';
import SimulationRuntime from './state/SimulationRuntime';
import RestaurantCanvas from './canvas/RestaurantCanvas';
import StatsBar from './components/StatsBar';
import BookIcon from './components/BookIcon';
import SettingsMenu from './components/SettingsMenu';
import SpeedControls from './components/SpeedControls';
import Toast from './components/Toast';
import ManagementModal from './panels/ManagementModal';

function AppInner() {
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [placementRequest, setPlacementRequest] = useState(null);
  const closeTopLevelMenus = () => {
    setModalOpen(false);
    setSettingsOpen(false);
  };
  const startPlacement = request => {
    setModalOpen(false);
    setPlacementRequest(typeof request === 'string' ? { itemType: request } : request);
  };

  return (
    <div className="app">
      <StatsBar />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <RestaurantCanvas
          managementOpen={modalOpen || settingsOpen}
          fitRequest={fitRequest}
          placementRequest={placementRequest}
          onPlacementComplete={() => setPlacementRequest(null)}
          onEmptySpaceClick={closeTopLevelMenus}
        />
        <BookIcon
          onClick={() => {
            setSettingsOpen(false);
            setModalOpen(v => !v);
          }}
          isOpen={modalOpen}
        />
        <SettingsMenu
          isOpen={settingsOpen}
          onToggle={() => {
            setModalOpen(false);
            setSettingsOpen(v => !v);
          }}
          onClose={closeTopLevelMenus}
        />
      </div>
      <SpeedControls onFit={() => setFitRequest(request => request + 1)} />
      <ManagementModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onStartPlacement={startPlacement}
      />
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
