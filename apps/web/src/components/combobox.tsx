'use client';

import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { Icon } from './icons';
import { Spinner } from './ui';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary line (code, ICE, city…); also matched by the local filter. */
  description?: string;
}

/**
 * Searchable select. Filters `options` locally as the user types; when
 * `onSearch` is given the filtering is left to the caller (debounced server
 * query) and `options` is shown as-is.
 *
 * `selectedLabel` lets the trigger show the current value before it appears in
 * `options` (an async list rarely contains the saved choice).
 */
export function Combobox({
  value,
  onChange,
  options,
  onSearch,
  loading,
  selectedLabel,
  placeholder,
  searchPlaceholder,
  onCreate,
  createLabel,
  emptyLabel,
  disabled,
  clearable,
  className,
}: {
  value: string;
  onChange: (value: string, option?: ComboboxOption) => void;
  options: ComboboxOption[];
  onSearch?: (query: string) => void;
  loading?: boolean;
  selectedLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Footer action ("create new"); receives what the user typed. */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  emptyLabel?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  // Remembered so the trigger keeps its label after the option list changes.
  const [picked, setPicked] = useState<ComboboxOption | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const query = term.trim();

  useEffect(() => {
    if (!onSearch) return;
    const timer = setTimeout(() => onSearch(query), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const needle = query.toLowerCase();
  const items = onSearch
    ? options
    : options.filter(
        (option) =>
          !needle ||
          option.label.toLowerCase().includes(needle) ||
          option.description?.toLowerCase().includes(needle),
      );

  // The create row is a virtual last entry so the arrow keys reach it too.
  const showCreate = Boolean(onCreate) && query.length > 0;
  const rowCount = items.length + (showCreate ? 1 : 0);

  useEffect(() => setHighlighted(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const current = options.find((option) => option.value === value) ?? (picked?.value === value ? picked : null);
  const currentLabel = current?.label ?? selectedLabel;

  function close() {
    setOpen(false);
    setTerm('');
  }

  function pick(option: ComboboxOption) {
    setPicked(option);
    onChange(option.value, option);
    close();
  }

  function create() {
    onCreate?.(query);
    close();
  }

  function activate(index: number) {
    const option = items[index];
    if (option) pick(option);
    else if (showCreate && index === items.length) create();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, rowCount - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(highlighted);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  }

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => setOpen((state) => !state)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-9 w-full items-center rounded-lg border border-border-strong bg-surface px-3 pe-9 text-start text-sm text-ink shadow-sm transition hover:border-ink-subtle focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20 disabled:bg-surface-muted disabled:text-ink-muted"
      >
        <span className={clsx('truncate', !currentLabel && 'text-ink-subtle')}>
          {currentLabel || placeholder || '—'}
        </span>
      </button>
      <span className="absolute inset-y-0 end-3 flex items-center gap-1 text-ink-subtle">
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label={t('Effacer')}
            onClick={() => {
              setPicked(null);
              onChange('');
            }}
            className="rounded p-0.5 hover:text-ink"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        )}
        <Icon name="chevronDown" className="pointer-events-none size-4" />
      </span>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-56 rounded-xl border border-border bg-surface p-1 shadow-(--shadow-pop)">
          <div className="relative p-1">
            <input
              ref={inputRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder ?? t('Rechercher…')}
              aria-controls={listId}
              className="h-8 w-full rounded-lg border border-border-strong bg-surface px-3 pe-8 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20"
            />
            <span className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-ink-subtle">
              {loading ? <Spinner className="size-3.5" /> : <Icon name="search" className="size-3.5" />}
            </span>
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto">
            {items.length === 0 && !loading && (
              <li className="px-3 py-3 text-center text-sm text-ink-muted">
                {emptyLabel ?? t('Aucun résultat')}
              </li>
            )}
            {items.map((option, index) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => pick(option)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start',
                    index === highlighted ? 'bg-brand-soft' : 'hover:bg-surface-muted',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        'block truncate text-sm',
                        option.value === value ? 'font-semibold text-brand' : 'text-ink',
                      )}
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block truncate text-xs text-ink-subtle">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {option.value === value && <Icon name="check" className="size-4 text-brand" />}
                </button>
              </li>
            ))}
          </ul>
          {showCreate && (
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(items.length)}
                onClick={create}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium text-brand',
                  highlighted === items.length ? 'bg-brand-soft' : 'hover:bg-surface-muted',
                )}
              >
                <Icon name="plus" className="size-4" />
                <span className="truncate">
                  {createLabel ? createLabel(query) : t('Créer « {q} »', { q: query })}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
