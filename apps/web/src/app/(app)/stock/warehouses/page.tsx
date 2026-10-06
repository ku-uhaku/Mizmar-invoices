'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { StockTabs } from '@/components/stock-tabs';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  isActive: boolean;
}

export default function WarehousesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  // Deactivating (never deleting) keeps the stock ledger and documents intact.
  const toggle = useMutation({
    mutationFn: async (warehouse: Warehouse) =>
      unwrap(
        await api.inventory.updateWarehouse({
          params: { id: warehouse.id },
          body: { isActive: !warehouse.isActive },
        }),
      ),
    onSuccess: (warehouse) => {
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success(warehouse.isActive ? t('Entrepôt réactivé') : t('Entrepôt désactivé'));
    },
    onError: (cause) =>
      toast.error(cause instanceof ApiError ? cause.message : t('Action impossible')),
  });

  return (
    <>
      <PageHeader
        title={t('Stock')}
        subtitle={t('Entrepôts et lieux de stockage')}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {t('Nouvel entrepôt')}
          </Button>
        }
      />
      <StockTabs />

      <Card className="overflow-hidden">
        {warehouses.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : warehouses.data && warehouses.data.length > 0 ? (
          <Table className="min-w-[640px]">
            <thead>
              <tr>
                <Th>{t('Code')}</Th>
                <Th>{t('Nom')}</Th>
                <Th>{t('Ville')}</Th>
                <Th>{t('Adresse')}</Th>
                <Th>{t('État')}</Th>
                <Th className="w-48" />
              </tr>
            </thead>
            <tbody>
              {warehouses.data.map((warehouse) => (
                <tr key={warehouse.id} className="hover:bg-surface-muted/60">
                  <Td className="font-semibold">{warehouse.code}</Td>
                  <Td>{warehouse.name}</Td>
                  <Td className="text-ink-muted">{warehouse.city ?? '—'}</Td>
                  <Td className="text-ink-muted">{warehouse.address ?? '—'}</Td>
                  <Td>
                    <Badge tone={warehouse.isActive ? 'success' : 'neutral'}>
                      {warehouse.isActive ? t('Actif') : t('Inactif')}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(warehouse)}>
                        {t('Modifier')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={toggle.isPending && toggle.variables?.id === warehouse.id}
                        onClick={() => toggle.mutate(warehouse)}
                      >
                        {warehouse.isActive ? t('Désactiver') : t('Réactiver')}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="warehouse"
            title={t('Aucun entrepôt')}
            description={t('Créez un entrepôt pour suivre le stock par lieu.')}
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Icon name="plus" /> {t('Nouvel entrepôt')}
              </Button>
            }
          />
        )}
      </Card>

      {editing && (
        <WarehouseDialog
          // Remount per target so the form state always starts from the right row.
          key={editing === 'new' ? 'new' : editing.id}
          warehouse={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function WarehouseDialog({
  warehouse,
  onClose,
}: {
  warehouse: Warehouse | null;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(warehouse?.code ?? '');
  const [name, setName] = useState(warehouse?.name ?? '');
  const [city, setCity] = useState(warehouse?.city ?? '');
  const [address, setAddress] = useState(warehouse?.address ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const body = {
        code: code.trim(),
        name: name.trim(),
        city: city.trim(),
        address: address.trim(),
      };
      if (warehouse) {
        return unwrap(await api.inventory.updateWarehouse({ params: { id: warehouse.id }, body }));
      }
      return unwrap(
        await api.inventory.createWarehouse({
          body: {
            code: body.code,
            name: body.name,
            ...(body.city ? { city: body.city } : {}),
            ...(body.address ? { address: body.address } : {}),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success(warehouse ? t('Entrepôt mis à jour') : t('Entrepôt créé'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={warehouse ? t('Modifier l’entrepôt') : t('Nouvel entrepôt')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!code.trim() || !name.trim()}
            onClick={() => save.mutate()}
          >
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Code')} required>
            <Input
              value={code}
              maxLength={20}
              autoFocus
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('Nom')} required>
            <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('Ville')}>
            <Input value={city} maxLength={100} onChange={(event) => setCity(event.target.value)} />
          </Field>
          <Field label={t('Adresse')}>
            <Input
              value={address}
              maxLength={300}
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
