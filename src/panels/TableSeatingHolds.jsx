import { useDispatch, useGameState } from '../state/GameContext';
import { TYPOGRAPHY } from '../typography';
import { isCareerDecisionPending } from '../simulation/careerRun';

const holdRowStyle = {
  ...TYPOGRAPHY.secondary,
  background: '#1a1a2e',
  border: '1px solid #0f3460',
  borderRadius: 6,
  padding: 10,
};

function isValidTableId(id) {
  return (typeof id === 'string' && id.length > 0)
    || (Number.isSafeInteger(id) && id >= 0);
}

function hasUniqueReducerMatch(tables, id) {
  return tables.filter(table => table?.id != null && String(table.id) === String(id)).length === 1;
}

export default function TableSeatingHolds() {
  const state = useGameState();
  const dispatch = useDispatch();
  const pending = isCareerDecisionPending(state);
  const tables = Array.isArray(state?.tables) ? state.tables : [];
  const actionTables = tables.filter(table => isValidTableId(table?.id)
    && hasUniqueReducerMatch(tables, table.id));

  return (
    <section aria-label="Table seating holds" style={{ marginTop: 16 }}>
      <h4 style={{ ...TYPOGRAPHY.subheading, marginBottom: 8 }}>Table seating holds</h4>
      {actionTables.length === 0 ? (
        <p style={TYPOGRAPHY.secondary}>No tables available to control.</p>
      ) : (
        <ul
          aria-label="Tables and seating holds"
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
        >
          {actionTables.map(table => {
            const held = table.admissionHeld === true;
            const disabled = pending || (!held && table.status !== 'empty');
            const status = typeof table.status === 'string' && table.status.length > 0
              ? table.status : 'unavailable';

            return (
              <li key={String(table.id)} style={holdRowStyle}>
                <div>Table {table.id}</div>
                <div>Status: {status}</div>
                <div>Seating admission: {held ? 'held' : 'not held'}</div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (pending || (!held && table.status !== 'empty')) return;
                    dispatch({
                      type: 'SET_TABLE_ADMISSION_HOLD', id: table.id, held: !held,
                    });
                  }}
                  style={{
                    ...TYPOGRAPHY.control,
                    marginTop: 8,
                    padding: '6px 8px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {held ? `Release seating for table ${table.id}`
                    : `Hold seating for table ${table.id}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p style={{ ...TYPOGRAPHY.secondary, color: '#888', marginTop: 8 }}>
        A hold blocks new party seating at that table. Parties already seated, including contract
        guests, and existing reservations are unaffected.
      </p>
    </section>
  );
}
