'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AuditTable, ENTITY_TYPE_LABELS, LoadMore, useAuditEntries } from '@/components/audit-log';
import { Card, ErrorNote, Field, Input, PageHeader, Select } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';

export default function AuditLogPage() {
  const t = useT();
  const [entityType, setEntityType] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const members = useQuery({
    queryKey: ['members'],
    queryFn: async () => unwrap(await api.members.list()),
    staleTime: 5 * 60_000,
  });

  const log = useAuditEntries({
    entityType,
    userId,
    action: action.trim(),
    from,
    to,
  });
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title={t('Journal d’activité')} subtitle={t('Qui a fait quoi, et quand')} />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('Type d’objet')}>
          <Select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">{t('Tous')}</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Utilisateur')}>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t('Tous les utilisateurs')}</option>
            {(members.data ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Action')}>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="documents.validate"
            dir="ltr"
          />
        </Field>
        <Field label={t('Du')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('Au')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </Card>

      {log.isError && <ErrorNote>{t('Chargement impossible')}</ErrorNote>}

      <Card className="overflow-hidden">
        <AuditTable entries={entries} loading={log.isPending} />
        <LoadMore query={log} />
      </Card>
    </>
  );
}
