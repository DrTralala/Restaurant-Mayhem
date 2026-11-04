import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TYPOGRAPHY } from '../typography';
import MenuPricePreview from './MenuPricePreview';

export function parseMenuPriceDraft(draft, { minPrice = 1, maxPrice = 100 } = {}) {
  const text = String(draft ?? '').trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.max(minPrice, Math.min(maxPrice, Math.round(value)));
}

export default function MenuPriceInput({
  price, label, disabled = false, minPrice = 1, maxPrice = 100, pricingKey = '',
  onCommit, getPreviewPresentation, renderControlRow,
}) {
  const [draft, setDraft] = useState(() => String(price));
  const [previewActive, setPreviewActive] = useState(false);
  const dirty = useRef(false);
  const basePrice = useRef(price);
  const editContext = JSON.stringify([minPrice, maxPrice, pricingKey]);
  const baseEditContext = useRef(editContext);
  const lastPresentation = useRef(null);

  useEffect(() => {
    dirty.current = false;
    basePrice.current = price;
    baseEditContext.current = editContext;
    setDraft(String(price));
    setPreviewActive(false);
  }, [price, disabled, editContext]);

  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    setPreviewActive(false);
    if (disabled || basePrice.current !== price || baseEditContext.current !== editContext) {
      basePrice.current = price;
      baseEditContext.current = editContext;
      setDraft(String(price));
      return;
    }
    const next = parseMenuPriceDraft(draft, { minPrice, maxPrice });
    if (next === null) {
      setDraft(String(price));
      return;
    }
    setDraft(String(next));
    if (next !== price) onCommit(next);
  };
  const previewPrice = parseMenuPriceDraft(draft, { minPrice, maxPrice });
  const showPreview = typeof getPreviewPresentation === 'function'
    && previewActive
    && dirty.current
    && !disabled
    && basePrice.current === price
    && baseEditContext.current === editContext
    && previewPrice !== null
    && previewPrice !== price;
  const activePresentation = showPreview
    ? getPreviewPresentation(previewPrice)
    : null;

  useLayoutEffect(() => {
    if (showPreview && activePresentation) lastPresentation.current = activePresentation;
  }, [showPreview, activePresentation]);

  const previewPresentation = showPreview ? activePresentation : lastPresentation.current;
  const input = (
    <input
      type="number" value={draft} min={minPrice} max={maxPrice} step={1}
      aria-label={label}
      disabled={disabled}
      onChange={event => {
        if (!dirty.current) {
          basePrice.current = price;
          baseEditContext.current = editContext;
        }
        dirty.current = true;
        setDraft(event.target.value);
        setPreviewActive(true);
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
          baseEditContext.current = editContext;
          setPreviewActive(false);
          setDraft(String(price));
        }
      }}
      style={{ ...TYPOGRAPHY.secondary, background: '#111', color: '#ccc', border: '1px solid #333', padding: '4px 8px', borderRadius: 4, width: 80 }}
      title="Edit price"
    />
  );

  return (
    <>
      {typeof renderControlRow === 'function' ? renderControlRow(input) : input}
      {previewPresentation && (
        <div style={{ width: '100%', maxWidth: '100%', marginTop: 8 }}>
          <MenuPricePreview presentation={previewPresentation} inactive={!showPreview} />
        </div>
      )}
    </>
  );
}
