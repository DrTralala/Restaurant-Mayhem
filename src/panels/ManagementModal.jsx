import { useEffect, useRef, useState } from 'react';
import UpgradePanel from './UpgradePanel';
import ItemsPanel from './ItemsPanel';
import StaffPanel from './StaffPanel';
import MilestonePanel from './MilestonePanel';
import StatsPanel from './StatsPanel';
import HoursPanel from './HoursPanel';
import ServiceContractsPanel from './ServiceContractsPanel';
import CareerPanel from './CareerPanel';
import { TYPOGRAPHY } from '../typography';
import { useGameState, useDispatch } from '../state/GameContext';
import { isCareerDecisionPending } from '../simulation/careerRun';
import useDialogKeyboardFocus from '../components/useDialogKeyboardFocus';

const TABS = [
  { key: 'upgrades', label: 'Upgrades' },
  { key: 'items', label: 'Items' },
  { key: 'staff', label: 'Staff' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'stats', label: 'Stats' },
  { key: 'hours', label: 'Hours' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'career', label: 'Opening Week' },
];

export default function ManagementModal({ isOpen, onClose, onStartPlacement,
  initialTab = 'upgrades', onStartCareer, onShowCareerResult,
  onLocateStaff, locateDisabled = false, locateMessage = '' }) {
  const [tab, setTab] = useState(initialTab);
  const state = useGameState();
  const dispatch = useDispatch();
  const decisionPending = isCareerDecisionPending(state);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  useEffect(() => { if (isOpen) setTab(initialTab); }, [isOpen, initialTab]);
  useDialogKeyboardFocus({
    isOpen,
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
      }} onClick={onClose} />

      <div ref={dialogRef} role="dialog" aria-modal="true"
        aria-label="Restaurant management" tabIndex={-1} style={{
          position: 'relative', width: '90%', maxWidth: 700, maxHeight: '80vh',
          background: '#16213e', borderRadius: 12, border: '1px solid #0f3460',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...TYPOGRAPHY.body,
        }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
          padding: '12px 16px', borderBottom: '1px solid #0f3460',
        }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                style={{
                  ...TYPOGRAPHY.control,
                  background: tab === t.key ? '#f0a500' : 'transparent',
                  color: tab === t.key ? '#111' : '#ccc',
                  border: 'none', padding: '6px 14px', borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <button
              disabled={decisionPending}
              onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })}
              style={{
                ...TYPOGRAPHY.control,
                background: '#333', border: '1px solid #555', borderRadius: 4,
                color: '#ccc', padding: '4px 12px', cursor: 'pointer',
              }}
            >
              {state.paused ? 'Resume game' : 'Pause game'}
            </button>
            <button ref={closeButtonRef} type="button" aria-label="Close management" onClick={onClose} style={{
              ...TYPOGRAPHY.icon,
              background: 'none', border: 'none', color: '#888',
              cursor: 'pointer',
            }}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'upgrades' && <UpgradePanel onStartPlacement={onStartPlacement} />}
          {tab === 'items' && <ItemsPanel onStartPlacement={onStartPlacement} />}
          {tab === 'staff' && (
            <StaffPanel
              onLocateStaff={onLocateStaff}
              locateDisabled={locateDisabled}
              locateMessage={locateMessage}
            />
          )}
          {tab === 'milestones' && <MilestonePanel />}
          {tab === 'stats' && <StatsPanel />}
          {tab === 'hours' && <HoursPanel />}
          {tab === 'contracts' && <ServiceContractsPanel />}
          {tab === 'career' && <CareerPanel onStartRequested={onStartCareer} onShowResult={onShowCareerResult} />}
        </div>
      </div>
    </div>
  );
}
