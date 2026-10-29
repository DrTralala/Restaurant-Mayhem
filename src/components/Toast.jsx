import { useGameGeneration, useGameState } from '../state/GameContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPOGRAPHY } from '../typography';

const AUTO_DISMISS_MS = 5000;

function ToastBanner({ notification, onDismiss }) {
  const bannerRef = useRef(null);
  const remainingMsRef = useRef(AUTO_DISMISS_MS);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const [focused, setFocused] = useState(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const expire = useCallback(() => {
    timerRef.current = null;
    if (bannerRef.current?.contains(document.activeElement)) {
      remainingMsRef.current = 0;
      setFocused(true);
      return;
    }
    onDismiss(notification.id);
  }, [notification.id, onDismiss]);

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(expire, remainingMsRef.current);
  }, [expire]);

  useEffect(() => {
    startTimer();
    return stopTimer;
  }, [startTimer, stopTimer]);

  const handleFocus = () => {
    setFocused(true);
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const elapsed = Date.now() - startedAtRef.current;
    remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsed);
  };

  const handleBlur = event => {
    if (event.relatedTarget && bannerRef.current?.contains(event.relatedTarget)) return;
    setFocused(false);
    if (timerRef.current !== null) return;
    startTimer();
  };

  return (
    <div
      ref={bannerRef}
      className={`toast-banner${focused ? ' toast-banner--focused' : ''}`}
      role="status"
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={{
        ...TYPOGRAPHY.body,
        background: '#f0a500', color: '#111', padding: '10px 44px 10px 24px',
        borderRadius: 8,
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
  const generation = useGameGeneration();
  const [visible, setVisible] = useState([]);
  const seenIds = useRef(new Set());
  const initializedRef = useRef(false);
  const generationRef = useRef(generation);

  const dismiss = useCallback(id => {
    setVisible(current => current.filter(notification => notification.id !== id));
  }, []);

  useEffect(() => {
    const notifications = state.notifications || [];
    if (!initializedRef.current || !Object.is(generationRef.current, generation)) {
      initializedRef.current = true;
      generationRef.current = generation;
      seenIds.current.clear();
      for (const notification of notifications) seenIds.current.add(notification.id);
      const latest = notifications[notifications.length - 1];
      setVisible(latest ? [latest] : []);
      return;
    }

    const unseen = [];
    for (const notification of notifications) {
      if (seenIds.current.has(notification.id)) continue;
      seenIds.current.add(notification.id);
      unseen.push(notification);
    }
    if (unseen.length > 0) setVisible(current => [...current, ...unseen]);
  }, [generation, state.notifications]);

  if (visible.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
    }}>
      {visible.map(notification => (
        <ToastBanner
          key={`${generation}:${notification.id}`}
          notification={notification}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
