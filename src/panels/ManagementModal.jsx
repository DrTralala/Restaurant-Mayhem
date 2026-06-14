import { useState } from 'react';

function MenuPanel() {
  return <div style={{ color: '#ccc', fontFamily: 'monospace' }}><p>Menu panel — coming soon</p></div>;
}
function UpgradePanel() {
  return <div style={{ color: '#ccc', fontFamily: 'monospace' }}><p>Upgrades panel — coming soon</p></div>;
}
function StaffPanel() {
  return <div style={{ color: '#ccc', fontFamily: 'monospace' }}><p>Staff panel — coming soon</p></div>;
}
function MilestonePanel() {
  return <div style={{ color: '#ccc', fontFamily: 'monospace' }}><p>Milestones panel — coming soon</p></div>;
}
function StatsPanel() {
  return <div style={{ color: '#ccc', fontFamily: 'monospace' }}><p>Stats panel — coming soon</p></div>;
}

const TABS = [
  { key: 'menu', label: 'Menu' },
  { key: 'upgrades', label: 'Upgrades' },
  { key: 'staff', label: 'Staff' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'stats', label: 'Stats' },
];

export default function ManagementModal({ isOpen, onClose }) {
  const [tab, setTab] = useState('menu');

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
      }} onClick={onClose} />

      <div style={{
        position: 'relative', width: '90%', maxWidth: 700, maxHeight: '80vh',
        background: '#16213e', borderRadius: 12, border: '1px solid #0f3460',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderBottom: '1px solid #0f3460',
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  background: tab === t.key ? '#f0a500' : 'transparent',
                  color: tab === t.key ? '#111' : '#ccc',
                  border: 'none', padding: '6px 14px', borderRadius: 4,
                  cursor: 'pointer', fontSize: '13px', fontFamily: 'monospace',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888',
            fontSize: '18px', cursor: 'pointer',
          }}>
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'menu' && <MenuPanel />}
          {tab === 'upgrades' && <UpgradePanel />}
          {tab === 'staff' && <StaffPanel />}
          {tab === 'milestones' && <MilestonePanel />}
          {tab === 'stats' && <StatsPanel />}
        </div>
      </div>
    </div>
  );
}
