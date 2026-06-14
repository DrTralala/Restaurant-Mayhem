import { useRef, useEffect } from 'react';
import { useGameState } from '../state/GameContext';

const statBox = { background: '#1a1a2e', borderRadius: 6, padding: 10, border: '1px solid #0f3460' };

export default function StatsPanel() {
  const state = useGameState();
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const data = state.dailyHistory.slice(-7);
    if (data.length === 0) return;

    const maxRev = Math.max(...data.map(d => d.revenue), 1);
    const barWidth = canvas.width / data.length - 4;

    data.forEach((d, i) => {
      const h = (d.revenue / maxRev) * (canvas.height - 20);
      ctx.fillStyle = '#f0a500';
      ctx.fillRect(i * (barWidth + 4) + 2, canvas.height - h, barWidth, h);
      ctx.fillStyle = '#888';
      ctx.font = '10px monospace';
      ctx.fillText(`D${d.day}`, i * (barWidth + 4) + 2, canvas.height - 2);
    });
  }, [state.dailyHistory]);

  return (
    <div style={{ color: '#ccc', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#f0a500', marginBottom: 12 }}>Statistics</h3>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ marginBottom: 4 }}>Daily Revenue</h4>
        <canvas ref={canvasRef} style={{ width: '100%', height: 120, background: '#111', borderRadius: 8 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
        <div style={statBox}>Total Served: <strong>{state.restaurant.totalServed}</strong></div>
        <div style={statBox}>Current Day: <strong>{state.restaurant.day}</strong></div>
        <div style={statBox}>Funds: <strong>${state.restaurant.funds.toFixed(0)}</strong></div>
        <div style={statBox}>Reputation: <strong>{state.restaurant.reputation.toFixed(1)} ★</strong></div>
        <div style={statBox}>Staff: <strong>{state.staff.length}</strong></div>
        <div style={statBox}>Dishes: <strong>{state.dishes.length}</strong></div>
      </div>
    </div>
  );
}
