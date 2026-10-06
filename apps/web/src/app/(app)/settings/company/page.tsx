'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Company } from '@mizmar/contracts';
import { Icon } from '@/components/icons';
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
  Select,
  Skeleton,
  toast,
} from '@/components/ui';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { activeCompanyId } from '@/lib/session-client';

/** Free-text company columns, edited as plain strings (empty means null). */
const TEXT_KEYS = [
  'name', 'legalName', 'legalForm', 'ice', 'rc', 'taxId', 'patente', 'cnss', 'shareCapital',
  'addressLine1', 'addressLine2', 'city', 'postalCode', 'country',
  'email', 'phone', 'phone2', 'website', 'bankName', 'iban', 'rib', 'swift', 'defaultCurrency',
] as const;
type TextKey = (typeof TEXT_KEYS)[number];

interface Form {
  text: Record<TextKey, string>;
  defaultLocale: Company['defaultLocale'];
  priceMode: Company['priceMode'];
  roundingMode: Company['roundingMode'];
  roundingScale: string;
  roundingGranularity: Company['roundingGranularity'];
  negativeStockPolicy: Company['negativeStockPolicy'];
  defaultWarehouseId: string;
}

function toForm(company: Company): Form {
  const text = {} as Record<TextKey, string>;
  for (const key of TEXT_KEYS) text[key] = (company[key] as string | null) ?? '';
  return {
    text,
    defaultLocale: company.defaultLocale,
    priceMode: company.priceMode,
    roundingMode: company.roundingMode,
    roundingScale: String(company.roundingScale),
    roundingGranularity: company.roundingGranularity,
    negativeStockPolicy: company.negativeStockPolicy,
    defaultWarehouseId: company.defaultWarehouseId ?? '',
  };
}

