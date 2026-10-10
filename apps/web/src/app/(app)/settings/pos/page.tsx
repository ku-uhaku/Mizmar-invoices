'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiModules, ApiError, unwrap } from '@/lib/api';
import { useRegisters } from '@/components/cash-dialogs';
import { Badge, Button, Card, Checkbox, Field, Input, PageHeader, Table, TableSkeleton, Td, Th, toast } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';
import { usePosSettings } from '@/lib/use-pos';

export default function PosSettingsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const pos = usePosSettings();
  const registers = useRegisters(true);
  const [name, setName] = useState('');

  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const save = useMutation({
    mutationFn: async (body: { posEnabled?: boolean; posRequireSession?: boolean }) =>
      unwrap(await api.companies.update({ params: { id: pos.companyId! }, body })),
    onSuccess: () => {
      // The menu and the till read these flags from the session.
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success(t('Paramètres enregistrés'));
    },
    onError: fail,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['cash'] });
  const add = useMutation({
    mutationFn: async () => unwrap(await apiModules.cash.createRegister({ body: { name: name.trim(), isActive: true } })),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) =>
      unwrap(await apiModules.cash.updateRegister({ params: { id: input.id }, body: { isActive: input.isActive } })),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader title={t('Caisse')} subtitle={t('Activer le point de vente et gérer les caisses')} />

      <Card className="mb-4 space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t('Activer la caisse')}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {t('Désactivée, la caisse disparaît du menu et aucune session ne peut être ouverte. Vos factures, paiements et historiques sont conservés.')}
            </p>
          </div>
          <Checkbox
            label={pos.enabled ? t('Activée') : t('Désactivée')}
            checked={pos.enabled}
            disabled={!pos.ready || save.isPending}
            onChange={(e) => save.mutate({ posEnabled: e.target.checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t('Exiger une session ouverte')}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {t('Le caissier doit ouvrir la caisse (fonds de caisse) avant de vendre, et la clôturer en fin de service.')}
            </p>
          </div>
          <Checkbox
            label={pos.requireSession ? t('Oui') : t('Non')}
            checked={pos.requireSession}
            disabled={!pos.ready || !pos.enabled || save.isPending}
            onChange={(e) => save.mutate({ posRequireSession: e.target.checked })}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Caisses')}</h2>
        <div className="flex items-end gap-3 px-5 pb-4">
          <Field label={t('Nom de la nouvelle caisse')} className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Caisse 2" />
          </Field>
          <Button variant="primary" loading={add.isPending} disabled={!name.trim()} onClick={() => add.mutate()}>
            {t('Ajouter')}
          </Button>
        </div>
        {registers.isPending ? (
          <TableSkeleton rows={2} cols={3} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Nom')}</Th>
                <Th>{t('Session')}</Th>
                <Th>{t('Actif')}</Th>
              </tr>
            </thead>
            <tbody>
              {registers.data?.map((register) => (
                <tr key={register.id}>
                  <Td className="font-medium">{register.name}</Td>
                  <Td>
                    {register.openSession ? (
                      <Badge tone="info">
                        {t('Ouverte par {name}', { name: register.openSession.openedByName })}
                      </Badge>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <Checkbox
                      label=""
                      checked={register.isActive}
                      disabled={toggle.isPending}
                      onChange={(e) => toggle.mutate({ id: register.id, isActive: e.target.checked })}
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
