'use client';

import clsx from 'clsx';
import { useT } from '@/lib/i18n/provider';
import { Icon } from './icons';
import { Input } from './ui';

export type RangePreset = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface DateRange {
  preset: RangePreset;
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  to: string;
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Local-date parsing: `new Date('2026-01-05')` would be UTC and shift a day west of Greenwich. */
const parse = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/** The range a preset covers around `anchor`. Weeks run Monday to Sunday. */
export function rangeFor(preset: Exclude<RangePreset, 'custom'>, anchor = new Date()): DateRange {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();
  switch (preset) {
    case 'day':
      return { preset, from: iso(anchor), to: iso(anchor) };
    case 'week': {
      const offset = (anchor.getDay() + 6) % 7;
      return { preset, from: iso(new Date(y, m, d - offset)), to: iso(new Date(y, m, d - offset + 6)) };
    }
    case 'month':
      return { preset, from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'year':
      return { preset, from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
  }
}

/** Moves a preset range one period back (-1) or forward (+1). */
function shift(range: DateRange, direction: -1 | 1): DateRange {
  const from = parse(range.from);
  if (range.preset === 'custom') {
    const to = parse(range.to);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    return {
      preset: 'custom',
      from: iso(new Date(from.getFullYear(), from.getMonth(), from.getDate() + direction * days)),
      to: iso(new Date(to.getFullYear(), to.getMonth(), to.getDate() + direction * days)),
    };
  }
  const anchor =
    range.preset === 'day'
      ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + direction)
      : range.preset === 'week'
        ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + direction * 7)
        : range.preset === 'month'
          ? new Date(from.getFullYear(), from.getMonth() + direction, 1)
          : new Date(from.getFullYear() + direction, 0, 1);
  return rangeFor(range.preset, anchor);
}

const PRESETS: Array<{ id: Exclude<RangePreset, 'custom'>; label: string }> = [
  { id: 'day', label: 'Jour' },
  { id: 'week', label: 'Semaine' },
  { id: 'month', label: 'Mois' },
  { id: 'year', label: 'Année' },
];

/**
 * Period picker: day / week / month / year presets with previous-next arrows,
 * plus a custom from-to range.
 */
export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
}) {
  const t = useT();

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      <div
        role="group"
        aria-label={t('Période')}
        className="inline-flex rounded-xl border border-border bg-surface p-0.5 shadow-sm"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={value.preset === preset.id}
            onClick={() => onChange(rangeFor(preset.id))}
            className={clsx(
              'h-8 rounded-lg px-3 text-sm font-medium transition',
              value.preset === preset.id
                ? 'bg-brand text-white shadow-sm dark:text-canvas'
                : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            {t(preset.label)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.preset === 'custom'}
          onClick={() => onChange({ ...value, preset: 'custom' })}
          className={clsx(
            'h-8 rounded-lg px-3 text-sm font-medium transition',
            value.preset === 'custom'
              ? 'bg-brand text-white shadow-sm dark:text-canvas'
              : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
          )}
        >
          {t('Personnalisé')}
        </button>
      </div>

      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          aria-label={t('Période précédente')}
          onClick={() => onChange(shift(value, -1))}
          className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-ink-muted shadow-sm hover:bg-surface-muted hover:text-ink rtl:rotate-180"
        >
          <Icon name="chevronDown" className="size-4 rotate-90" />
        </button>
        <button
          type="button"
          aria-label={t('Période suivante')}
          onClick={() => onChange(shift(value, 1))}
          className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-ink-muted shadow-sm hover:bg-surface-muted hover:text-ink rtl:rotate-180"
        >
          <Icon name="chevronDown" className="size-4 -rotate-90" />
        </button>
      </div>

      {value.preset === 'custom' && (
        <div className="inline-flex items-center gap-2">
          <Input
            type="date"
            aria-label={t('Du')}
            value={value.from}
            max={value.to}
            onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })}
            className="w-40"
          />
          <span className="text-ink-subtle">→</span>
          <Input
            type="date"
            aria-label={t('Au')}
            value={value.to}
            min={value.from}
            onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
            className="w-40"
          />
        </div>
      )}
    </div>
  );
}