export default function CompanySettingsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [companyId] = useState(() => activeCompanyId());
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });
  // Fall back to the first company when the cookie has not been set yet.
  const id = companyId ?? session.data?.companies[0]?.id ?? null;

  const company = useQuery({
    queryKey: ['company', id],
    queryFn: async () => unwrap(await api.companies.get({ params: { id: id! } })),
    enabled: Boolean(id),
  });
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  useEffect(() => {
    if (company.data) setForm(toForm(company.data));
  }, [company.data]);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const f = form!;
      const nullable = (key: TextKey) => f.text[key].trim() || null;
      const scale = Number(f.roundingScale);
      return unwrap(
        await api.companies.update({
          params: { id: id! },
          body: {
            name: f.text.name.trim(),
            legalName: nullable('legalName'),
            legalForm: nullable('legalForm'),
            ice: nullable('ice'),
            rc: nullable('rc'),
            taxId: nullable('taxId'),
            patente: nullable('patente'),
            cnss: nullable('cnss'),
            shareCapital: nullable('shareCapital'),
            addressLine1: nullable('addressLine1'),
            addressLine2: nullable('addressLine2'),
            city: nullable('city'),
            postalCode: nullable('postalCode'),
            country: f.text.country.trim() || 'MA',
            email: nullable('email'),
            phone: nullable('phone'),
            phone2: nullable('phone2'),
            website: nullable('website'),
            bankName: nullable('bankName'),
            iban: nullable('iban'),
            rib: nullable('rib'),
            swift: nullable('swift'),
            defaultCurrency: f.text.defaultCurrency.trim().toUpperCase() || 'MAD',
            defaultLocale: f.defaultLocale,
            priceMode: f.priceMode,
            roundingMode: f.roundingMode,
            roundingScale: Number.isInteger(scale) ? scale : 2,
            roundingGranularity: f.roundingGranularity,
            negativeStockPolicy: f.negativeStockPolicy,
            defaultWarehouseId: f.defaultWarehouseId || null,
          },
        }),
      );
    },
    onSuccess: () => {
      toast.success(t('Société enregistrée'));
      void queryClient.invalidateQueries({ queryKey: ['company'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  if (!form) {
    return (
      <div className="space-y-4" role="status" aria-label={t('Chargement')}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full rounded-card" />
        <Skeleton className="h-72 w-full rounded-card" />
      </div>
    );
  }

  const text = (key: TextKey, label: string, opts?: { required?: boolean; hint?: string; mono?: boolean }) => (
    <Field label={label} required={opts?.required} hint={opts?.hint}>
      <Input
        value={form.text[key]}
        className={opts?.mono ? 'font-mono' : undefined}
        onChange={(e) => setForm({ ...form, text: { ...form.text, [key]: e.target.value } })}
      />
    </Field>
  );
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });

  return (
    <>
      <PageHeader
        title={t('Société')}
        subtitle={t('Informations légales et paramètres par défaut')}
        actions={
          <>
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {t('Nouvelle société')}
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!form.text.name.trim()}
              onClick={() => save.mutate()}
            >
              <Icon name="check" />
              {t('Enregistrer')}
            </Button>
          </>
        }
      />
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader title={t('Identité')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {text('name', t('Nom commercial'), { required: true })}
            {text('legalName', t('Raison sociale'))}
            {text('legalForm', t('Forme juridique'), { hint: 'SARL, SA, SARL AU…' })}
            {text('shareCapital', t('Capital social'))}
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">{t('Logo')}</p>
              {company.data?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.data.logoUrl} alt={t('Logo')} className="h-16 rounded border border-border" />
              ) : (
                <p className="text-sm text-ink-subtle">
                  {company.data?.logoAssetId
                    ? t('Un logo est enregistré ; son aperçu n’est pas encore disponible.')
                    : t('Aucun logo. Le téléversement n’est pas encore pris en charge par l’API.')}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={t('Identifiants légaux')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {text('ice', 'ICE', { mono: true })}
            {text('rc', 'RC', { mono: true })}
            {text('taxId', t('Identifiant fiscal (IF)'), { mono: true })}
            {text('patente', t('Patente'), { mono: true })}
            {text('cnss', 'CNSS', { mono: true })}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('Adresse et contact')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">{text('addressLine1', t('Adresse'))}</div>
            <div className="sm:col-span-2">{text('addressLine2', t('Complément d’adresse'))}</div>
            {text('city', t('Ville'))}
            {text('postalCode', t('Code postal'))}
            {text('country', t('Pays'), { hint: t('Code ISO, ex. MA') })}
            <span className="hidden sm:block" />
            {text('email', t('E-mail'))}
            {text('website', t('Site web'))}
            {text('phone', t('Téléphone'))}
            {text('phone2', t('Téléphone 2'))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('Coordonnées bancaires')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {text('bankName', t('Banque'))}
            {text('swift', 'SWIFT / BIC', { mono: true })}
            {text('rib', 'RIB', { mono: true })}
            {text('iban', 'IBAN', { mono: true })}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('Valeurs par défaut')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {text('defaultCurrency', t('Devise'), { mono: true })}
            <Field label={t('Langue des documents')}>
              <Select value={form.defaultLocale} onChange={(e) => set('defaultLocale', e.target.value as Form['defaultLocale'])}>
                <option value="FR">Français</option>
                <option value="EN">English</option>
                <option value="AR">العربية</option>
              </Select>
            </Field>
            <Field label={t('Mode de prix')}>
              <Select value={form.priceMode} onChange={(e) => set('priceMode', e.target.value as Form['priceMode'])}>
                <option value="EXCLUSIVE">{t('Hors taxes (HT)')}</option>
                <option value="INCLUSIVE">{t('Toutes taxes comprises (TTC)')}</option>
              </Select>
            </Field>
            <Field label={t('Arrondi')}>
              <Select value={form.roundingMode} onChange={(e) => set('roundingMode', e.target.value as Form['roundingMode'])}>
                <option value="HALF_UP">{t('Au plus proche (0,5 vers le haut)')}</option>
                <option value="HALF_DOWN">{t('Au plus proche (0,5 vers le bas)')}</option>
                <option value="HALF_EVEN">{t('Au pair le plus proche')}</option>
                <option value="UP">{t('Vers le haut')}</option>
                <option value="DOWN">{t('Vers le bas')}</option>
              </Select>
            </Field>
            <Field label={t('Décimales')}>
              <NumberInput value={form.roundingScale} onChange={(e) => set('roundingScale', e.target.value)} />
            </Field>
            <Field label={t('Arrondir par')}>
              <Select
                value={form.roundingGranularity}
                onChange={(e) => set('roundingGranularity', e.target.value as Form['roundingGranularity'])}
              >
                <option value="LINE">{t('Ligne')}</option>
                <option value="DOCUMENT">{t('Document')}</option>
              </Select>
            </Field>
            <Field label={t('Stock négatif')}>
              <Select
                value={form.negativeStockPolicy}
                onChange={(e) => set('negativeStockPolicy', e.target.value as Form['negativeStockPolicy'])}
              >
                <option value="BLOCK">{t('Bloquer')}</option>
                <option value="WARN">{t('Avertir')}</option>
                <option value="ALLOW">{t('Autoriser')}</option>
              </Select>
            </Field>
            <Field label={t('Entrepôt par défaut')}>
              <Select value={form.defaultWarehouseId} onChange={(e) => set('defaultWarehouseId', e.target.value)}>
                <option value="">—</option>
                {warehouses.data?.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      </div>

      {creating && <CreateCompanyDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateCompanyDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [ice, setIce] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.companies.create({
          body: { code: code.trim(), name: name.trim(), ice: ice.trim() || null },
        }),
      );
    },
    onSuccess: () => {
      toast.success(t('Société créée'));
      // The switcher reads the company list from the session.
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Nouvelle société')}
      description={t('Une nouvelle entité légale dans votre organisation')}
      footer={
        <>
          <Button onClick={onClose}>{t('Annuler')}</Button>
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
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('Code')} required hint={t('Court, utilisé dans la numérotation (ex. MZM)')}>
          <Input value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label={t('Nom commercial')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ICE">
          <Input value={ice} className="font-mono" onChange={(e) => setIce(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
