import { TYPOGRAPHY, humaniseIdentifier } from '../typography';

export default function FixtureSaleReview({ review, notice, onCancel, onConfirm }) {
  const entries = Array.isArray(review?.entries) ? review.entries : [];
  const eligible = entries.filter(entry => entry.eligible);
  const excluded = entries.filter(entry => !entry.eligible);
  const affectedChairIds = Array.isArray(review?.affectedChairIds)
    ? review.affectedChairIds
    : [];
  const confirmDisabled = eligible.length === 0 || !review?.expectedSale;

  return (
    <section
      role="region"
      aria-label="Review fixture sale"
      style={{
        position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)',
        zIndex: 300, display: 'flex', flexDirection: 'column', gap: 6,
        background: '#16213e', border: '1px solid #f0a500', borderRadius: 8,
        padding: '10px 12px', color: '#ddd', maxWidth: '92%', maxHeight: '70%',
        overflow: 'auto', ...TYPOGRAPHY.secondary,
      }}
    >
      <div style={{ ...TYPOGRAPHY.control, color: '#f0a500' }}>Review fixture sale</div>
      {notice ? <div role="status" style={{ color: '#f0a500' }}>{notice}</div> : null}
      <div style={{ color: '#888' }}>Eligible ({eligible.length})</div>
      {eligible.length > 0 ? (
        <ul style={listStyle}>
          {eligible.map(entry => (
            <li key={`eligible:${entry.type}:${entry.id}`}>
              {humaniseIdentifier(entry.type)} {entry.id}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ color: '#888', fontStyle: 'italic' }}>No fixtures can be sold right now</div>
      )}
      {excluded.length > 0 && (
        <>
          <div style={{ color: '#888' }}>Excluded ({excluded.length})</div>
          <ul style={listStyle}>
            {excluded.map(entry => (
              <li key={`excluded:${entry.type}:${entry.id}`}>
                {humaniseIdentifier(entry.type)} {entry.id} — {humaniseIdentifier(entry.reason)}
              </li>
            ))}
          </ul>
        </>
      )}
      {affectedChairIds.length > 0 && (
        <div>Removes chairs {affectedChairIds.join(', ')}</div>
      )}
      {Number.isFinite(review?.refund) && <div>Refund: ${review.refund}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" autoFocus onClick={onCancel} style={reviewBtn}>Cancel</button>
        <button
          type="button"
          disabled={confirmDisabled}
          onClick={onConfirm}
          style={confirmDisabled ? { ...reviewBtn, color: '#666', cursor: 'not-allowed' } : reviewBtn}
        >
          Confirm
        </button>
      </div>
    </section>
  );
}

const reviewBtn = {
  ...TYPOGRAPHY.control,
  background: '#1a1a2e', color: '#ccc', border: '1px solid #333',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer',
};

const listStyle = {
  display: 'flex', flexWrap: 'wrap', gap: '2px 12px', margin: 0,
  padding: 0, listStyle: 'none',
};
