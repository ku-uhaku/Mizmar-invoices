'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { importSchemas, type ImportCommitResponse, type ImportPreviewResponse } from '@mizmar/contracts';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { Icon } from './icons';
import { Badge, Button, Dialog, ErrorNote, Select, Table, Td, Textarea, Th, toast } from './ui';

type Kind = 'products' | 'contacts';
type Mode = 'skip' | 'update';
type ContactKind = 'CLIENT' | 'SUPPLIER' | 'BOTH';

const MAX_BYTES = importSchemas.IMPORT_MAX_BYTES;
/** Preview rows rendered at once; the counts above the table cover the whole file. */
const VISIBLE_ROWS = 200;

const COLUMNS: Record<Kind, string[]> = {
  products: ['sku', 'name', 'barcode', 'category', 'sellingPrice', 'vatRate', 'openingStock'],
  contacts: ['displayName', 'kind', 'ice', 'email', 'phone', 'paymentTerm'],
};

const COLUMN_LABELS: Record<string, string> = {
  sku: 'Référence',
  name: 'Désignation',
  barcode: 'Code-barres',
  category: 'Catégorie',
  sellingPrice: 'Prix de vente',
  vatRate: 'TVA',
  openingStock: 'Stock initial',
  displayName: 'Raison sociale',
  kind: 'Type',
  ice: 'ICE',
  email: 'E-mail',
  phone: 'Téléphone',
  paymentTerm: 'Conditions',
};

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Bulk CSV import for products and contacts.
 *
 * The file is read client-side and posted as text. The server re-parses it on
 * commit, so what is written is always what the server validated.
 */
