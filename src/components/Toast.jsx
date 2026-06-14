import { useGameState } from '../state/GameContext';
import { useState, useEffect } from 'react';

export default function Toast() {
  const state = useGameState();
  const [visible, setVisible] = useState([]);

  useEffect(() => {
    if (state.notifications.length === 0) return;
    const latest = state.notifications[state.notifications.length - 1];
    const id = latest.id;
    setVisible(prev => {
      if (prev.some(v => v.id === id)) return prev;
      return [...prev, { id, message: latest.message, time: Date.now() }];
    });
    const timer = setTimeout(() => {
      setVisible(prev => prev.filter(v => v.id !== id));
    }, 4000);
    return () => clearTimeout(timer);
  }, [state.notifications.length, state.notifications]);

  if (visible.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
    }}>
      {visible.map(v => (
        <div key={v.id} style={{
          background: '#f0a500', color: '#111', padding: '10px 24px',
          borderRadius: 8, fontSize: '14px', fontFamily: 'monospace',
          marginBottom: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {v.message}
        </div>
      ))}
    </div>
  );
}
