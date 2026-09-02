import { useGameState } from '../state/GameContext';
import { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_DISMISS_MS = 5000;

function ToastBanner({ notification, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  return (
    <div className="toast-banner" role="status" style={{
      background: '#f0a500', color: '#111', padding: '10px 44px 10px 24px',
      borderRadius: 8, fontSize: '14px', fontFamily: 'monospace',
      marginBottom: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    }}>
      {notification.message}
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(notification.id)}
      >
        ×
      </button>
    </div>
  );
}

export default function Toast() {
  const state = useGameState();
  const [visible, setVisible] = useState([]);
  const seenIds = useRef(new Set());

  const dismiss = useCallback(id => {
    setVisible(current => current.filter(notification => notification.id !== id));
  }, []);

  useEffect(() => {
    const notifications = state.notifications || [];
    const latest = notifications[notifications.length - 1];
    if (!latest || seenIds.current.has(latest.id)) return;
    seenIds.current.add(latest.id);
    setVisible(current => [...current, latest]);
  }, [state.notifications]);

  if (visible.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
    }}>
      {visible.map(notification => (
        <ToastBanner
          key={notification.id}
          notification={notification}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
