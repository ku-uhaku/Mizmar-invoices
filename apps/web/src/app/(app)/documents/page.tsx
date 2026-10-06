'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { DocBadges } from '@/components/doc-badges';
import { Icon } from '@/components/icons';
import {
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  Toggle,
} from '@/components/ui';
import { date, documentTypeLabel, documentTypePluralLabel, money } from '@/lib/format';

const TYPES = [
  'DEVIS',
  'SALES_ORDER',
  'DELIVERY_NOTE',
  'SALES_INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'PURCHASE_INVOICE',
] as const;

function DocumentsList() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();

  const type = params.get('type') ?? '';
  const lifecycle = params.get('lifecycle') ?? '';
  const settlement = params.get('settlement') ?? '';
  const overdueOnly = params.get('overdueOnly') === 'true';
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debounced, setDebounced] = useState(search);

  // Typing in a 10 000-row list should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['documents', { type, lifecycle, settlement, overdueOnly, search: debounced }],
    queryFn: async () =>
      unwrap(
        await api.documents.list({
          query: {
            limit: 50,
            ...(type ? { type: type as (typeof TYPES)[number] } : {}),
            ...(lifecycle ? { lifecycle: lifecycle as 'DRAFT' } : {}),
            ...(settlement ? { settlement: settlement as 'UNPAID' } : {}),
            ...(overdueOnly ? { overdueOnly: true } : {}),
            ...(debounced ? { search: debounced } : {}),
          },
        }),
      ),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/documents?${next.toString()}`);
  }

  const title = type ? documentTypePluralLabel(type) : t('Tous les documents');
  const hasFilters = Boolean(lifecycle || settlement || overdueOnly || debounced);
  const showSettlement =
    !type || ['SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_INVOICE'].includes(type);
  const createHref = `/documents/new?type=${type || 'DEVIS'}`;
  const count = query.data?.items.length;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          count === undefined
            ? undefined
            : count === 0
              ? t('Aucun document')
              : `${t(count > 1 ? '{n} documents' : '{n} document', { n: count })}${hasFilters ? ` ${t('correspondant aux filtres')}` : ''}`
        }
        actions={
          <LinkButton variant="primary" href={createHref}>
            <Icon name="plus" />
            {type
              ? t('Nouveau {type}', { type: documentTypeLabel(type).toLowerCase() })
              : t('Nouveau document')}
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          className="w-full sm:w-80"
          placeholder={t('Numéro, référence, client…')}
          aria-label={t('Rechercher un document')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <Segmented
          value={lifecycle}
          onChange={(value) => setParam('lifecycle', value)}
          options={[
            { value: '', label: t('Tous') },
            { value: 'DRAFT', label: t('Brouillons') },
            { value: 'VALIDATED', label: t('Validés') },
            { value: 'SENT', label: t('Envoyés') },
            { value: 'CANCELLED', label: t('Annulés') },
          ]}
        />

        {!type && (
          <div className="w-48">
            <Select
              aria-label={t('Type de document')}
              value={type}
              onChange={(event) => setParam('type', event.target.value)}
            >
              <option value="">{t('Tous les types')}</option>
              {TYPES.map((value) => (
                <option key={value} value={value}>
                  {documentTypeLabel(value)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {showSettlement && (
          <div className="w-52">
            <Select
              aria-label={t('État du règlement')}
              value={settlement}
              onChange={(event) => setParam('settlement', event.target.value)}
            >
              <option value="">{t('Tous les règlements')}</option>
              <option value="UNPAID">{t('Non payé')}</option>
              <option value="PARTIAL">{t('Partiellement payé')}</option>
              <option value="PAID">{t('Payé')}</option>
            </Select>
          </div>
        )}

        <Toggle
          active={overdueOnly}
          onClick={() => setParam('overdueOnly', overdueOnly ? '' : 'true')}
        >
          <Icon name="clock" /> {t('En retard')}
        </Toggle>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              router.push(type ? `/documents?type=${type}` : '/documents');
            }}
          >
            <Icon name="x" /> {t('Réinitialiser')}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <TableSkeleton rows={6} cols={6} />
        ) : query.data && query.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-border/70 md:hidden">
              {query.data.items.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/documents/${row.id}`}
                    className="block px-4 py-3.5 active:bg-surface-muted"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {row.number ?? (
                            <span className="text-ink-muted">
                              {t('Brouillon')} {row.draftLabel}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-sm text-ink-muted">{row.contactName}</p>
                      </div>
                      <p className="tabular shrink-0 text-sm font-semibold text-ink">
                        {money(row.totalInclVat, row.currency)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <DocBadges badges={row.badges} />
                      <span className="text-xs text-ink-subtle">
                        {!type && `${documentTypeLabel(row.type)} · `}
                        {date(row.issueDate)}
                      </span>
                      {row.isOverdue && (
                        <span className="text-xs font-medium text-danger">{t('En retard')}</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>{t('Numéro')}</Th>
                    <Th>{t('Tiers')}</Th>
                    <Th>{t('Date')}</Th>
                    <Th>{t('Échéance')}</Th>
                    <Th numeric>{t('Total HT')}</Th>
                    <Th numeric>{t('Total TTC')}</Th>
                    {showSettlement && <Th numeric>{t('Reste dû')}</Th>}
                    <Th>{t('Statut')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/documents/${row.id}`)}
                      className="cursor-pointer hover:bg-surface-muted/60"
                    >
                      <Td>
                        <Link
                          href={`/documents/${row.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-semibold text-ink hover:text-brand"
                        >
                          {row.number ?? (
                            <span className="text-ink-muted">
                              {t('Brouillon')} {row.draftLabel}
                            </span>
                          )}
                        </Link>
                        {!type && (
                          <div className="text-xs text-ink-muted">
                            {documentTypeLabel(row.type)}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Link
                          href={`/contacts/${row.contactId}`}
                          onClick={(event) => event.stopPropagation()}
                          className="hover:text-brand hover:underline"
                        >
                          {row.contactName}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">{date(row.issueDate)}</Td>
                      <Td
                        className={
                          row.isOverdue
                            ? 'whitespace-nowrap font-medium text-danger'
                            : 'whitespace-nowrap text-ink-muted'
                        }
                      >
                        {date(row.dueDate)}
                        {row.isOverdue && <div className="text-xs font-normal">{t('En retard')}</div>}
                      </Td>
                      <Td numeric className="text-ink-muted">
                        {money(row.totalExclVat, row.currency)}
                      </Td>
                      <Td numeric className="font-semibold">
                        {money(row.totalInclVat, row.currency)}
                      </Td>
                      {showSettlement && (
                        <Td
                          numeric
                          className={
                            Number(row.outstandingAmount) > 0
                              ? 'font-medium text-warning'
                              : 'text-ink-subtle'
                          }
                        >
                          {row.settlement === 'NOT_APPLICABLE'
                            ? '—'
                            : money(row.outstandingAmount, row.currency)}
                        </Td>
                      )}
                      <Td>
                        <DocBadges badges={row.badges} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        ) : hasFilters ? (
          <EmptyState
            icon="search"
            title={t('Aucun résultat')}
            description={t('Aucun document ne correspond à ces filtres. Essayez d’en retirer un.')}
            action={
              <Button
                onClick={() => {
                  setSearch('');
                  router.push(type ? `/documents?type=${type}` : '/documents');
                }}
              >
                {t('Réinitialiser les filtres')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={
              type
                ? t('Aucun {type} pour l’instant', { type: documentTypeLabel(type).toLowerCase() })
                : t('Aucun document pour l’instant')
            }
            description={t('Créez votre premier document : il apparaîtra ici avec son statut et son solde.')}
            action={
              <LinkButton variant="primary" href={createHref}>
                <Icon name="plus" /> {t('Créer')}
              </LinkButton>
            }
          />
        )}
      </Card>
    </>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <DocumentsList />
    </Suspense>
  );
}
