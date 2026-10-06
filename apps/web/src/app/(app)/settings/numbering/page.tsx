'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import type { settingsSchemas } from '@mizmar/contracts';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  ErrorNote,
  Field,
  Input,
  NumberInput,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { api, ApiError, unwrap } from '@/lib/api';
import { documentTypeLabel } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { activeCompanyId } from '@/lib/session-client';

type Sequence = z.infer<typeof settingsSchemas.numberSequence>;

export default function NumberingPage() {
  const t = useT();
  const companyId = activeCompanyId();
  const [editing, setEditing] = useState<Sequence | null>(null);

  const sequences = useQuery({
    queryKey: ['number-sequences', companyId],
    queryFn: async () =>
      unwrap(await api.companies.listNumberSequences({ params: { id: companyId! }, query: {} })),
    enabled: Boolean(companyId),
  });

  return (
    <>
      <PageHeader
        title={t('Numérotation')}
        subtitle={t('Format des numéros de documents, par type et par année')}
      />
      <Card>
        <CardHeader
          title={t('Séquences')}
          description={`${t('Jetons')} : {PREFIX} {COMPANY} {YYYY} {YY} {MM} {SEQ} {SEQ:n}`}
        />
        {!sequences.data ? (
          <TableSkeleton rows={6} cols={5} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Document')}</Th>
                <Th>{t('Année')}</Th>
                <Th>{t('Préfixe')}</Th>
                <Th>{t('Format')}</Th>
                <Th numeric>{t('Émis')}</Th>
                <Th>{t('Prochain numéro')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sequences.data.map((sequence) => (
                <tr key={sequence.id}>
                  <Td>{documentTypeLabel(sequence.type)}</Td>
                  <Td>{sequence.year}</Td>
                  <Td className="font-mono text-xs">{sequence.prefix}</Td>
                  <Td className="font-mono text-xs">{sequence.format}</Td>
                  <Td numeric>{sequence.counter}</Td>
                  <Td className="font-mono text-xs">{sequence.nextNumberPreview}</Td>
                  <Td className="text-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(sequence)}>
                      {t('Modifier')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && (
        <SequenceDialog companyId={companyId!} sequence={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function SequenceDialog({
  companyId,
  sequence,
  onClose,
}: {
  companyId: string;
  sequence: Sequence;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [prefix, setPrefix] = useState(sequence.prefix);
  const [format, setFormat] = useState(sequence.format);
  const [counter, setCounter] = useState(String(sequence.counter));
  const [error, setError] = useState<string | null>(null);
  // The counter can only be changed while nothing has been issued this year.
  const counterLocked = sequence.counter > 0;

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const next = Number(counter);
      return unwrap(
        await api.companies.updateNumberSequence({
          params: { id: companyId, sequenceId: sequence.id },
          body: {
            prefix,
            format,
            ...(!counterLocked && Number.isInteger(next) && next >= 0 ? { counter: next } : {}),
          },
        }),
      );
    },
    onSuccess: () => {
      toast.success(t('Numérotation enregistrée'));
      void queryClient.invalidateQueries({ queryKey: ['number-sequences'] });
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={`${documentTypeLabel(sequence.type)} · ${sequence.year}`}
      footer={
        <>
          <Button onClick={onClose}>{t('Annuler')}</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('Préfixe')}>
          <Input value={prefix} maxLength={10} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field label={t('Format')} hint="{PREFIX}-{YYYY}-{SEQ:5}">
          <Input value={format} maxLength={60} className="font-mono" onChange={(e) => setFormat(e.target.value)} />
        </Field>
        <Field
          label={t('Compteur')}
          hint={counterLocked ? t('Modifiable uniquement tant qu’aucun document n’a été émis cette année') : undefined}
        >
          <NumberInput
            value={counter}
            disabled={counterLocked}
            onChange={(e) => setCounter(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