export function ImportDialog({
  kind,
  open,
  onClose,
  defaultContactKind = 'CLIENT',
}: {
  kind: Kind;
  open: boolean;
  onClose: () => void;
  defaultContactKind?: ContactKind;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  // One key per distinct commit attempt: a double click or retry replays the first answer.
  const idempotencyKey = useRef<string | null>(null);

  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('skip');
  const [contactKind, setContactKind] = useState<ContactKind>(defaultContactKind);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const reset = () => {
    setCsv('');
    setFileName(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setMode('skip');
    idempotencyKey.current = null;
  };

  const close = () => {
    reset();
    onClose();
  };

  const body = {
    csv,
    ...(kind === 'contacts' ? { defaultKind: contactKind } : {}),
  };

  const describe = (e: unknown) =>
    e instanceof ApiError ? e.message : t('Une erreur est survenue');

  const previewMutation = useMutation({
    mutationFn: async () => unwrap(await api.imports.preview({ params: { kind }, body })),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
      idempotencyKey.current = null;
    },
    onError: (e) => {
      setPreview(null);
      setError(describe(e));
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      idempotencyKey.current ??= crypto.randomUUID();
      return unwrap(
        await api.imports.commit({
          params: { kind },
          body: { ...body, mode },
          extraHeaders: { 'idempotency-key': idempotencyKey.current },
        }),
      );
    },
    onSuccess: async (data) => {
      setResult(data);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: [kind === 'products' ? 'products' : 'contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
      toast.success(t('Import terminé'));
    },
    onError: (e) => setError(describe(e)),
  });

  const templateMutation = useMutation({
    mutationFn: async (lang: 'fr' | 'en') =>
      unwrap(await api.imports.template({ params: { kind }, query: { lang } })),
    onSuccess: (data) => download(data.filename, data.csv),
    onError: (e) => setError(describe(e)),
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t('Le fichier dépasse {mb} Mo', { mb: MAX_BYTES / (1024 * 1024) }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setFileName(file.name);
      setPreview(null);
      setResult(null);
      setError(null);
    };
    reader.onerror = () => setError(t('Lecture du fichier impossible'));
    reader.readAsText(file, 'utf-8');
  };

  const importable = preview
    ? preview.rows.filter(
        (r) =>
          r.errors.length === 0 &&
          (!r.duplicate || (r.duplicate.source === 'database' && mode === 'update')),
      ).length
    : 0;

  const shownRows = preview
    ? (onlyProblems
        ? preview.rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0 || r.duplicate)
        : preview.rows
      ).slice(0, VISIBLE_ROWS)
    : [];

  const title = kind === 'products' ? t('Importer des produits') : t('Importer des clients et fournisseurs');

  return (
    <Dialog
      open={open}
      onClose={close}
      width="xl"
      title={title}
      description={t('Fichier CSV (.csv) : séparateur « ; », « , » ou tabulation détecté automatiquement')}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            {t('Fermer')}
          </Button>
        ) : (
          <>
            <Button onClick={close}>{t('Annuler')}</Button>
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={!csv.trim() || previewMutation.isPending}
            >
              {previewMutation.isPending ? t('Analyse…') : t('Analyser')}
            </Button>
            <Button
              variant="primary"
              onClick={() => commitMutation.mutate()}
              disabled={!preview || importable === 0 || commitMutation.isPending}
            >
              {commitMutation.isPending
                ? t('Import en cours…')
                : t('Importer {n} ligne(s)', { n: importable })}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        {result ? (
          <ResultView result={result} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  onFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <Button onClick={() => fileInput.current?.click()}>
                <Icon name="file" /> {t('Choisir un fichier')}
              </Button>
              <Button onClick={() => templateMutation.mutate('fr')} disabled={templateMutation.isPending}>
                <Icon name="download" /> {t('Modèle (FR)')}
              </Button>
              <Button onClick={() => templateMutation.mutate('en')} disabled={templateMutation.isPending}>
                <Icon name="download" /> {t('Modèle (EN)')}
              </Button>
              {fileName && <span className="text-xs text-ink-muted">{fileName}</span>}
            </div>

            <Textarea
              rows={preview ? 4 : 8}
              placeholder={t('Ou collez ici le contenu CSV, avec la ligne d’en-têtes')}
              value={csv}
              dir="ltr"
              className="font-mono text-xs"
              onChange={(event) => {
                setCsv(event.target.value);
                setPreview(null);
                setFileName(null);
              }}
            />

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-ink">
                {t('Doublons')}
                <Select
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as Mode);
                    idempotencyKey.current = null;
                  }}
                  className="w-auto"
                >
                  <option value="skip">{t('Ignorer les doublons')}</option>
                  <option value="update">{t('Mettre à jour les existants')}</option>
                </Select>
              </label>
              {kind === 'contacts' && (
                <label className="flex items-center gap-2 text-sm text-ink">
                  {t('Type par défaut')}
                  <Select
                    value={contactKind}
                    onChange={(event) => setContactKind(event.target.value as ContactKind)}
                    className="w-auto"
                  >
                    <option value="CLIENT">{t('Client')}</option>
                    <option value="SUPPLIER">{t('Fournisseur')}</option>
                    <option value="BOTH">{t('Client & fournisseur')}</option>
                  </Select>
                </label>
              )}
            </div>

            {preview && (
              <PreviewView
                kind={kind}
                preview={preview}
                rows={shownRows}
                mode={mode}
                onlyProblems={onlyProblems}
                setOnlyProblems={setOnlyProblems}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function PreviewView({
  kind,
  preview,
  rows,
  mode,
  onlyProblems,
  setOnlyProblems,
}: {
  kind: Kind;
  preview: ImportPreviewResponse;
  rows: ImportPreviewResponse['rows'];
  mode: Mode;
  onlyProblems: boolean;
  setOnlyProblems: (value: boolean) => void;
}) {
  const t = useT();
  const columns = COLUMNS[kind];
  const unknown = preview.headers.filter((h) => !h.field && h.header);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="neutral">{t('{n} ligne(s)', { n: preview.totalRows })}</Badge>
        <Badge tone="success">{t('{n} valide(s)', { n: preview.validRows })}</Badge>
        <Badge tone={preview.errorRows ? 'danger' : 'neutral'}>
          {t('{n} en erreur', { n: preview.errorRows })}
        </Badge>
        <Badge tone={preview.duplicateRows ? 'info' : 'neutral'}>
          {t('{n} doublon(s)', { n: preview.duplicateRows })}
        </Badge>
        <label className="ms-auto flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(event) => setOnlyProblems(event.target.checked)}
          />
          {t('Seulement les lignes à vérifier')}
        </label>
      </div>

      {preview.missingRequired.length > 0 && (
        <ErrorNote>
          {t('Colonne obligatoire absente : {cols}', { cols: preview.missingRequired.join(', ') })}
        </ErrorNote>
      )}
      {unknown.length > 0 && (
        <p className="text-xs text-ink-muted">
          {t('Colonnes ignorées : {cols}', { cols: unknown.map((h) => h.header).join(', ') })}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              {columns.map((c) => (
                <Th key={c}>{t(COLUMN_LABELS[c] ?? c)}</Th>
              ))}
              <Th>{t('Contrôle')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const bad = row.errors.length > 0;
              const dupWillUpdate =
                row.duplicate?.source === 'database' && mode === 'update' && !bad;
              return (
                <tr
                  key={row.row}
                  className={clsx(
                    bad && 'bg-danger-soft/60',
                    !bad && row.duplicate && !dupWillUpdate && 'bg-surface-muted',
                  )}
                >
                  <Td className="text-ink-subtle">{row.row}</Td>
                  {columns.map((c) => (
                    <Td key={c} className="max-w-48 truncate whitespace-nowrap">
                      {row.values[c] ?? '—'}
                    </Td>
                  ))}
                  <Td className="min-w-64 text-xs">
                    {row.errors.map((e) => (
                      <div key={e} className="text-danger">
                        {e}
                      </div>
                    ))}
                    {row.duplicate && (
                      <div className="text-ink-muted">
                        {row.duplicate.source === 'file'
                          ? t('Doublon de la ligne {row} ({by})', {
                              row: row.duplicate.row ?? '',
                              by: row.duplicate.by,
                            })
                          : dupWillUpdate
                            ? t('Existant : mise à jour ({by}) {label}', {
                                by: row.duplicate.by,
                                label: row.duplicate.label,
                              })
                            : t('Existant : ignoré ({by}) {label}', {
                                by: row.duplicate.by,
                                label: row.duplicate.label,
                              })}
                      </div>
                    )}
                    {row.warnings.map((w) => (
                      <div key={w} className="text-warning">
                        {w}
                      </div>
                    ))}
                    {!bad && !row.duplicate && row.warnings.length === 0 && (
                      <span className="text-success">OK</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      {preview.rows.length > rows.length && (
        <p className="text-xs text-ink-muted">
          {t('Affichage des {n} premières lignes ; toutes sont traitées à l’import.', { n: rows.length })}
        </p>
      )}
    </div>
  );
}

function ResultView({ result }: { result: ImportCommitResponse }) {
  const t = useT();
  const problems = result.results.filter((r) => r.status === 'failed' || r.status === 'skipped');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="success">{t('{n} créé(s)', { n: result.created })}</Badge>
        <Badge tone="info">{t('{n} mis à jour', { n: result.updated })}</Badge>
        <Badge tone="neutral">{t('{n} ignoré(s)', { n: result.skipped })}</Badge>
        <Badge tone={result.failed ? 'danger' : 'neutral'}>{t('{n} échec(s)', { n: result.failed })}</Badge>
      </div>
      {problems.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <thead>
              <tr>
                <Th>{t('Ligne')}</Th>
                <Th>{t('Statut')}</Th>
                <Th>{t('Détail')}</Th>
              </tr>
            </thead>
            <tbody>
              {problems.slice(0, 500).map((r) => (
                <tr key={r.row}>
                  <Td>{r.row}</Td>
                  <Td>{r.status === 'failed' ? t('Échec') : t('Ignoré')}</Td>
                  <Td className={r.status === 'failed' ? 'text-danger' : 'text-ink-muted'}>
                    {r.message}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
