'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import type { AuditLogEntry } from '@mizmar/contracts';
import { api, unwrap } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { Button, Card, CardHeader, EmptyState, Table, TableSkeleton, Td, Th } from './ui';

const ACTION_LABELS: Record<string, string> = {
  'documents.create': 'Document créé',
  'documents.update': 'Document modifié',
  'documents.delete': 'Document supprimé',
  'documents.validate': 'Document validé',
  'documents.cancel': 'Document annulé',
  'documents.mark_sent': 'Document marqué comme envoyé',
  'documents.duplicate': 'Document dupliqué',
  'documents.convert': 'Document converti',
  'documents.send_email': 'Document envoyé par e-mail',
  'payments.create': 'Paiement enregistré',
  'payments.delete': 'Paiement supprimé',
  'contacts.create': 'Contact créé',
  'contacts.update': 'Contact modifié',
  'contacts.delete': 'Contact supprimé',
  'auth.login': 'Connexion',
  'auth.login_failed': 'Échec de connexion',
  'auth.logout': 'Déconnexion',
  'auth.change_password': 'Mot de passe modifié',
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  Document: 'Document',
  Contact: 'Contact',
  Payment: 'Paiement',
  Company: 'Société',
  Product: 'Produit',
  Warehouse: 'Entrepôt',
  Membership: 'Membre',
  TemplateConfig: 'Modèle',
  StockAdjustment: 'Ajustement de stock',
  StockTransfer: 'Transfert de stock',
  StockCount: 'Inventaire',
  User: 'Compte',
};

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
}

/** Cursor-paginated audit entries; `documentId` switches to the per-document endpoint. */
export function useAuditEntries(filters: AuditFilters, documentId?: string) {
  return useInfiniteQuery({
    queryKey: ['audit-logs', documentId ?? 'all', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      documentId
        ? unwrap(
            await api.audit.documentHistory({
              params: { id: documentId },
              query: { cursor: pageParam, limit: 50 },
            }),
          )
        : unwrap(await api.audit.list({ query: { ...clean(filters), cursor: pageParam, limit: 50 } })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function clean(filters: AuditFilters): AuditFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as AuditFilters;
}

function actionLabel(t: (key: string) => string, action: string): string {
  const known = ACTION_LABELS[action];
  return known ? t(known) : action;
}

export function AuditTable({
  entries,
  loading,
  showEntity = true,
}: {
  entries: AuditLogEntry[];
  loading: boolean;
  showEntity?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);

  if (loading) return <TableSkeleton rows={6} cols={showEntity ? 4 : 3} />;
  if (entries.length === 0) {
    return (
      <EmptyState
        icon="layout"
        title={t('Aucune activité enregistrée')}
        description={t('Les actions effectuées apparaîtront ici.')}
      />
    );
  }

  return (
    <Table className="min-w-[640px]">
      <thead>
        <tr>
          <Th>{t('Quand')}</Th>
          <Th>{t('Utilisateur')}</Th>
          <Th>{t('Action')}</Th>
          {showEntity && <Th>{t('Objet')}</Th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const expanded = open === entry.id;
          return (
            <Fragment key={entry.id}>
              <tr
                className="cursor-pointer hover:bg-surface-muted/60"
                onClick={() => setOpen(expanded ? null : entry.id)}
              >
                <Td className="whitespace-nowrap text-ink-muted">{dateTime(entry.createdAt)}</Td>
                <Td>{entry.userName ?? entry.userEmail ?? '—'}</Td>
                <Td className="font-medium">{actionLabel(t, entry.action)}</Td>
                {showEntity && (
                  <Td className="text-ink-muted">
                    {t(ENTITY_TYPE_LABELS[entry.entityType] ?? entry.entityType)}
                    {entry.entityId && (
                      <span className="ms-1 font-mono text-xs">{entry.entityId.slice(0, 8)}</span>
                    )}
                  </Td>
                )}
              </tr>
              {expanded && (
                <tr>
                  <Td colSpan={showEntity ? 4 : 3} className="bg-surface-muted/40">
                    <p className="mb-1 text-xs text-ink-subtle">
                      {entry.action}
                      {entry.ipAddress ? ` · ${t('Adresse IP')} ${entry.ipAddress}` : ''}
                    </p>
                    <pre dir="ltr" className="max-h-64 overflow-auto text-xs text-ink-muted">
                      {JSON.stringify(entry.diff ?? {}, null, 2)}
                    </pre>
                  </Td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

export function LoadMore({
  query,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  const t = useT();
  if (!query.hasNextPage) return null;
  return (
    <div className="flex justify-center border-t border-border p-3">
      <Button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
        {t('Charger plus')}
      </Button>
    </div>
  );
}

/** The "Historique" panel on a document: its audit entries, newest first. */
export function DocumentHistory({ documentId }: { documentId: string }) {
  const t = useT();
  const history = useAuditEntries({}, documentId);
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];

  // A role without audit access gets a 403: hide the panel rather than shout.
  if (history.isError) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader title={t('Historique')} />
      <AuditTable entries={entries} loading={history.isPending} showEntity={false} />
      <LoadMore query={history} />
    </Card>
  );
}
