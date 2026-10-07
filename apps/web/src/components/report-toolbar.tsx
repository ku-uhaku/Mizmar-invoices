'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { Button, Card, Input, toast } from './ui';
import { ApiError } from '@/lib/api';
import { downloadReportCsv } from '@/lib/reports';
import { useT } from '@/lib/i18n/provider';

/** Date-range pickers, extra filters and the CSV export button shared by every report. */
export function ReportToolbar({
  from,
  to,
  onFrom,
  onTo,
  csvPath,
  csvParams,
  children,
  hideRange,
}: {
  from?: string;
  to?: string;
  onFrom?: (value: string) => void;
  onTo?: (value: string) => void;
  csvPath: string;
  csvParams: Record<string, string | undefined>;
  children?: ReactNode;
  hideRange?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    try {
      await downloadReportCsv(csvPath, csvParams);
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t('Export impossible'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
      {!hideRange && (
        <>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('Du')}</span>
            <Input type="date" value={from} max={to} onChange={(e) => onFrom?.(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('Au')}</span>
            <Input type="date" value={to} min={from} onChange={(e) => onTo?.(e.target.value)} />
          </label>
        </>
      )}
      {children}
      <div className="ms-auto">
        <Button onClick={() => void exportCsv()} disabled={busy}>
          <Icon name="download" />
          {t('Exporter en CSV')}
        </Button>
      </div>
    </Card>
  );
}
