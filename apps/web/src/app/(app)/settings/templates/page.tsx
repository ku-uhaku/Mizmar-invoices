'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import type { TemplateConfigBody } from '@mizmar/contracts';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  Spinner,
  Textarea,
  toast,
} from '@/components/ui';
import { documentTypeLabel } from '@/lib/format';
import { PagePreview } from '@/components/page-preview';

type Section = 'branding' | 'style' | 'columns' | 'content' | 'locale' | 'pagination';

const SECTIONS: Array<{ value: Section; label: string }> = [
  { value: 'branding', label: 'En-tête' },
  { value: 'style', label: 'Couleurs & typo' },
  { value: 'columns', label: 'Colonnes' },
  { value: 'content', label: 'Blocs' },
  { value: 'locale', label: 'Langue & formats' },
  { value: 'pagination', label: 'Pagination' },
];

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [config, setConfig] = useState<TemplateConfigBody | null>(null);
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState<string>('');
  const [section, setSection] = useState<Section>('branding');
  const [previewLocale, setPreviewLocale] = useState<'FR' | 'EN' | 'AR'>('FR');
  const [sampleLines, setSampleLines] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'settings' | 'preview'>('settings');

  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: async () => unwrap(await api.templates.list({ query: {} })),
  });

  // Load the first template once the list arrives; the API always returns at
  // least the built-in default, so the editor is never empty.
  useEffect(() => {
    if (config || !templates.data?.length) return;
    const first = templates.data[0]!;
    setSelectedId(first.id);
    setConfig(first.config);
    setName(first.name);
    setDocumentType(first.documentType ?? '');
  }, [templates.data, config]);

  /**
   * The live preview is rendered by the API using the very same template code
   * that produces the PDF, so what is on screen is what will print.
   */
  const preview = useQuery({
    queryKey: ['template-preview', config, previewLocale, sampleLines, documentType],
    queryFn: async () =>
      unwrap(
        await api.templates.preview({
          body: {
            config: config!,
            documentType: (documentType || 'SALES_INVOICE') as 'SALES_INVOICE',
            locale: previewLocale,
            sampleLineCount: sampleLines,
          },
        }),
      ),
    enabled: Boolean(config),
    // Dragging a colour picker should not queue a render per frame.
    staleTime: 0,
    placeholderData: (previous) => previous,
  });

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const body = {
        name,
        documentType: (documentType || null) as 'SALES_INVOICE' | null,
        isDefault: true,
        config: config!,
      };
      return selectedId && selectedId !== 'default'
        ? unwrap(await api.templates.update({ params: { id: selectedId }, body }))
        : unwrap(await api.templates.create({ body }));
    },
    onSuccess: (saved) => {
      setSelectedId(saved.id);
      toast.success('Modèle enregistré');
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible'),
  });

  const patch = useMemo(
    () =>
      <K extends keyof TemplateConfigBody>(key: K, value: Partial<TemplateConfigBody[K]>) =>
        setConfig((current) =>
          current ? { ...current, [key]: { ...current[key], ...value } } : current,
        ),
    [],
  );

  if (!config) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <Skeleton className="h-96 w-full rounded-card" />
          <Skeleton className="h-[32rem] w-full rounded-card" />
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Modèles de document"
        subtitle="L’aperçu est rendu par le même moteur que le PDF"
        actions={
          <>
            <div className="w-56 max-w-full">
              <Select
                value={selectedId ?? ''}
                onChange={(event) => {
                  const template = templates.data?.find((t) => t.id === event.target.value);
                  if (!template) return;
                  setSelectedId(template.id);
                  setConfig(template.config);
                  setName(template.name);
                  setDocumentType(template.documentType ?? '');
                }}
                className="w-full"
              >
                {templates.data?.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.documentType ? ` (${documentTypeLabel(template.documentType)})` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              <Icon name="check" />
              Enregistrer
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Segmented
        className="mb-4 xl:hidden"
        value={mobileTab}
        onChange={setMobileTab}
        options={[
          { value: 'settings', label: 'Réglages' },
          { value: 'preview', label: 'Aperçu' },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className={clsx('min-w-0 space-y-4', mobileTab === 'preview' && 'hidden xl:block')}>
          <Card>
            <CardHeader title="Modèle" description="Nom et documents concernés" />
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="Nom du modèle">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="S’applique à">
                <Select
                  value={documentType}
                  onChange={(event) => setDocumentType(event.target.value)}
                >
                  <option value="">Tous les documents</option>
                  {['DEVIS', 'SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE', 'CREDIT_NOTE'].map(
                    (value) => (
                      <option key={value} value={value}>
                        {documentTypeLabel(value)}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <div className="border-b border-border p-2.5">
              <Segmented
                value={section}
                onChange={setSection}
                options={SECTIONS}
                className="w-full"
              />
            </div>

            <div className="space-y-4 p-5">
              {section === 'branding' && (
                <>
                  <Group title="Mise en page">
                    <Field label="Disposition de l’en-tête">
                      <Select
                        value={config.branding.headerLayout}
                        onChange={(event) =>
                          patch('branding', { headerLayout: event.target.value as 'LOGO_LEFT' })
                        }
                      >
                        <option value="LOGO_LEFT">Logo à gauche</option>
                        <option value="LOGO_CENTER">Logo centré</option>
                        <option value="BANNER">Bandeau coloré</option>
                        <option value="MINIMAL">Minimal</option>
                      </Select>
                    </Field>
                    <Field label="Position du logo">
                      <Select
                        value={config.branding.logoPosition}
                        onChange={(event) =>
                          patch('branding', { logoPosition: event.target.value as 'LEFT' })
                        }
                      >
                        <option value="LEFT">Gauche</option>
                        <option value="CENTER">Centre</option>
                        <option value="RIGHT">Droite</option>
                      </Select>
                    </Field>
                    <Range
                      label="Largeur du logo"
                      unit="mm"
                      min={10}
                      max={120}
                      value={config.branding.logoWidthMm}
                      onChange={(value) => patch('branding', { logoWidthMm: value })}
                    />
                  </Group>
                  <Group title="Signature">
                    <Toggle
                      label="Afficher la zone de signature"
                      checked={config.branding.showSignature}
                      onChange={(v) => patch('branding', { showSignature: v })}
                    />
                    <Toggle
                      label="Afficher le cachet"
                      checked={config.branding.showStamp}
                      onChange={(v) => patch('branding', { showStamp: v })}
                    />
                  </Group>
                </>
              )}

              {section === 'style' && (
                <>
                  <Group title="Couleurs">
                    <Color
                      label="Couleur principale"
                      value={config.colors.primary}
                      onChange={(value) =>
                        patch('colors', { primary: value, tableHeaderBackground: value })
                      }
                    />
                    <Color
                      label="Couleur d’accent"
                      value={config.colors.accent}
                      onChange={(value) => patch('colors', { accent: value })}
                    />
                    <Color
                      label="Fond d’en-tête de tableau"
                      value={config.colors.tableHeaderBackground}
                      onChange={(value) => patch('colors', { tableHeaderBackground: value })}
                    />
                    <Color
                      label="Texte d’en-tête de tableau"
                      value={config.colors.tableHeaderText}
                      onChange={(value) => patch('colors', { tableHeaderText: value })}
                    />
                    <Toggle
                      label="Lignes alternées"
                      checked={config.colors.zebraStriping}
                      onChange={(v) => patch('colors', { zebraStriping: v })}
                    />
                  </Group>
                  <Group title="Typographie">
                    <Field label="Police du corps">
                      <Select
                        value={config.typography.bodyFont}
                        onChange={(event) =>
                          patch('typography', {
                            bodyFont: event.target.value as 'Inter',
                            headingFont: event.target.value as 'Inter',
                          })
                        }
                      >
                        <option value="Inter">Inter</option>
                        <option value="Roboto">Roboto</option>
                        <option value="Lato">Lato</option>
                        <option value="Merriweather">Merriweather</option>
                      </Select>
                    </Field>
                    <Range
                      label="Taille du texte"
                      unit="pt"
                      min={6}
                      max={14}
                      step={0.5}
                      value={config.typography.baseSizePt}
                      onChange={(value) => patch('typography', { baseSizePt: value })}
                    />
                    <Range
                      label="Interligne"
                      min={1}
                      max={2.2}
                      step={0.05}
                      value={config.typography.lineHeight}
                      onChange={(value) => patch('typography', { lineHeight: value })}
                    />
                  </Group>
                </>
              )}

              {section === 'columns' && (
                <>
                  <Group title="Colonnes affichées">
                    <Toggle
                      label="Image de l’article"
                      checked={config.columns.showImage}
                      onChange={(v) => patch('columns', { showImage: v })}
                    />
                    <Toggle
                      label="Référence (SKU)"
                      checked={config.columns.showSku}
                      onChange={(v) => patch('columns', { showSku: v })}
                    />
                    <Toggle
                      label="Code-barres"
                      checked={config.columns.showBarcode}
                      onChange={(v) => patch('columns', { showBarcode: v })}
                    />
                    <Toggle
                      label="Unité"
                      checked={config.columns.showUnit}
                      onChange={(v) => patch('columns', { showUnit: v })}
                    />
                    <Toggle
                      label="Remise par ligne"
                      checked={config.columns.showLineDiscount}
                      onChange={(v) => patch('columns', { showLineDiscount: v })}
                    />
                    <Toggle
                      label="TVA par ligne"
                      checked={config.columns.showVatPerLine}
                      onChange={(v) => patch('columns', { showVatPerLine: v })}
                    />
                    <Toggle
                      label="Référence du BL d’origine"
                      hint="Utile sur une facture regroupant plusieurs livraisons"
                      checked={config.columns.showSourceReference}
                      onChange={(v) => patch('columns', { showSourceReference: v })}
                    />
                  </Group>
                  <Group title="Dimensions">
                    <Range
                      label="Largeur de la désignation"
                      unit="%"
                      min={20}
                      max={70}
                      value={config.columns.descriptionWidthPercent}
                      onChange={(value) => patch('columns', { descriptionWidthPercent: value })}
                    />
                  </Group>
                </>
              )}

              {section === 'content' && (
                <>
                  <Group title="Blocs affichés">
                    <Toggle
                      label="Récapitulatif TVA"
                      checked={config.content.showVatSummaryTable}
                      onChange={(v) => patch('content', { showVatSummaryTable: v })}
                    />
                    <Toggle
                      label="Montant en lettres"
                      checked={config.content.showAmountInWords}
                      onChange={(v) => patch('content', { showAmountInWords: v })}
                    />
                    <Toggle
                      label="Acompte et reste à payer"
                      checked={config.content.showDepositAndBalance}
                      onChange={(v) => patch('content', { showDepositAndBalance: v })}
                    />
                    <Toggle
                      label="Coordonnées bancaires"
                      checked={config.content.showBankDetails}
                      onChange={(v) => patch('content', { showBankDetails: v })}
                    />
                    <Toggle
                      label="Zones de signature"
                      checked={config.content.showSignatureZones}
                      onChange={(v) => patch('content', { showSignatureZones: v })}
                    />
                    <Toggle
                      label="Identifiants fiscaux du client"
                      checked={config.content.showContactTaxIds}
                      onChange={(v) => patch('content', { showContactTaxIds: v })}
                    />
                  </Group>
                  <Group title="Textes">
                    <Field label="Conditions générales">
                      <Textarea
                        value={config.content.termsAndConditions}
                        onChange={(event) =>
                          patch('content', { termsAndConditions: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Modalités de paiement">
                      <Textarea
                        value={config.content.paymentInstructions}
                        onChange={(event) =>
                          patch('content', { paymentInstructions: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Pied de page">
                      <Input
                        value={config.content.footerText}
                        onChange={(event) => patch('content', { footerText: event.target.value })}
                      />
                    </Field>
                    <Field label="Mentions légales">
                      <Textarea
                        value={config.content.legalMentions}
                        onChange={(event) =>
                          patch('content', { legalMentions: event.target.value })
                        }
                      />
                    </Field>
                  </Group>
                </>
              )}

              {section === 'locale' && (
                <>
                  <Group title="Langue">
                    <Field label="Langue du document">
                      <Select
                        value={config.localeOptions.locale}
                        onChange={(event) => {
                          patch('localeOptions', { locale: event.target.value as 'FR' });
                          setPreviewLocale(event.target.value as 'FR');
                        }}
                      >
                        <option value="FR">Français</option>
                        <option value="EN">English</option>
                        <option value="AR">العربية</option>
                      </Select>
                    </Field>
                    <Field label="Sens de lecture" hint="« Auto » suit la langue choisie">
                      <Select
                        value={config.localeOptions.direction}
                        onChange={(event) =>
                          patch('localeOptions', { direction: event.target.value as 'AUTO' })
                        }
                      >
                        <option value="AUTO">Auto</option>
                        <option value="LTR">Gauche → droite</option>
                        <option value="RTL">Droite → gauche</option>
                      </Select>
                    </Field>
                  </Group>
                  <Group title="Formats">
                    <Field label="Devise">
                      <Input
                        value={config.localeOptions.currency}
                        onChange={(event) =>
                          patch('localeOptions', { currency: event.target.value.toUpperCase() })
                        }
                      />
                    </Field>
                    <Field label="Position du symbole">
                      <Select
                        value={config.localeOptions.currencySymbolPosition}
                        onChange={(event) =>
                          patch('localeOptions', {
                            currencySymbolPosition: event.target.value as 'AFTER',
                          })
                        }
                      >
                        <option value="AFTER">Après le montant</option>
                        <option value="BEFORE">Avant le montant</option>
                      </Select>
                    </Field>
                    <Field label="Format de date">
                      <Select
                        value={config.localeOptions.dateFormat}
                        onChange={(event) =>
                          patch('localeOptions', { dateFormat: event.target.value as 'DD/MM/YYYY' })
                        }
                      >
                        <option value="DD/MM/YYYY">31/12/2026</option>
                        <option value="YYYY-MM-DD">2026-12-31</option>
                        <option value="DD-MM-YYYY">31-12-2026</option>
                        <option value="MM/DD/YYYY">12/31/2026</option>
                      </Select>
                    </Field>
                    <Toggle
                      label="Chiffres arabes (٠١٢٣)"
                      checked={config.localeOptions.useArabicIndicDigits}
                      onChange={(v) => patch('localeOptions', { useArabicIndicDigits: v })}
                    />
                  </Group>
                </>
              )}

              {section === 'pagination' && (
                <>
                  <Group title="Page">
                    <Field label="Format de page">
                      <Select
                        value={config.layout.pageSize}
                        onChange={(event) =>
                          patch('layout', { pageSize: event.target.value as 'A4' })
                        }
                      >
                        <option value="A4">A4</option>
                        <option value="LETTER">Letter</option>
                      </Select>
                    </Field>
                    <Field label="Orientation">
                      <Select
                        value={config.layout.orientation}
                        onChange={(event) =>
                          patch('layout', { orientation: event.target.value as 'PORTRAIT' })
                        }
                      >
                        <option value="PORTRAIT">Portrait</option>
                        <option value="LANDSCAPE">Paysage</option>
                      </Select>
                    </Field>
                    <Range
                      label="Marge haute"
                      unit="mm"
                      min={5}
                      max={40}
                      value={config.layout.marginTopMm}
                      onChange={(value) => patch('layout', { marginTopMm: value })}
                    />
                    <Range
                      label="Marge basse"
                      unit="mm"
                      min={5}
                      max={40}
                      value={config.layout.marginBottomMm}
                      onChange={(value) => patch('layout', { marginBottomMm: value })}
                    />
                  </Group>
                  <Group title="Numérotation">
                    <Toggle
                      label="Numéroter les pages"
                      checked={config.pagination.showPageNumbers}
                      onChange={(v) => patch('pagination', { showPageNumbers: v })}
                    />
                    <Field label="Format du numéro">
                      <Select
                        value={config.pagination.pageNumberFormat}
                        onChange={(event) =>
                          patch('pagination', { pageNumberFormat: event.target.value as 'X_OF_Y' })
                        }
                      >
                        <option value="X_OF_Y">Page 1 sur 3</option>
                        <option value="X_SLASH_Y">1 / 3</option>
                        <option value="X_ONLY">Page 1</option>
                      </Select>
                    </Field>
                  </Group>
                  <Group title="Découpage">
                    <Toggle
                      label="Répéter l’en-tête du tableau sur chaque page"
                      hint="Sinon les pages suivantes n’ont pas de libellés de colonnes"
                      checked={config.pagination.repeatTableHeader}
                      onChange={(v) => patch('pagination', { repeatTableHeader: v })}
                    />
                    <Toggle
                      label="Ne pas couper une ligne entre deux pages"
                      checked={config.pagination.keepLineGroupsTogether}
                      onChange={(v) => patch('pagination', { keepLineGroupsTogether: v })}
                    />
                    <Toggle
                      label="Garder les totaux avec le tableau"
                      hint="Évite que le montant dû se retrouve seul sur la dernière page"
                      checked={config.pagination.keepTotalsWithTable}
                      onChange={(v) => patch('pagination', { keepTotalsWithTable: v })}
                    />
                  </Group>
                </>
              )}
            </div>
          </Card>
        </div>

        <Card
          className={clsx(
            'min-w-0 self-start overflow-hidden xl:sticky xl:top-20',
            mobileTab === 'settings' && 'hidden xl:block',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Aperçu</span>
              {preview.isFetching && <Spinner className="size-3.5 text-ink-muted" />}
              {preview.data && (
                <span className="text-xs text-ink-muted">
                  ≈ {preview.data.pageCountEstimate} page(s)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={previewLocale}
                onChange={(event) => setPreviewLocale(event.target.value as 'FR')}
                className="w-full"
              >
                <option value="FR">Français</option>
                <option value="EN">English</option>
                <option value="AR">العربية</option>
              </Select>
              <Select
                value={String(sampleLines)}
                onChange={(event) => setSampleLines(Number(event.target.value))}
                className="w-full"
              >
                <option value="6">6 lignes</option>
                <option value="30">30 lignes</option>
                <option value="80">80 lignes</option>
              </Select>
            </div>
          </div>

          <div className="h-[70vh] xl:h-[calc(100vh-11.5rem)]">
            {preview.data ? (
              // The preview is the same HTML the PDF renderer consumes, which
              // is what makes this honestly WYSIWYG rather than a mock-up.
              <PagePreview html={preview.data.html} title="Aperçu du document" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-muted p-8">
                <Skeleton className="aspect-[794/1123] h-full max-h-[80%] rounded-md" />
                <p className="text-sm text-ink-muted">Rendu en cours…</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg py-0.5">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-subtle">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-border-strong transition peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:start-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-surface after:shadow-sm after:transition-all peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4"
      />
    </label>
  );
}

/** A titled cluster of related controls inside a section. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border-t border-border pt-5 first:border-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="size-9 shrink-0 cursor-pointer rounded border border-border-strong bg-surface p-0.5"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="font-mono text-xs"
        />
      </div>
    </Field>
  );
}

function Range({
  label,
  unit,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field
      label={
        <span className="flex items-center justify-between">
          <span>{label}</span>
          <span className="tabular text-ink">
            {value}
            {unit ?? ''}
          </span>
        </span>
      }
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-brand"
      />
    </Field>
  );
}
