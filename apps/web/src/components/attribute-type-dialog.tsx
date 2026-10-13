'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Button, Dialog, ErrorNote, Field, IconButton, Input, toast } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

export function AttributeTypeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Array<{ value: string; colorHex: string }>>([
    { value: '', colorHex: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      const filled = values.filter((entry) => entry.value.trim());
      return unwrap(
        await api.catalog.createAttributeType({
          body: {
            code: code.trim().toUpperCase(),
            name: name.trim(),
            sortOrder: 0,
            values: filled.map((entry, index) => ({
              value: entry.value.trim(),
              sortOrder: index,
              ...(/^#[0-9a-fA-F]{6}$/.test(entry.colorHex) ? { colorHex: entry.colorHex } : {}),
            })),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attribute-types'] });
      toast.success(t('Attribut créé'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Nouvel attribut')}
      description={t('Une dimension de variante, par exemple la taille ou la couleur.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!code.trim() || !name.trim()}
            onClick={() => create.mutate()}
          >
            {t('Créer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={t('Code')} required>
            <Input
              value={code}
              maxLength={40}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('Valeurs')}</p>
          <div className="space-y-2">
            {values.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={t('Valeur')}
                  value={entry.value}
                  onChange={(event) =>
                    setValues((current) =>
                      current.map((v, i) => (i === index ? { ...v, value: event.target.value } : v)),
                    )
                  }
                />
                <input
                  type="color"
                  aria-label={t('Couleur')}
                  value={/^#[0-9a-fA-F]{6}$/.test(entry.colorHex) ? entry.colorHex : '#ffffff'}
                  onChange={(event) =>
                    setValues((current) =>
                      current.map((v, i) => (i === index ? { ...v, colorHex: event.target.value } : v)),
                    )
                  }
                  className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
                />
                <IconButton
                  label={t('Retirer')}
                  onClick={() => setValues((current) => current.filter((_, i) => i !== index))}
                  className="hover:bg-danger-soft hover:text-danger"
                >
                  <Icon name="x" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setValues((current) => [...current, { value: '', colorHex: '' }])}
          >
            <Icon name="plus" /> {t('Ajouter une valeur')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
