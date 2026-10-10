'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { PeriodFilter } from '@/components/period-filter';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  NumberInput,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { amount, date } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { todayIso, useAccounts, yearStart } from '@/lib/use-accounting';

type Source = 'ALL' | 'MANUAL' | 'DOCUMENT' | 'PAYMENT' | 'EXPENSE';

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Saisie manuelle',
  DOCUMENT: 'Facture',
  PAYMENT: 'Paiement',
  EXPENSE: 'Dépense',
  EXPENSE_PAYMENT: 'Règlement de dépense',
};

export default function JournalPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState({ from: yearStart(), to: todayIso() });
  const [source, setSource] = useState<Source>('ALL');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const entries = useQuery({
    queryKey: ['accounting', 'entries', period, source, search],
    queryFn: async () =>
      unwrap(
        await apiModules.accounting.listEntries({
          query: {
            limit: 200,
            ...(period.from ? { from: period.from } : {}),
            ...(period.to ? { to: period.to } : {}),
            ...(source !== 'ALL' ? { source } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
          },
        }),
      ),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['accounting'] });
  const fail = (cause: unknown) => toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const sync = useMutation({
    mutationFn: async () => unwrap(await apiModules.accounting.sync({ body: {} })),
    onSuccess: (result) => {
      refresh();
      toast.success(t('{n} écriture(s) générée(s), {m} annulée(s)', { n: result.posted, m: result.reversed }));
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await apiModules.accounting.deleteEntry({ params: { id } })),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader
        title={t('Journal')}
        subtitle={t('Écritures comptables, générées depuis vos factures, paiements et dépenses')}
        actions={
          <>
            <Button loading={sync.isPending} onClick={() => sync.mutate()}>
              {t('Mettre à jour les écritures')}
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t('Écriture manuelle')}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <PeriodFilter {...period} onChange={setPeriod} />
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'ALL', label: t('Tous') },
            { value: 'DOCUMENT', label: t('Factures') },
            { value: 'PAYMENT', label: t('Paiements') },
            { value: 'EXPENSE', label: t('Dépenses') },
            { value: 'MANUAL', label: t('Manuelles') },
          ]}
        />
        <SearchInput
          className="w-full sm:ms-auto sm:w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Libellé ou n° de compte…')}
        />
      </div>

      <Card className="overflow-hidden">
        {entries.isPending ? (
          <TableSkeleton rows={8} cols={5} />
        ) : (entries.data ?? []).length === 0 ? (
          <EmptyState icon="file" title={t('Aucune écriture')} description={t('Aucune écriture sur cette période.')} />
        ) : (
          <Table className="min-w-[820px]">
            <thead>
              <tr>
                <Th className="w-16">{t('N°')}</Th>
                <Th>{t('Date')}</Th>
                <Th>{t('Libellé')}</Th>
                <Th>{t('Origine')}</Th>
                <Th numeric>{t('Montant')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {entries.data!.map((entry) => {
                const total = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0);
                const expanded = open === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <tr className="cursor-pointer hover:bg-surface-muted/60" onClick={() => setOpen(expanded ? null : entry.id)}>
                      <Td className="font-mono text-xs text-ink-subtle">{entry.seq}</Td>
                      <Td className="whitespace-nowrap text-ink-muted">{date(entry.date)}</Td>
                      <Td className="font-medium">{entry.label}</Td>
                      <Td>
                        <Badge tone={entry.source === 'MANUAL' ? 'info' : 'neutral'}>{t(SOURCE_LABEL[entry.source] ?? entry.source)}</Badge>
                      </Td>
                      <Td numeric className="font-semibold">{amount(total.toFixed(2))}</Td>
                      <Td>
                        {entry.source === 'MANUAL' && (
                          <IconButton
                            label={t('Supprimer')}
                            className="hover:bg-danger-soft hover:text-danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              remove.mutate(entry.id);
                            }}
                          >
                            <Icon name="x" />
                          </IconButton>
                        )}
                      </Td>
                    </tr>
                    {expanded &&
                      entry.lines.map((line, index) => (
                        <tr key={`${entry.id}-${index}`} className="bg-surface-muted/40 text-sm">
                          <Td />
                          <Td className="font-mono text-xs">{line.code}</Td>
                          <Td className={Number(line.credit) > 0 ? 'ps-8 text-ink-muted' : ''}>{t(line.name)}</Td>
                          <Td numeric>{Number(line.debit) > 0 ? amount(line.debit) : ''}</Td>
                          <Td numeric>{Number(line.credit) > 0 ? amount(line.credit) : ''}</Td>
                          <Td />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && <EntryDialog onClose={() => setCreating(false)} onSaved={refresh} />}
    </>
  );
}

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
}

function EntryDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const accounts = useAccounts();
  const [when, setWhen] = useState(todayIso());
  const [label, setLabel] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const balanced = debit > 0 && Math.abs(debit - credit) < 0.005;
  const ready = balanced && label.trim() !== '' && lines.every((line) => line.accountId || (!line.debit && !line.credit));

  const set = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.accounting.createEntry({
          body: {
            date: when,
            label: label.trim(),
            lines: lines
              .filter((line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0))
              .map((line) => ({ accountId: line.accountId, debit: line.debit || '0', credit: line.credit || '0' })),
          },
        }),
      );
    },
    onSuccess: () => {
      onSaved();
      toast.success(t('Écriture enregistrée'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={t('Écriture manuelle')}
      description={t('Le total des débits doit égaler le total des crédits.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label={t('Date')}>
            <Input type="date" value={when} onChange={(event) => setWhen(event.target.value)} />
          </Field>
          <Field label={t('Libellé')} required>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-[1fr_7rem_7rem] gap-2">
              <Select value={line.accountId} onChange={(event) => set(index, { accountId: event.target.value })}>
                <option value="">{t('Compte…')}</option>
                {accounts.data
                  ?.filter((account) => account.isActive)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {t(account.name)}
                    </option>
                  ))}
              </Select>
              <NumberInput
                placeholder={t('Débit')}
                value={line.debit}
                onChange={(event) => set(index, { debit: event.target.value, credit: event.target.value ? '' : line.credit })}
              />
              <NumberInput
                placeholder={t('Crédit')}
                value={line.credit}
                onChange={(event) => set(index, { credit: event.target.value, debit: event.target.value ? '' : line.debit })}
              />
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => setLines((current) => [...current, { accountId: '', debit: '', credit: '' }])}>
              <Icon name="plus" /> {t('Ajouter une ligne')}
            </Button>
            <p className={`tabular text-sm ${balanced ? 'text-positive' : 'text-danger'}`}>
              {amount(debit.toFixed(2))} / {amount(credit.toFixed(2))}
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
