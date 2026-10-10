'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { cashSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, Segmented, Select, toast } from './ui';

export type Register = z.infer<typeof cashSchemas.register>;
export type SessionDetail = z.infer<typeof cashSchemas.sessionDetail>;
type Reason = z.infer<typeof cashSchemas.cashMovementReasonEnum>;

export const REASONS: Array<[Reason, string]> = [
  ['DEPOSIT', 'Dépôt'],
  ['WITHDRAWAL', 'Retrait'],
  ['EXPENSE', 'Dépense'],
  ['REFUND', 'Remboursement'],
  ['OTHER', 'Autre'],
];

export function useRegisters(enabled = true) {
  return useQuery({
    queryKey: ['cash', 'registers'],
    enabled,
    queryFn: async () => unwrap(await apiModules.cash.listRegisters({})),
  });
}

export function useSessionDetail(id: string | null | undefined) {
  return useQuery({
    queryKey: ['cash', 'session', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await apiModules.cash.getSession({ params: { id: id! } })),
    refetchInterval: 30_000,
  });
}

const refresh = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: ['cash'] });

export function OpenSessionDialog({
  registerId,
  registerName,
  onClose,
}: {
  registerId: string;
  registerName: string;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [float, setFloat] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.cash.openSession({
          body: { registerId, openingFloat: float === '' ? '0' : float, note: note || null },
        }),
      );
    },
    onSuccess: () => {
      void refresh(queryClient);
      toast.success(t('Caisse ouverte'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Ouverture impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Ouvrir {name}', { name: registerName })}
      description={t('Comptez les espèces présentes dans le tiroir : c’est le fonds de caisse.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={open.isPending} onClick={() => open.mutate()}>
            {t('Ouvrir la caisse')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Fonds de caisse')}>
          <NumberInput value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" autoFocus />
        </Field>
        <Field label={t('Note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Cash put in the drawer or taken out of it, outside of a sale. */
export function MovementDialog({
  sessionId,
  currency,
  onClose,
}: {
  sessionId: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [reason, setReason] = useState<Reason>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.cash.addMovement({
          params: { id: sessionId },
          body: { type, reason, amount, note: note || null },
        }),
      );
    },
    onSuccess: () => {
      void refresh(queryClient);
      toast.success(t('Mouvement enregistré'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Entrée / sortie d’espèces')}
      description={t('Pour tout mouvement d’espèces qui n’est pas une vente.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!amount || Number(amount) <= 0} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Segmented<'IN' | 'OUT'>
          value={type}
          onChange={(value) => {
            setType(value);
            setReason(value === 'IN' ? 'DEPOSIT' : 'EXPENSE');
          }}
          options={[
            { value: 'OUT', label: t('Sortie') },
            { value: 'IN', label: t('Entrée') },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Montant')} required hint={currency}>
            <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label={t('Motif')}>
            <Select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
              {REASONS.filter(([value]) => (type === 'IN' ? value === 'DEPOSIT' || value === 'OTHER' : value !== 'DEPOSIT')).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ),
              )}
            </Select>
          </Field>
        </div>
        <Field label={t('Note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Count the drawer; the expected amount and the gap are shown before confirming. */
export function CloseSessionDialog({
  session,
  onClose,
  onClosed,
}: {
  session: SessionDetail;
  onClose: () => void;
  onClosed: (id: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const diff = counted === '' ? null : Number(counted) - Number(session.expectedCash);

  const close = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.cash.closeSession({
          params: { id: session.id },
          body: { countedCash: counted, note: note || null },
        }),
      );
    },
    onSuccess: (closed) => {
      void refresh(queryClient);
      toast.success(t('Caisse clôturée'));
      onClosed(closed.id);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Clôture impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Clôturer la caisse')}
      description={t('Comptez les espèces du tiroir. La clôture est définitive.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={close.isPending} disabled={counted === ''} onClick={() => close.mutate()}>
            {t('Clôturer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-surface-muted p-3 text-sm">
          <span className="text-ink-muted">{t('Fonds de caisse')}</span>
          <span className="tabular text-end">{money(session.openingFloat, session.currency)}</span>
          <span className="text-ink-muted">{t('Ventes en espèces')}</span>
          <span className="tabular text-end">{money(session.cashSales, session.currency)}</span>
          <span className="text-ink-muted">{t('Entrées / sorties')}</span>
          <span className="tabular text-end">
            +{money(session.cashIn, session.currency)} / −{money(session.cashOut, session.currency)}
          </span>
          <span className="font-semibold text-ink">{t('Espèces attendues')}</span>
          <span className="tabular text-end font-semibold">{money(session.expectedCash, session.currency)}</span>
        </div>
        <Field label={t('Espèces comptées')} required>
          <NumberInput value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>
        {diff !== null && (
          <p
            className={
              Math.abs(diff) < 0.005
                ? 'text-sm font-medium text-positive'
                : 'text-sm font-medium text-danger'
            }
          >
            {Math.abs(diff) < 0.005
              ? t('Caisse juste')
              : diff < 0
                ? t('Manque {amount}', { amount: money(Math.abs(diff).toFixed(2), session.currency) })
                : t('Excédent {amount}', { amount: money(diff.toFixed(2), session.currency) })}
          </p>
        )}
        <Field label={t('Note')} hint={t('Expliquez un écart si besoin')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
