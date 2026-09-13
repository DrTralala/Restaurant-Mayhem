import { TYPOGRAPHY } from '../typography';

export default function MenuIcon({ onClick, isOpen }) {
  return (
    <button
      type="button"
      aria-label="Menu"
      title="Menu"
      onClick={onClick}
      style={{
        ...TYPOGRAPHY.icon,
        position: 'fixed', top: 48, right: 120, zIndex: 100,
        background: isOpen ? '#f0a500' : '#16213e',
        border: '1px solid #0f3460', borderRadius: 8,
        color: isOpen ? '#111' : '#ccc',
        width: 44, height: 44,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      🍽
    </button>
  );
}
