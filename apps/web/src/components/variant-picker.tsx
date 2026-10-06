'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import type { VariantSearchResult } from '@mizmar/contracts';
import { useT } from '@/lib/i18n/provider';
import { money, qty } from '@/lib/format';
import { Icon } from './icons';
import { Spinner } from './ui';

/**
 * The line picker the document editor is used through all day.
 *
 * Matches SKU, barcode, product name and attribute values in one field, so the
 * user types "rouge l" or scans a barcode without choosing a search mode first.
 * Entirely keyboard-driven: arrows move, Enter adds, Escape closes.
 */
export function VariantPicker({
  warehouseId,
  onPick,
  placeholder,
  autoFocus,
}: {
  warehouseId?: string | null;
  onPick: (variant: VariantSearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(timer);
  }, [term]);

  const results = useQuery({
    queryKey: ['variant-search', debounced, warehouseId],
    queryFn: async () =>
      unwrap(
        await api.catalog.searchVariants({
          query: { q: debounced, limit: 12, ...(warehouseId ? { warehouseId } : {}) },
        }),
      ),
    enabled: debounced.length >= 1,
  });

  const items = results.data ?? [];

  useEffect(() => setHighlighted(0), [debounced]);

  function pick(variant: VariantSearchResult) {
    onPick(variant);
    setTerm('');
    setDebounced('');
    setOpen(false);
    // Keep focus so a second item can be added without reaching for the mouse.
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const variant = items[highlighted];
      // A barcode scanner types fast and ends with Enter; when exactly one
      // result matches, adding it directly is what the user expects.
      if (variant) pick(variant);
      else if (items.length === 1 && items[0]) pick(items[0]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? t('Rechercher un article (réf., code-barres, nom, couleur…)')}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          className="h-9 w-full rounded-lg border border-border-strong bg-surface px-3 pe-9 text-sm text-ink shadow-sm transition placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
        />
        <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ink-subtle">
          {results.isFetching ? <Spinner className="size-4" /> : <Icon name="search" className="size-4" />}
        </span>
      </div>

      {open && debounced.length >= 1 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-(--shadow-pop)"
        >
          {items.length === 0 && !results.isFetching && (
            <li className="px-3 py-4 text-center text-sm text-ink-muted">{t('Aucun article trouvé')}</li>
          )}
          {items.map((variant, index) => (
            <li key={variant.variantId} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(variant)}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-start',
                  index === highlighted ? 'bg-brand-soft' : 'hover:bg-surface-muted',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {variant.productName}
                    {variant.variantLabel && (
                      <span className="text-ink-muted"> — {variant.variantLabel}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-subtle">
                    {variant.sku}
                    {variant.barcode ? ` · ${variant.barcode}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  {variant.sellingPrice && (
                    <p className="tabular text-sm text-ink">{money(variant.sellingPrice)}</p>
                  )}
                  {/* Availability sits in the picker because choosing an item
                      that cannot be shipped is a decision made right here. */}
                  {!variant.isService && (
                    <p
                      className={clsx(
                        'tabular text-xs',
                        Number(variant.available) <= 0
                          ? 'font-medium text-danger'
                          : variant.isLowStock
                            ? 'text-warning'
                            : 'text-ink-subtle',
                      )}
                    >
                      {t('dispo {n}', { n: qty(variant.available) })}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
