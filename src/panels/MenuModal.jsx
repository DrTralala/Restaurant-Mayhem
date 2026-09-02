import { useEffect, useRef } from 'react';
import MenuPanel from './MenuPanel';

export default function MenuModal({ isOpen, onClose }) {
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const handleKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 150,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <button
        type="button"
        aria-label="Dismiss menu"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          padding: 0, border: 0, background: 'rgba(0,0,0,0.6)', cursor: 'default',
        }}
      />

      <div role="dialog" aria-modal="true" aria-label="Menu" style={{
        position: 'relative', width: '90%', maxWidth: 700, maxHeight: '80vh',
        background: '#16213e', borderRadius: 12, border: '1px solid #0f3460',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 1,
            width: 32, height: 32, border: '1px solid #0f3460', borderRadius: 8,
            background: '#0f3460', color: '#fff', fontSize: 22, lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <MenuPanel />
        </div>
      </div>
    </div>
  );
}
