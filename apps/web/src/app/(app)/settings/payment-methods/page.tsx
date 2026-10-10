'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { treasurySchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { PAYMENT_METHODS_KEY, usePaymentMethods } from '@/lib/use-payment-methods';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

type Kind = z.infer<typeof treasurySchemas.paymentKindEnum>;

const KINDS: Array<[Kind, string]> = [
  ['CASH', 'Espèces'],
  ['BANK_TRANSFER', 'Virement'],
  ['CHEQUE', 'Chèque'],
  ['BILL_OF_EXCHANGE', 'Effet de commerce'],
  ['CARD', 'Carte bancaire'],
  ['OTHER', 'Autre'],
];

export default function PaymentMethodsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const methods = usePaymentMethods();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('BANK_TRANSFER');
  const [deferred, setDeferred] = useState(false);
  const [requiresReference, setRequiresReference] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_KEY });
  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await apiModules.paymentMethods.create({
          body: {
            name: name.trim(),
            kind,
            deferred,
            requiresReference,
            isActive: true,
            sortOrder: (methods.data?.length ?? 0) + 1,
          },
        }),
      ),
    onSuccess: () => {
      setName('');
      setDeferred(false);
      setRequiresReference(false);
      refresh();
    },
    onError: fail,
  });

  const patch = useMutation({
    mutationFn: async (input: { id: string; body: Partial<z.infer<typeof treasurySchemas.paymentMethodBody>> }) =>
      unwrap(await apiModules.paymentMethods.update({ params: { id: input.id }, body: input.body })),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader
        title={t('Modes de paiement')}
        subtitle={t('Les moyens de paiement proposés lors d’un règlement')}
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem] sm:items-end">
          <Field label={t('Nom')}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('Type')} hint={t('Comportement du mode de paiement')}>
            <Select
              value={kind}
              onChange={(event) => {
                const next = event.target.value as Kind;
                setKind(next);
                // Cheques and bills clear later; suggest the right defaults.
                const later = next === 'CHEQUE' || next === 'BILL_OF_EXCHANGE';
                setDeferred(later);
                setRequiresReference(later || next === 'BANK_TRANSFER');
              }}
            >
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Checkbox
            label={t('Encaissement différé (suivi comme un chèque)')}
            checked={deferred}
            onChange={(event) => setDeferred(event.target.checked)}
          />
          <Checkbox
            label={t('Référence obligatoire')}
            checked={requiresReference}
            onChange={(event) => setRequiresReference(event.target.checked)}
          />
          <Button
            variant="primary"
            className="ms-auto"
            loading={create.isPending}
            disabled={name.trim() === ''}
            onClick={() => create.mutate()}
          >
            {t('Ajouter')}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {methods.isPending ? (
          <TableSkeleton rows={6} cols={5} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Nom')}</Th>
                <Th>{t('Type')}</Th>
                <Th>{t('Différé')}</Th>
                <Th>{t('Référence obligatoire')}</Th>
                <Th>{t('Actif')}</Th>
              </tr>
            </thead>
            <tbody>
              {methods.data?.map((method) => (
                <tr key={method.id}>
                  <Td className="font-medium">{t(method.name)}</Td>
                  <Td>
                    <Badge>{t(KINDS.find(([value]) => value === method.kind)?.[1] ?? method.kind)}</Badge>
                  </Td>
                  <Td>
                    <Checkbox
                      label={t('Différé')}
                      checked={method.deferred}
                      onChange={() => patch.mutate({ id: method.id, body: { deferred: !method.deferred } })}
                    />
                  </Td>
                  <Td>
                    <Checkbox
                      label={t('Référence obligatoire')}
                      checked={method.requiresReference}
                      onChange={() =>
                        patch.mutate({ id: method.id, body: { requiresReference: !method.requiresReference } })
                      }
                    />
                  </Td>
                  <Td>
                    <Checkbox
                      label={t('Actif')}
                      checked={method.isActive}
                      onChange={() => patch.mutate({ id: method.id, body: { isActive: !method.isActive } })}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
