'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import {
  ExpenseDialog,
  ExpensePayDialog,
  useExpenseCategories,
  type Expense,
} from '@/components/expense-dialogs';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  type BadgeTone,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  IconButton,
  PageHeader,
  Segmented,
  Select,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Filter = 'ALL' | 'UNPAID' | 'OVERDUE' | 'PAID';

const STATUS_TONE: Record<Expense['status'], BadgeTone> = {
  DRAFT: 'neutral',
  UNPAID: 'progress',
  PARTIAL: 'info',
  PAID: 'success',
  CANCELLED: 'neutral',
};
const STATUS_LABEL: Record<Expense['status'], string> = {
  DRAFT: 'Brouillon',
  UNPAID: 'À payer',
  PARTIAL: 'Partiel',
  PAID: 'Payée',
  CANCELLED: 'Annulée',
};

export default function ExpensesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [toRemove, setToRemove] = useState<Expense | null>(null);

  const categories = useExpenseCategories();
  const summary = useQuery({
    queryKey: ['expenses', 'summary'],
    queryFn: async () => unwrap(await api.expenses.summary({})),
  });
  const list = useQuery({
    queryKey: ['expenses', 'list', filter, categoryId],
    queryFn: async () =>
      unwrap(
        await api.expenses.list({
          query: {
            limit: 100,
            ...(categoryId ? { categoryId } : {}),
            ...(filter === 'OVERDUE' ? { overdue: true } : {}),
            ...(filter === 'UNPAID' ? { status: 'UNPAID' as const } : {}),
            ...(filter === 'PAID' ? { status: 'PAID' as const } : {}),
          },
        }),
      ),
  });

  const remove = useMutation({
    mutationFn: async (expense: Expense) =>
      unwrap(await api.expenses.remove({ params: { id: expense.id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(t('Facture supprimée'));
      setToRemove(null);
    },
    onError: (cause) => {
      setToRemove(null);
      toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible'));
    },
  });

  const currency = summary.data?.currency ?? 'MAD';

  return (
    <>
      <PageHeader
        title={t('Dépenses et factures')}
        subtitle={t('Électricité, eau, internet, loyer et autres charges')}
        actions={
          <>
            <Link
              href="/expenses/recurring"
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <Icon name="clock" className="size-4" />
              {t('Charges récurrentes')}
            </Link>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Icon name="plus" className="size-4" />
              {t('Nouvelle facture')}
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('Reste à payer')}
          value={money(summary.data?.unpaidTotal ?? '0', currency)}
          icon="wallet"
        />
        <StatCard
          label={t('En retard')}
          value={money(summary.data?.overdueTotal ?? '0', currency)}
          hint={t('{n} facture(s)', { n: summary.data?.overdueCount ?? 0 })}
          icon="alert"
          tone={summary.data && summary.data.overdueCount > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          label={t('Échéance sous 7 jours')}
          value={money(summary.data?.dueSoonTotal ?? '0', currency)}
          hint={t('{n} facture(s)', { n: summary.data?.dueSoonCount ?? 0 })}
          icon="clock"
          tone="progress"
        />
        <StatCard
          label={t('Dépenses du mois')}
          value={money(summary.data?.monthTotal ?? '0', currency)}
          icon="trending"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: t('Toutes') },
            { value: 'UNPAID', label: t('À payer') },
            { value: 'OVERDUE', label: t('En retard') },
            { value: 'PAID', label: t('Payées') },
          ]}
        />
        <div className="w-56">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">{t('Toutes les catégories')}</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {t(category.name)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <TableSkeleton rows={6} cols={7} />
        ) : list.isError ? (
          <ErrorNote>{t('Chargement impossible')}</ErrorNote>
        ) : list.data.items.length > 0 ? (
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <Th>{t('Date')}</Th>
                <Th>{t('Catégorie')}</Th>
                <Th>{t('Fournisseur')}</Th>
                <Th>{t('Échéance')}</Th>
                <Th>{t('Statut')}</Th>
                <Th numeric>{t('Total TTC')}</Th>
                <Th numeric>{t('Reste dû')}</Th>
                <Th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((expense) => (
                <tr key={expense.id} className="hover:bg-surface-muted/60">
                  <Td className="whitespace-nowrap text-ink-muted">{date(expense.issueDate)}</Td>
                  <Td>
                    <div className="font-medium">{t(expense.categoryName)}</div>
                    {(expense.description || expense.reference) && (
                      <div className="text-xs text-ink-muted">
                        {[expense.description, expense.reference].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{expense.supplierName ?? '—'}</Td>
                  <Td className="whitespace-nowrap">
                    {expense.dueDate ? (
                      <span className={expense.isOverdue ? 'font-medium text-danger' : 'text-ink-muted'}>
                        {date(expense.dueDate)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Badge tone={expense.isOverdue ? 'danger' : STATUS_TONE[expense.status]}>
                      {expense.isOverdue ? t('En retard') : t(STATUS_LABEL[expense.status])}
                    </Badge>
                  </Td>
                  <Td numeric className="font-semibold">
                    {money(expense.totalInclVat, expense.currency)}
                  </Td>
                  <Td numeric>{money(expense.outstanding, expense.currency)}</Td>
                  <Td>
                    <span className="flex items-center justify-end gap-1">
                      {(expense.status === 'UNPAID' || expense.status === 'PARTIAL') && (
                        <Button variant="secondary" size="sm" onClick={() => setPaying(expense)}>
                          {t('Payer')}
                        </Button>
                      )}
                      {expense.status !== 'CANCELLED' && (
                        <IconButton label={t('Modifier')} onClick={() => setEditing(expense)}>
                          <Icon name="file" />
                        </IconButton>
                      )}
                      {expense.status !== 'CANCELLED' && (
                        <IconButton
                          label={t('Supprimer')}
                          onClick={() => setToRemove(expense)}
                          className="hover:bg-danger-soft hover:text-danger"
                        >
                          <Icon name="x" />
                        </IconButton>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="wallet"
            title={t('Aucune facture')}
            description={t('Enregistrez vos factures d’électricité, d’eau, d’internet et autres charges.')}
          />
        )}
      </Card>

      {editing && (
        <ExpenseDialog expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {paying && <ExpensePayDialog expense={paying} onClose={() => setPaying(null)} />}
      {toRemove && (
        <Dialog
          open
          onClose={() => setToRemove(null)}
          title={t('Supprimer cette facture ?')}
          description={
            toRemove.payments.length > 0
              ? t('Cette facture a des règlements. Ouvrez-la avec « Modifier » pour les supprimer d’abord.')
              : t('Cette facture sera supprimée définitivement.')
          }
          footer={
            <>
              <Button variant="ghost" onClick={() => setToRemove(null)}>
                {t('Retour')}
              </Button>
              {toRemove.payments.length === 0 && (
                <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(toRemove)}>
                  {t('Supprimer')}
                </Button>
              )}
            </>
          }
        >
          <></>
        </Dialog>
      )}
    </>
  );
}
