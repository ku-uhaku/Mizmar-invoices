'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { bankSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  NumberInput,
  PageHeader,
  SearchInput,
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

type Account = z.infer<typeof bankSchemas.bankAccount>;
type Line = z.infer<typeof bankSchemas.bankLine>;
type Filter = 'ALL' | 'UNMATCHED' | 'MATCHED' | 'IGNORED';

const STATUS_TONE = { UNMATCHED: 'progress', MATCHED: 'success', IGNORED: 'neutral' } as const;
const STATUS_LABEL = { UNMATCHED: 'À rapprocher', MATCHED: 'Rapproché', IGNORED: 'Ignoré' } as const;

/** Bank exports are often Windows-1252; fall back when the bytes are not valid UTF-8. */
async function readStatement(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export default function BankPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('UNMATCHED');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [matching, setMatching] = useState<Line | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const accounts = useQuery({
    queryKey: ['bank', 'accounts'],
    queryFn: async () => unwrap(await apiModules.bank.listAccounts({})),
  });
  const active = (accounts.data ?? []).filter((account) => account.isActive);
  const account: Account | undefined = active.find((entry) => entry.id === accountId) ?? active[0];

  const lines = useQuery({
    queryKey: ['bank', 'lines', account?.id, filter, search],
    enabled: Boolean(account),
    queryFn: async () =>
      unwrap(
        await apiModules.bank.listLines({
          params: { id: account!.id },
          query: { ...(filter !== 'ALL' ? { status: filter } : {}), ...(search.trim() ? { search: search.trim() } : {}) },
        }),
      ),
  });

  const refresh = () => void queryClient.invalidateQueries();
  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const importCsv = useMutation({
    mutationFn: async (file: File) =>
      unwrap(
        await apiModules.bank.importStatement({
          params: { id: account!.id },
          body: { csv: await readStatement(file) },
        }),
      ),
    onSuccess: (result) => {
      refresh();
      toast.success(
        t('{n} ligne(s) importée(s), {m} rapprochée(s) automatiquement', {
          n: result.imported,
          m: result.autoMatched,
        }),
      );
      if (result.duplicates > 0) toast.info(t('{n} doublon(s) ignoré(s)', { n: result.duplicates }));
      if (result.skipped.length > 0) toast.error(t('{n} ligne(s) illisible(s)', { n: result.skipped.length }));
    },
    onError: fail,
  });

  const autoMatch = useMutation({
    mutationFn: async () => unwrap(await apiModules.bank.autoMatch({ params: { id: account!.id }, body: {} })),
    onSuccess: (result) => {
      refresh();
      toast.success(t('{n} ligne(s) rapprochée(s)', { n: result.matched }));
    },
    onError: fail,
  });

  const lineAction = useMutation({
    mutationFn: async (input: { id: string; action: 'unmatch' | 'ignore' | 'restore' }) => {
      if (input.action === 'unmatch') {
        return unwrap(await apiModules.bank.unmatch({ params: { id: input.id }, body: {} }));
      }
      return unwrap(
        await apiModules.bank.ignore({ params: { id: input.id }, body: { ignored: input.action === 'ignore' } }),
      );
    },
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader
        title={t('Rapprochement bancaire')}
        subtitle={t('Comparez votre relevé de banque à vos paiements')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t('Compte bancaire')}
          </Button>
        }
      />

      {accounts.isPending ? (
        <TableSkeleton rows={4} cols={5} />
      ) : !account ? (
        <Card>
          <EmptyState
            icon="wallet"
            title={t('Aucun compte bancaire')}
            description={t('Ajoutez un compte, puis importez votre relevé au format CSV.')}
            action={<Button variant="primary" onClick={() => setCreating(true)}>{t('Ajouter un compte')}</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select className="w-64" value={account.id} onChange={(event) => setAccountId(event.target.value)}>
              {active.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
            <div className="ms-auto flex gap-2">
              <Button loading={autoMatch.isPending} onClick={() => autoMatch.mutate()}>
                {t('Rapprocher automatiquement')}
              </Button>
              <Button variant="primary" loading={importCsv.isPending} onClick={() => fileRef.current?.click()}>
                <Icon name="download" /> {t('Importer un relevé')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) importCsv.mutate(file);
                }}
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('Solde du relevé')} value={money(account.statementBalance, account.currency)} icon="wallet" />
            <StatCard label={t('Lignes importées')} value={account.lineCount} icon="file" />
            <StatCard
              label={t('À rapprocher')}
              value={account.unmatchedCount}
              hint={money(account.unmatchedTotal, account.currency)}
              icon="alert"
              tone={account.unmatchedCount > 0 ? 'progress' : 'success'}
            />
            <StatCard
              label={t('Dernière opération')}
              value={account.lastLineDate ? date(account.lastLineDate) : '—'}
              icon="clock"
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'UNMATCHED', label: t(STATUS_LABEL.UNMATCHED) },
                { value: 'MATCHED', label: t(STATUS_LABEL.MATCHED) },
                { value: 'IGNORED', label: t(STATUS_LABEL.IGNORED) },
                { value: 'ALL', label: t('Tous') },
              ]}
            />
            <SearchInput
              className="w-full sm:ms-auto sm:w-64"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Libellé, référence…')}
            />
          </div>

          <Card className="overflow-hidden">
            {lines.isPending ? (
              <TableSkeleton rows={6} cols={6} />
            ) : (lines.data ?? []).length === 0 ? (
              <EmptyState
                icon="file"
                title={t('Aucune ligne')}
                description={t('Importez un relevé CSV (date, libellé, débit/crédit ou montant).')}
              />
            ) : (
              <Table className="min-w-[900px]">
                <thead>
                  <tr>
                    <Th>{t('Date')}</Th>
                    <Th>{t('Libellé')}</Th>
                    <Th numeric>{t('Montant')}</Th>
                    <Th>{t('Statut')}</Th>
                    <Th>{t('Rapproché avec')}</Th>
                    <Th className="w-48" />
                  </tr>
                </thead>
                <tbody>
                  {lines.data!.map((line) => (
                    <tr key={line.id} className="hover:bg-surface-muted/60">
                      <Td className="whitespace-nowrap text-ink-muted">{date(line.date)}</Td>
                      <Td>
                        <span className="font-medium">{line.description || '—'}</span>
                        {line.reference && <span className="block text-xs text-ink-subtle">{line.reference}</span>}
                      </Td>
                      <Td numeric className={`font-semibold ${Number(line.amount) < 0 ? 'text-danger' : 'text-positive'}`}>
                        {money(line.amount, account.currency)}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[line.status]}>{t(STATUS_LABEL[line.status])}</Badge>
                      </Td>
                      <Td className="text-ink-muted">
                        {line.match ? (
                          <>
                            {line.match.label}
                            {line.match.reference && <span className="block text-xs">{line.match.reference}</span>}
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        <span className="flex justify-end gap-1.5">
                          {line.status === 'UNMATCHED' && (
                            <>
                              <Button size="sm" variant="primary" onClick={() => setMatching(line)}>
                                {t('Rapprocher')}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => lineAction.mutate({ id: line.id, action: 'ignore' })}
                              >
                                {t('Ignorer')}
                              </Button>
                            </>
                          )}
                          {line.status === 'MATCHED' && (
                            <Button size="sm" onClick={() => lineAction.mutate({ id: line.id, action: 'unmatch' })}>
                              {t('Annuler le rapprochement')}
                            </Button>
                          )}
                          {line.status === 'IGNORED' && (
                            <Button size="sm" onClick={() => lineAction.mutate({ id: line.id, action: 'restore' })}>
                              {t('Rétablir')}
                            </Button>
                          )}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {creating && <AccountDialog onClose={() => setCreating(false)} onCreated={(id) => setAccountId(id)} />}
      {matching && account && (
        <MatchDialog line={matching} currency={account.currency} onClose={() => setMatching(null)} />
      )}
    </>
  );
}

function AccountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [iban, setIban] = useState('');
  const [opening, setOpening] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.bank.createAccount({
          body: {
            name: name.trim(),
            bankName: bankName.trim() || null,
            iban: iban.trim() || null,
            currency: 'MAD',
            openingBalance: opening || '0',
            isActive: true,
          },
        }),
      );
    },
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: ['bank'] });
      onCreated(account.id);
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Nouveau compte bancaire')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={name.trim() === ''} onClick={() => create.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Nom')} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label={t('Banque')}>
          <Input value={bankName} onChange={(event) => setBankName(event.target.value)} />
        </Field>
        <Field label="IBAN / RIB">
          <Input value={iban} onChange={(event) => setIban(event.target.value)} />
        </Field>
        <Field label={t('Solde d’ouverture')} hint={t('Solde avant la première ligne importée')}>
          <NumberInput value={opening} onChange={(event) => setOpening(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function MatchDialog({ line, currency, onClose }: { line: Line; currency: string; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const candidates = useQuery({
    queryKey: ['bank', 'candidates', line.id],
    queryFn: async () => unwrap(await apiModules.bank.candidates({ params: { id: line.id } })),
  });

  const match = useMutation({
    mutationFn: async (candidate: { kind: 'PAYMENT' | 'EXPENSE_PAYMENT'; id: string }) =>
      unwrap(await apiModules.bank.match({ params: { id: line.id }, body: candidate })),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Rapprochement enregistré'));
      onClose();
    },
    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="md"
      title={t('Rapprocher la ligne')}
      description={`${date(line.date)} · ${line.description} · ${money(line.amount, currency)}`}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('Fermer')}
        </Button>
      }
    >
      {candidates.isPending ? (
        <TableSkeleton rows={3} cols={3} />
      ) : (candidates.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          {t('Aucun paiement de même montant à cette période. Enregistrez d’abord le paiement.')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {candidates.data!.map((candidate) => (
            <li key={`${candidate.kind}-${candidate.id}`} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{candidate.label || '—'}</p>
                <p className="text-xs text-ink-muted">
                  {date(candidate.paidAt)}
                  {candidate.dueDate ? ` · ${t('échéance')} ${date(candidate.dueDate)}` : ''}
                  {candidate.reference ? ` · ${candidate.reference}` : ''}
                </p>
              </div>
              <span className="tabular text-sm font-semibold">{money(candidate.amount, currency)}</span>
              <Button size="sm" variant="primary" loading={match.isPending} onClick={() => match.mutate(candidate)}>
                {t('Choisir')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
