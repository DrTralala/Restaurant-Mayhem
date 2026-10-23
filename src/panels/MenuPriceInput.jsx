import { useEffect, useRef, useState } from 'react';
import { TYPOGRAPHY } from '../typography';

export function parseMenuPriceDraft(draft) {
  const text = String(draft ?? '').trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export default function MenuPriceInput({ price, label, disabled = false, onCommit }) {
  const [draft, setDraft] = useState(() => String(price));
  const dirty = useRef(false);
  const basePrice = useRef(price);

  useEffect(() => {
    dirty.current = false;
    basePrice.current = price;
    setDraft(String(price));
  }, [price, disabled]);

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    if (disabled || basePrice.current !== price) {
      setDraft(String(price));
      return;
    }
    const next = parseMenuPriceDraft(draft);
    if (next === null) {
      setDraft(String(price));
      return;
    }
    setDraft(String(next));
    if (next !== price) onCommit(next);
  };

  return (
    <input
      type="number" value={draft} min={1} max={100} step={1}
      aria-label={label}
      disabled={disabled}
      onChange={event => {
        if (!dirty.current) basePrice.current = price;
        dirty.current = true;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dirty.current = false;
          basePrice.current = price;
          setDraft(String(price));
        }
      }}
      style={{ ...TYPOGRAPHY.secondary, background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
      title="Edit price"
    />
  );
}
