'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import type { recurringSchemas } from '@mizmar/contracts';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { Combobox } from './combobox';
import { Icon } from './icons';
import { Button, Dialog, ErrorNote, Field, Input, Select, Textarea, toast } from './ui';

export type RecurringSchedule = z.infer<typeof recurringSchemas.recurringInvoice>;
type Template = z.infer<typeof recurringSchemas.recurringTemplate>;
type TemplateLine = Template['lines'][number];

const todayIso = () => new Date().toISOString().slice(0, 10);

const blankLine = (): TemplateLine => ({
  description: '',
  quantity: '1',
  unitPrice: '0',
  vatRate: '20',
  isNote: false,
  isService: true,
});

/**
 * Create or edit a schedule. Lines are edited in a deliberately small grid
 * (description, quantity, price, VAT); anything else the template carries
 * (variant, warehouse, discount, ... from "make recurring" on an invoice) is
 * preserved untouched.
 */
export function RecurringFormDialog({
  schedule,
  onClose,
}: {
  schedule: RecurringSchedule | null;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();

  const [name, setName] = useState(schedule?.name ?? '');
  const [contactId, setContactId] = useState(schedule?.contactId ?? '');
  const [contactLabel, setContactLabel] = useState(schedule?.contactName ?? '');
  const [contactSearch, setContactSearch] = useState('');
  const [frequency, setFrequency] = useState(schedule?.frequency ?? 'MONTHLY');
  const [interval, setIntervalValue] = useState(String(schedule?.interval ?? 1));
  const [startDate, setStartDate] = useState(schedule?.startDate ?? todayIso());
  const [endDate, setEndDate] = useState(schedule?.endDate ?? '');
  const [maxOccurrences, setMaxOccurrences] = useState(
    schedule?.maxOccurrences ? String(schedule.maxOccurrences) : '',
  );
  const [mode, setMode] = useState(schedule?.mode ?? 'DRAFT');
  const [lines, setLines] = useState<TemplateLine[]>(
    schedule?.template.lines.length ? schedule.template.lines : [blankLine()],
  );
  const [notes, setNotes] = useState(schedule?.template.notes ?? '');
  const [terms, setTerms] = useState(schedule?.template.terms ?? '');
  const [error, setError] = useState<string | null>(null);

  const contacts = useQuery({
    queryKey: ['contacts', 'picker', 'CLIENT', contactSearch],
    queryFn: async () =>
      unwrap(
        await api.contacts.list({
          query: { limit: 20, kind: 'CLIENT', ...(contactSearch ? { search: contactSearch } : {}) },
        }),
      ),
    placeholderData: (previous) => previous,
  });

  const patchLine = (index: number, patch: Partial<TemplateLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!name.trim()) throw new Error(t('Donnez un nom à cette facture récurrente'));
      if (!contactId) throw new Error(t('Sélectionnez un tiers'));
      const usable = lines.filter((line) => line.isNote || Number(line.quantity) > 0);
      if (usable.length === 0) throw new Error(t('Ajoutez au moins une ligne'));

      const body = {
        name: name.trim(),
        contactId,
        template: {
          ...(schedule?.template ?? {}),
          lines: usable.map((line, index) => ({ ...line, sortOrder: index + 1 })),
          notes: notes.trim() || null,
          terms: terms.trim() || null,
        },
        frequency,
        interval: Math.max(1, Number(interval) || 1),
        startDate,
        endDate: endDate || null,
        maxOccurrences: maxOccurrences ? Number(maxOccurrences) : null,
        mode,
      };
      return schedule
        ? unwrap(await api.recurring.update({ params: { id: schedule.id }, body }))
        : unwrap(await api.recurring.create({ body: { ...body, isActive: true } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      toast.success(schedule ? t('Facture récurrente mise à jour') : t('Facture récurrente créée'));
      onClose();
    },
    onError: (cause) =>
      setError(
        cause instanceof ApiError || cause instanceof Error ? cause.message : t('Enregistrement impossible'),
      ),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={schedule ? t('Modifier la facture récurrente') : t('Nouvelle facture récurrente')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Nom')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('Client')} required>
            <Combobox
              value={contactId}
              selectedLabel={contactLabel}
              placeholder={t('— Sélectionner —')}
              searchPlaceholder={t('Nom, ICE, téléphone…')}
              options={(contacts.data?.items ?? []).map((contact) => ({
                value: contact.id,
                label: contact.displayName,
              }))}
              loading={contacts.isFetching}
              onSearch={setContactSearch}
              onChange={(value, option) => {
                setContactId(value);
                if (option) setContactLabel(option.label);
              }}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t('Fréquence')}>
            <Select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}>
              <option value="WEEKLY">{t('Hebdomadaire')}</option>
              <option value="MONTHLY">{t('Mensuelle')}</option>
              <option value="QUARTERLY">{t('Trimestrielle')}</option>
              <option value="YEARLY">{t('Annuelle')}</option>
            </Select>
          </Field>
          <Field label={t('Tous les')} hint={t('Intervalle (1 = chaque période)')}>
            <Input
              type="number"
              min={1}
              value={interval}
              onChange={(event) => setIntervalValue(event.target.value)}
            />
          </Field>
          <Field label={t('Première échéance')} hint={t('Le jour du mois sert d’ancre (31 → fin de mois)')}>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label={t('Mode')}>
            <Select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="DRAFT">{t('Brouillon')}</option>
              <option value="VALIDATE">{t('Valider')}</option>
              <option value="VALIDATE_AND_EMAIL">{t('Valider et envoyer par e-mail')}</option>
            </Select>
          </Field>
          <Field label={t('Date de fin')} hint={t('Optionnelle')}>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
          <Field label={t('Nombre max. de factures')} hint={t('Optionnel')}>
            <Input
              type="number"
              min={1}
              value={maxOccurrences}
              onChange={(event) => setMaxOccurrences(event.target.value)}
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">{t('Lignes')}</p>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_5rem_7rem_5rem_2rem] items-center gap-2">
                <Input
                  placeholder={t('Description')}
                  aria-label={t('Description')}
                  value={line.description ?? ''}
                  onChange={(event) => patchLine(index, { description: event.target.value })}
                />
                <Input
                  inputMode="decimal"
                  aria-label={t('Quantité')}
                  value={line.quantity}
                  onChange={(event) => patchLine(index, { quantity: event.target.value })}
                />
                <Input
                  inputMode="decimal"
                  aria-label={t('Prix unitaire')}
                  value={line.unitPrice ?? ''}
                  onChange={(event) => patchLine(index, { unitPrice: event.target.value })}
                />
                <Input
                  inputMode="decimal"
                  aria-label={t('TVA %')}
                  value={line.vatRate ?? ''}
                  onChange={(event) => patchLine(index, { vatRate: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={t('Supprimer la ligne')}
                  className="text-ink-subtle hover:text-danger"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                >
                  <Icon name="x" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLines((c) => [...c, blankLine()])}>
            <Icon name="plus" /> {t('Ajouter une ligne')}
          </Button>
          <p className="mt-1 text-xs text-ink-subtle">
            {t('Quantité · Prix unitaire HT · TVA %')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Notes')}>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Field label={t('Conditions de paiement')}>
            <Textarea value={terms} onChange={(event) => setTerms(event.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
