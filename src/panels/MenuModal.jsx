import MenuPanel from './MenuPanel';

export default function MenuModal({ isOpen, onClose }) {
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
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <MenuPanel />
        </div>
      </div>
    </div>
  );
}
