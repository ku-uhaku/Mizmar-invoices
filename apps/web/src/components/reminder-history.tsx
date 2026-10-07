'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { Icon } from './icons';
import { Card, CardHeader } from './ui';

/** Payment reminders sent for an invoice; renders nothing when there are none. */
export function ReminderHistory({ documentId }: { documentId: string }) {
  const t = useT();
  const reminders = useQuery({
    queryKey: ['reminders', documentId],
    queryFn: async () => unwrap(await api.receivables.reminders({ params: { id: documentId } })),
    // A role without access to receivables simply sees no card.
    retry: false,
  });

  const items = reminders.data ?? [];
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={t('Relances')}
        description={t('{n} envoyée(s) — dernière : {date}', {
          n: items.length,
          date: dateTime(items[0]!.sentAt),
        })}
      />
      <ul className="divide-y divide-border/70">
        {items.map((reminder) => (
          <li key={reminder.id} className="flex items-center gap-3 px-5 py-3 text-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
              <Icon name="mail" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">
                {t('Relance niveau {n}', { n: reminder.level })}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {dateTime(reminder.sentAt)}
                {reminder.recipient ? ` · ${reminder.recipient}` : ''}
                {reminder.sentByName ? ` · ${reminder.sentByName}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
