'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ChartSeries {
  key: string;
  label: string;
}

export type ChartKind = 'bar' | 'line' | 'donut';

const SERIES_COLORS = Array.from({ length: 8 }, (_, index) => `var(--series-${index + 1})`);
const AXIS = { fill: 'var(--color-ink-muted)', fontSize: 12 } as const;

/** 12 500 -> "12,5 k": short tick labels; full values live in the tooltip and the table. */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)} k`;
  return String(Math.round(value));
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number | string; color?: string; payload?: { name?: string } }>;
  label?: string | number;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-ink">{label}</p>}
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

/**
 * Bar, line or donut for a report. One measure scale only (never dual-axis);
 * colours follow the series order, never its rank. The report table below is
 * the accessible equivalent of every chart.
 */
export function ReportChart({
  kind,
  data,
  xKey,
  series,
  format,
  other = 'Autres',
}: {
  kind: ChartKind;
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: ChartSeries[];
  format: (value: number) => string;
  /** Translated label for the folded tail of a donut. */
  other?: string;
}) {
  const legend = {
    iconType: 'circle' as const,
    iconSize: 8,
    formatter: (value: string) => <span style={{ color: 'var(--color-ink-muted)' }}>{value}</span>,
  };

  if (kind === 'donut') {
    const key = series[0]!.key;
    const sorted = [...data].sort((a, b) => Number(b[key]) - Number(a[key])).filter((row) => Number(row[key]) > 0);
    const head = sorted.slice(0, 7);
    const tail = sorted.slice(7).reduce((sum, row) => sum + Number(row[key]), 0);
    const slices = [
      ...head.map((row) => ({ name: String(row[xKey]), value: Number(row[key]) })),
      ...(tail > 0 ? [{ name: other, value: tail }] : []),
    ];
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={95}
            stroke="var(--color-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((_, index) => (
              <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} />} />
          <Legend {...legend} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid stroke="var(--color-border)" vertical={false} />
      <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--color-border-strong)' }} />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
      <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: 'var(--color-surface-muted)', opacity: 0.6 }} />
      {series.length > 1 && <Legend {...legend} />}
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={280}>
      {kind === 'line' ? (
        <LineChart {...common}>
          {axes}
          {series.map((s, index) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type="monotone"
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart {...common} barGap={2}>
          {axes}
          {series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
