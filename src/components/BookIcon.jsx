import { TYPOGRAPHY } from '../typography';

export default function BookIcon({ onClick, isOpen }) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label="Management"
      style={{
        ...TYPOGRAPHY.icon,
        position: 'fixed', top: 48, right: 68, zIndex: 100,
        background: isOpen ? '#f0a500' : '#16213e',
        border: '1px solid #0f3460', borderRadius: 8,
        color: isOpen ? '#111' : '#ccc',
        width: 44, height: 44,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      title="Management"
    >
      📖
    </button>
  );
}
