import { useState } from 'react';
import { GameProvider } from './state/GameContext';
import SimulationRuntime from './state/SimulationRuntime';
import RestaurantCanvas from './canvas/RestaurantCanvas';
import StatsBar from './components/StatsBar';
import BookIcon from './components/BookIcon';
import MenuIcon from './components/MenuIcon';
import SettingsMenu from './components/SettingsMenu';
import SpeedControls from './components/SpeedControls';
import Toast from './components/Toast';
import ManagementModal from './panels/ManagementModal';
import MenuModal from './panels/MenuModal';

function AppInner() {
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
    setModalOpen(false);
    setPlacementRequest(typeof request === 'string' ? { itemType: request } : request);
  };

  return (
    <div className="app">
      <StatsBar />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <RestaurantCanvas
          managementOpen={modalOpen || menuOpen || settingsOpen}
          fitRequest={fitRequest}
          placementRequest={placementRequest}
          onPlacementComplete={() => setPlacementRequest(null)}
          onEmptySpaceClick={closeTopLevelMenus}
        />
        <BookIcon
          onClick={() => {
            setMenuOpen(false);
            setSettingsOpen(false);
            setModalOpen(v => !v);
          }}
          isOpen={modalOpen}
        />
        <MenuIcon
          onClick={() => {
            setModalOpen(false);
            setSettingsOpen(false);
            setMenuOpen(v => !v);
          }}
          isOpen={menuOpen}
        />
        <SettingsMenu
          isOpen={settingsOpen}
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
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onStartPlacement={startPlacement}
      />
      <MenuModal isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
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
