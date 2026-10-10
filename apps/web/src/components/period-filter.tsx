'use client';

import { useT } from '@/lib/i18n/provider';
import { Field, Input } from './ui';

/** From / to dates, used by the accounting reports. */
export function PeriodFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('Du')}>
        <Input type="date" value={from} onChange={(event) => onChange({ from: event.target.value, to })} />
      </Field>
      <Field label={t('Au')}>
        <Input type="date" value={to} onChange={(event) => onChange({ from, to: event.target.value })} />
      </Field>
    </div>
  );
}
