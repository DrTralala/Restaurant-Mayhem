import { useRef, useEffect } from 'react';
import { useGameState } from '../state/GameContext';
import { getCanvasFont, TYPOGRAPHY } from '../typography';

const statBox = { ...TYPOGRAPHY.secondary, background: '#1a1a2e', borderRadius: 6, padding: 10, border: '1px solid #0f3460' };

export default function StatsPanel() {
  const state = useGameState();
  const canvasRef = useRef(null);
  const partyReviewHistory = Array.isArray(state.partyReviewHistory)
    ? state.partyReviewHistory
    : [];
  const finiteScores = partyReviewHistory
    .map(review => review.score)
    .filter(Number.isFinite);
  const averagePartyReview = finiteScores.length
    ? (finiteScores.reduce((sum, score) => sum + score, 0) / finiteScores.length).toFixed(1)
    : '—';
  const unaffordableReviewCount = partyReviewHistory
    .filter(review => review.unaffordableCount > 0).length;
  const unaffordableReviewPercentage = partyReviewHistory.length
    ? Math.round(unaffordableReviewCount / partyReviewHistory.length * 100)
    : 0;
  const latestPartyReviews = partyReviewHistory.slice(-10).reverse();

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
      ctx.font = getCanvasFont('compact');
      ctx.fillText(`D${d.day}`, i * (barWidth + 4) + 2, canvas.height - 2);
    });
  }, [state.dailyHistory]);

  return (
    <div style={{ ...TYPOGRAPHY.body, color: '#ccc' }}>
      <h3 style={{ ...TYPOGRAPHY.heading, color: '#f0a500', marginBottom: 12 }}>Statistics</h3>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 4 }}>Daily revenue</h4>
        <canvas ref={canvasRef} style={{ width: '100%', height: 120, background: '#111', borderRadius: 8 }} />
      </div>

      <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={statBox}>Total served: <strong>{state.restaurant.totalServed}</strong></div>
        <div style={statBox}>Current day: <strong>{state.restaurant.day}</strong></div>
        <div style={statBox}>Funds: <strong>${state.restaurant.funds.toFixed(0)}</strong></div>
        <div style={statBox}>Reputation: <strong>{state.restaurant.reputation.toFixed(1)} ★</strong></div>
        <div style={statBox}>Staff: <strong>{state.staff.length}</strong></div>
        <div style={statBox}>Dishes: <strong>{state.dishes.length}</strong></div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Party reviews</h4>
        <div style={{ ...TYPOGRAPHY.secondary, display: 'grid', gap: 8 }}>
          <div style={statBox}>Average party review: {averagePartyReview}</div>
          <div style={statBox}>Completed reviews: {partyReviewHistory.length}</div>
          <div style={statBox}>
            Reviews with unaffordable members: {unaffordableReviewCount} ({unaffordableReviewPercentage}%)
          </div>
          {latestPartyReviews.map(review => {
            const formattedDelta = review.reputationDelta.toFixed(3);
            const signedDelta = review.reputationDelta > 0
              ? `+${formattedDelta}`
              : formattedDelta;
            return (
              <div
                key={`${review.day}-${review.partyId}`}
                data-testid="party-review-row"
                style={statBox}
              >
                <div style={{ color: '#f0a500', marginBottom: 4 }}>
                  Day {review.day} · {review.partyId}
                </div>
                <div>Score: {review.score.toFixed(1)}</div>
                <div>
                  Party: {review.memberCount} · Paid: {review.paidCount} · Unaffordable: {review.unaffordableCount}
                </div>
                <div>Reputation: {signedDelta}</div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => {
          if (window.confirm('Start a new game? All progress will be lost.')) {
            localStorage.removeItem('restaurant-sim-save');
            window.location.reload();
          }
        }}
        style={{
          ...TYPOGRAPHY.control,
          marginTop: 16, width: '100%',
          background: '#633', color: '#d44', border: '1px solid #844',
          padding: '8px 16px', borderRadius: 4, cursor: 'pointer',
        }}
      >
        New game
      </button>
    </div>
  );
}
