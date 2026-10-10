'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const AXIS = { fill: 'var(--color-ink-muted)', fontSize: 12 } as const;

/** 12 500 -> "13 k": tick labels stay short; the tooltip carries the exact value. */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)} k`;
  return String(Math.round(value));
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
  title: (label: string) => string;
  format: (value: number) => string;
}

function Tip({ active, payload, label, title, format }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-(--shadow-pop)">
      <p className="mb-1 font-medium text-ink">{title(String(label))}</p>
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-2 text-ink-muted">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="tabular ms-auto ps-3 font-medium text-ink">{format(Number(entry.value))}</span>
        </p>
      ))}
    </div>
  );
}

/** Invoiced vs collected per day: two measures, one money scale. */
export function SalesTrendChart({
  data,
  invoicedLabel,
  collectedLabel,
  formatDay,
  format,
}: {
  data: Array<{ date: string; invoiced: number; collected: number }>;
  invoicedLabel: string;
  collectedLabel: string;
  formatDay: (iso: string) => string;
  format: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fill-invoiced" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickFormatter={(iso: string) => formatDay(iso).slice(0, 5)}
          minTickGap={32}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip content={<Tip title={(l) => formatDay(l)} format={format} />} />
        <Area
          type="monotone"
          dataKey="invoiced"
          name={invoicedLabel}
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#fill-invoiced)"
          dot={false}
          activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="collected"
          name={collectedLabel}
          stroke="var(--series-3)"
          strokeWidth={2}
          fill="none"
          dot={false}
          activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Six months of invoicing; the current month is the solid bar. */
export function MonthlyChart({
  data,
  label,
  formatMonth,
  format,
}: {
  data: Array<{ month: string; total: number }>;
  label: string;
  formatMonth: (month: string) => string;
  format: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          tickFormatter={formatMonth}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip
          content={<Tip title={formatMonth} format={format} />}
          cursor={{ fill: 'var(--color-surface-muted)', opacity: 0.6 }}
        />
        <Bar dataKey="total" name={label} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
          {data.map((point, index) => (
            <Cell
              key={point.month}
              fill="var(--series-1)"
              fillOpacity={index === data.length - 1 ? 1 : 0.55}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Receivables by lateness: not-yet-due in the series colour, overdue buckets in danger. */
export function AgingChart({
  data,
  label,
  format,
}: {
  data: Array<{ bucket: string; label: string; amount: number }>;
  label: string;
  format: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border-strong)' }}
          interval={0}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip
          content={<Tip title={(l) => l} format={format} />}
          cursor={{ fill: 'var(--color-surface-muted)', opacity: 0.6 }}
        />
        <Bar dataKey="amount" name={label} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          {data.map((point, index) => (
            <Cell
              key={point.bucket}
              fill={point.bucket === 'CURRENT' ? 'var(--series-1)' : 'var(--color-danger)'}
              fillOpacity={point.bucket === 'CURRENT' ? 1 : 0.4 + index * 0.15}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ranked horizontal bars as plain HTML: names stay readable and wrap, no axis needed. */
export function RankBars({
  rows,
}: {
  rows: Array<{ key: string; name: string; sub?: string; value: number; display: string; href?: string }>;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="space-y-3 p-5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink">
              {row.name}
              {row.sub && <span className="ms-2 text-xs font-normal text-ink-muted">{row.sub}</span>}
            </span>
            <span className="tabular shrink-0 font-medium text-ink">{row.display}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-(--series-1)"
              style={{ width: `${Math.max((row.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
