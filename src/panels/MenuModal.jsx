import { useRef } from 'react';
import { TYPOGRAPHY } from '../typography';
import MenuPanel from './MenuPanel';
import useDialogKeyboardFocus from '../components/useDialogKeyboardFocus';

export default function MenuModal({ isOpen, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
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
      <button
        type="button"
        aria-label="Dismiss menu"
        tabIndex={-1}
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          padding: 0, border: 0, background: 'rgba(0,0,0,0.6)', cursor: 'default',
        }}
      />

      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1} style={{
        position: 'relative', width: '90%', maxWidth: 700, maxHeight: '80vh',
        background: '#16213e', borderRadius: 12, border: '1px solid #0f3460',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        ...TYPOGRAPHY.body,
      }}>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          style={{
            ...TYPOGRAPHY.icon,
            position: 'absolute', top: 10, right: 10, zIndex: 1,
            width: 32, height: 32, border: '1px solid #0f3460', borderRadius: 8,
            background: '#0f3460', color: '#fff',
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
