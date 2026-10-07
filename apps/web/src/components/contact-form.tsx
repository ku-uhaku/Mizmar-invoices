'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Contact, ContactCreate } from '@mizmar/contracts';
import { useEffect, useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { Button, Checkbox, Dialog, ErrorNote, Field, Input, NumberInput, Select, Textarea, toast } from './ui';

type Kind = 'CLIENT' | 'SUPPLIER' | 'BOTH';
type PaymentTerm = NonNullable<ContactCreate['paymentTerm']>;

const PAYMENT_TERMS: { value: PaymentTerm; label: string }[] = [
  { value: 'IMMEDIATE', label: 'Immédiat' },
  { value: 'NET_15', label: '15 jours' },
  { value: 'NET_30', label: '30 jours' },
  { value: 'NET_45', label: '45 jours' },
  { value: 'NET_60', label: '60 jours' },
  { value: 'NET_90', label: '90 jours' },
  { value: 'END_OF_MONTH', label: 'Fin de mois' },
  { value: 'END_OF_NEXT_MONTH', label: 'Fin du mois suivant' },
  { value: 'CUSTOM', label: 'Personnalisé' },
];

interface FormState {
  kind: Kind;
  displayName: string;
  legalName: string;
  ice: string;
  rc: string;
  taxId: string;
  patente: string;
  email: string;
  phone: string;
  phone2: string;
  website: string;
  paymentTerm: PaymentTerm;
  paymentTermDays: string;
  creditLimit: string;
  defaultCurrency: string;
  defaultLocale: '' | 'EN' | 'FR' | 'AR';
  vatExempt: boolean;
  priceListId: string;
  notes: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
}

function initialState(contact: Contact | undefined, kind: Kind, name: string): FormState {
  const address = contact?.addresses.find((a) => a.kind === 'BILLING') ?? contact?.addresses[0];
  return {
    kind: contact?.kind ?? kind,
    displayName: contact?.displayName ?? name,
    legalName: contact?.legalName ?? '',
    ice: contact?.ice ?? '',
    rc: contact?.rc ?? '',
    taxId: contact?.taxId ?? '',
    patente: contact?.patente ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    phone2: contact?.phone2 ?? '',
    website: contact?.website ?? '',
    paymentTerm: contact?.paymentTerm ?? 'IMMEDIATE',
    paymentTermDays: contact?.paymentTermDays != null ? String(contact.paymentTermDays) : '',
    creditLimit: contact?.creditLimit ?? '',
    defaultCurrency: contact?.defaultCurrency ?? 'MAD',
    defaultLocale: contact?.defaultLocale ?? '',
    vatExempt: contact?.vatExempt ?? false,
    priceListId: contact?.priceListId ?? '',
    notes: contact?.notes ?? '',
    addressLine1: address?.addressLine1 ?? '',
    addressLine2: address?.addressLine2 ?? '',
    city: address?.city ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? 'MA',
  };
}

const blank = (value: string) => (value.trim() === '' ? undefined : value.trim());

/**
 * Create / edit a client or supplier. `defaultKind` and `initialName` let the
 * document editor open it pre-filled from the combobox "create" action, and
 * `onSaved` hands the saved contact back so the caller can select it.
 */
export function ContactForm({
  open,
  onClose,
  contact,
  defaultKind = 'CLIENT',
  initialName = '',
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  contact?: Contact;
  defaultKind?: Kind;
  initialName?: string;
  onSaved?: (contact: Contact) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const priceLists = useQuery({
    queryKey: ['price-lists'],
    queryFn: async () => unwrap(await api.pricing.listPriceLists()),
  });
  const [form, setForm] = useState<FormState>(() => initialState(contact, defaultKind, initialName));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time the dialog opens so a cancelled edit never lingers.
  useEffect(() => {
    if (open) {
      setForm(initialState(contact, defaultKind, initialName));
      setAttempted(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const errors = {
    displayName: form.displayName.trim() ? undefined : t('Nom obligatoire'),
    email:
      form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
        ? t('E-mail invalide')
        : undefined,
    address: form.addressLine1.trim() ? undefined : t('Adresse obligatoire'),
    creditLimit:
      form.creditLimit.trim() && !/^\d+([.,]\d+)?$/.test(form.creditLimit.trim())
        ? t('Montant invalide')
        : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (message?: string) => (attempted ? message : undefined);

  const save = useMutation({
    mutationFn: async () => {
      const address = {
        kind: 'BILLING' as const,
        addressLine1: form.addressLine1.trim(),
        addressLine2: blank(form.addressLine2),
        city: blank(form.city),
        postalCode: blank(form.postalCode),
        country: blank(form.country) ?? 'MA',
        isDefault: true,
      };
      // Only the billing address is edited here; other saved addresses stay.
      const others = (contact?.addresses ?? [])
        .filter((a) => a.id !== (contact?.addresses.find((x) => x.kind === 'BILLING') ?? contact?.addresses[0])?.id)
        .map(({ id: _id, ...rest }) => rest);
      const body = {
        kind: form.kind,
        displayName: form.displayName.trim(),
        legalName: blank(form.legalName),
        ice: blank(form.ice),
        rc: blank(form.rc),
        taxId: blank(form.taxId),
        patente: blank(form.patente),
        email: blank(form.email),
        phone: blank(form.phone),
        phone2: blank(form.phone2),
        website: blank(form.website),
        paymentTerm: form.paymentTerm,
        paymentTermDays:
          form.paymentTerm === 'CUSTOM' && form.paymentTermDays !== ''
            ? Number(form.paymentTermDays)
            : undefined,
        creditLimit: blank(form.creditLimit)?.replace(',', '.'),
        defaultCurrency: form.defaultCurrency.trim().toUpperCase() || 'MAD',
        defaultLocale: form.defaultLocale || undefined,
        vatExempt: form.vatExempt,
        priceListId: form.priceListId || null,
        notes: blank(form.notes),
        addresses: [address, ...others],
      };
      setError(null);
      return contact
        ? unwrap(await api.contacts.update({ params: { id: contact.id }, body }))
        : unwrap(await api.contacts.create({ body }));
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['statement'] });
      toast.success(contact ? t('Tiers mis à jour') : t('Tiers créé'));
      onSaved?.(saved);
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  function submit() {
    setAttempted(true);
    if (!invalid) save.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={contact ? t('Modifier le tiers') : t('Nouveau tiers')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Type')}>
            <Select value={form.kind} onChange={(event) => set('kind', event.target.value as Kind)}>
              <option value="CLIENT">{t('Client')}</option>
              <option value="SUPPLIER">{t('Fournisseur')}</option>
              <option value="BOTH">{t('Client & fournisseur')}</option>
            </Select>
          </Field>
          <Field label={t('Nom affiché')} required error={show(errors.displayName)}>
            <Input
              autoFocus
              value={form.displayName}
              onChange={(event) => set('displayName', event.target.value)}
            />
          </Field>
          <Field label={t('Raison sociale')}>
            <Input value={form.legalName} onChange={(event) => set('legalName', event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="ICE">
            <Input value={form.ice} onChange={(event) => set('ice', event.target.value)} />
          </Field>
          <Field label="RC">
            <Input value={form.rc} onChange={(event) => set('rc', event.target.value)} />
          </Field>
          <Field label="IF">
            <Input value={form.taxId} onChange={(event) => set('taxId', event.target.value)} />
          </Field>
          <Field label={t('Patente')}>
            <Input value={form.patente} onChange={(event) => set('patente', event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('E-mail')} error={show(errors.email)}>
            <Input
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
            />
          </Field>
          <Field label={t('Site web')}>
            <Input dir="ltr" value={form.website} onChange={(event) => set('website', event.target.value)} />
          </Field>
          <Field label={t('Téléphone')}>
            <Input dir="ltr" value={form.phone} onChange={(event) => set('phone', event.target.value)} />
          </Field>
          <Field label={t('Téléphone 2')}>
            <Input dir="ltr" value={form.phone2} onChange={(event) => set('phone2', event.target.value)} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t('Adresse de facturation')}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Adresse')} required error={show(errors.address)} className="sm:col-span-2">
              <Input
                value={form.addressLine1}
                onChange={(event) => set('addressLine1', event.target.value)}
              />
            </Field>
            <Field label={t('Complément')} className="sm:col-span-2">
              <Input
                value={form.addressLine2}
                onChange={(event) => set('addressLine2', event.target.value)}
              />
            </Field>
            <Field label={t('Ville')}>
              <Input value={form.city} onChange={(event) => set('city', event.target.value)} />
            </Field>
            <Field label={t('Code postal')}>
              <Input value={form.postalCode} onChange={(event) => set('postalCode', event.target.value)} />
            </Field>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Conditions de paiement')}>
            <Select
              value={form.paymentTerm}
              onChange={(event) => set('paymentTerm', event.target.value as PaymentTerm)}
            >
              {PAYMENT_TERMS.map((term) => (
                <option key={term.value} value={term.value}>
                  {t(term.label)}
                </option>
              ))}
            </Select>
          </Field>
          {form.paymentTerm === 'CUSTOM' && (
            <Field label={t('Délai (jours)')}>
              <NumberInput
                value={form.paymentTermDays}
                onChange={(event) => set('paymentTermDays', event.target.value.replace(/\D/g, ''))}
              />
            </Field>
          )}
          <Field label={t('Plafond d’encours')} error={show(errors.creditLimit)}>
            <NumberInput
              value={form.creditLimit}
              onChange={(event) => set('creditLimit', event.target.value)}
            />
          </Field>
          <Field label={t('Devise')}>
            <Input
              maxLength={3}
              dir="ltr"
              value={form.defaultCurrency}
              onChange={(event) => set('defaultCurrency', event.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('Liste de prix')}>
            <Select value={form.priceListId} onChange={(event) => set('priceListId', event.target.value)}>
              <option value="">{t('Aucune (prix par défaut)')}</option>
              {(priceLists.data ?? []).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.currency})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Langue des documents')}>
            <Select
              value={form.defaultLocale}
              onChange={(event) => set('defaultLocale', event.target.value as FormState['defaultLocale'])}
            >
              <option value="">{t('Par défaut')}</option>
              <option value="FR">Français</option>
              <option value="EN">English</option>
              <option value="AR">العربية</option>
            </Select>
          </Field>
        </div>

        <Checkbox
          label={t('Exonéré de TVA')}
          checked={form.vatExempt}
          onChange={(event) => set('vatExempt', event.target.checked)}
        />

        <Field label={t('Notes')}>
          <Textarea value={form.notes} onChange={(event) => set('notes', event.target.value)} />
        </Field>

        <ErrorNote>{error}</ErrorNote>
        {/* Lets Enter submit from any single-line input. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
