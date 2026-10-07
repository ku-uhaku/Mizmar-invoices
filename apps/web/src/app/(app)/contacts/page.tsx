'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Segmented,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { ContactForm } from '@/components/contact-form';
import { ImportDialog } from '@/components/import-dialog';
import { Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

const KIND_LABELS: Record<string, string> = {
  CLIENT: 'Client',
  SUPPLIER: 'Fournisseur',
  BOTH: 'Client & fournisseur',
};

type KindFilter = 'ALL' | 'CLIENT' | 'SUPPLIER';

export default function ContactsPage() {
  const t = useT();
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState<'CLIENT' | 'SUPPLIER' | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('ALL');

  const contacts = useQuery({
    queryKey: ['contacts', { search, kind: kind === 'ALL' ? '' : kind }],
    queryFn: async () =>
      unwrap(
        await api.contacts.list({
          query: {
            limit: 100,
            withBalances: true,
            ...(search ? { search } : {}),
            ...(kind !== 'ALL' ? { kind: kind as 'CLIENT' } : {}),
          },
        }),
      ),
  });

  const filtered = search !== '' || kind !== 'ALL';

  return (
    <>
      <PageHeader
        title={t('Clients & fournisseurs')}
        subtitle={t('Annuaire et encours')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Icon name="download" className="rotate-180" /> {t('Importer')}
            </Button>
            <Button variant="secondary" onClick={() => setCreating('SUPPLIER')}>
              <Icon name="plus" /> {t('Nouveau fournisseur')}
            </Button>
            <Button variant="primary" onClick={() => setCreating('CLIENT')}>
              <Icon name="plus" /> {t('Nouveau client')}
            </Button>
          </>
        }
      />
      <ImportDialog
        kind="contacts"
        open={importing}
        onClose={() => setImporting(false)}
        defaultContactKind={kind === 'SUPPLIER' ? 'SUPPLIER' : 'CLIENT'}
      />
      <ContactForm
        open={creating !== null}
        onClose={() => setCreating(null)}
        defaultKind={creating ?? 'CLIENT'}
        onSaved={(saved) => router.push(`/contacts/${saved.id}`)}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          className="w-full sm:w-80"
          placeholder={t('Nom, ICE, téléphone, e-mail…')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'ALL', label: t('Tous') },
            { value: 'CLIENT', label: t('Clients') },
            { value: 'SUPPLIER', label: t('Fournisseurs') },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {contacts.isPending ? (
          <TableSkeleton rows={8} cols={6} />
        ) : contacts.data && contacts.data.items.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>{t('Nom')}</Th>
                <Th>{t('Type')}</Th>
                <Th>ICE</Th>
                <Th>{t('Téléphone')}</Th>
                <Th>{t('Conditions')}</Th>
                <Th numeric>{t('Encours')}</Th>
                <Th numeric>{t('En retard')}</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.data.items.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => router.push(`/contacts/${contact.id}`)}
                  className="cursor-pointer transition hover:bg-surface-muted"
                >
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={contact.displayName} />
                      <div className="min-w-0">
                        <Link
                          href={`/contacts/${contact.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-medium text-ink hover:text-brand"
                        >
                          {contact.displayName}
                        </Link>
                        {contact.legalName && contact.legalName !== contact.displayName && (
                          <div className="text-xs text-ink-subtle">{contact.legalName}</div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={contact.kind === 'SUPPLIER' ? 'info' : 'neutral'}>
                      {t(KIND_LABELS[contact.kind] ?? contact.kind)}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">{contact.ice ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-ink-muted">{contact.phone ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {contact.paymentTerm.replace('_', ' ')}
                  </Td>
                  <Td numeric>
                    {contact.outstandingBalance ? money(contact.outstandingBalance) : '—'}
                  </Td>
                  <Td
                    numeric
                    className={
                      Number(contact.overdueBalance ?? 0) > 0
                        ? 'font-medium text-danger'
                        : 'text-ink-subtle'
                    }
                  >
                    {contact.overdueBalance ? money(contact.overdueBalance) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="users"
            title={filtered ? t('Aucun résultat') : t('Aucun tiers')}
            description={
              filtered
                ? t('Aucun client ou fournisseur ne correspond à votre recherche. Ajustez les filtres.')
                : t('Vos clients et fournisseurs apparaîtront ici.')
            }
            action={
              !filtered && (
                <Button variant="primary" onClick={() => setCreating('CLIENT')}>
                  <Icon name="plus" /> {t('Nouveau client')}
                </Button>
              )
            }
          />
        )}
      </Card>
    </>
  );
}
