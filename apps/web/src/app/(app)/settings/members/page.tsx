'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Dialog,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { Icon } from '@/components/icons';
import { api, ApiError, unwrap } from '@/lib/api';
import { date as formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

const ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'VIEWER'] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  ACCOUNTANT: 'Comptable',
  SALES: 'Commercial',
  WAREHOUSE: 'Magasinier',
  VIEWER: 'Lecture seule',
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Accès total, y compris les sociétés et les autres propriétaires.',
  ADMIN: 'Accès total, sauf supprimer une société ou gérer un propriétaire.',
  ACCOUNTANT: 'Documents, paiements et tiers ; lecture du reste. Pas d’ajustement de stock ni de paramètres.',
  SALES: 'Ventes : crée et valide ses propres documents. Ne voit pas les coûts ni les marges.',
  WAREHOUSE: 'Stock, transferts, inventaires, bons de livraison et de réception. Ne voit pas les prix.',
  VIEWER: 'Lecture seule, sans les coûts.',
};

export default function MembersPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });
  const members = useQuery({
    queryKey: ['members'],
    queryFn: async () => unwrap(await api.members.list()),
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; body: { role?: Role; isActive?: boolean; username?: string | null } }) =>
      unwrap(await api.members.update({ params: { id: input.id }, body: input.body })),
    onSuccess: () => {
      toast.success(t('Membre mis à jour'));
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t('Action impossible')),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.members.remove({ params: { id } })),
    onSuccess: () => {
      toast.success(t('Membre retiré'));
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t('Action impossible')),
  });

  return (
    <>
      <PageHeader
        title={t('Membres')}
        subtitle={t('Les personnes ayant accès à votre organisation')}
        actions={
          <Button variant="primary" onClick={() => setInviting(true)}>
            <Icon name="plus" />
            {t('Inviter un membre')}
          </Button>
        }
      />
      <Card>
        <CardHeader title={t('Équipe')} />
        {!members.data ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Nom')}</Th>
                <Th>{t('Rôle')}</Th>
                <Th>{t('Statut')}</Th>
                <Th>{t('Dernière connexion')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {members.data.map((member) => {
                const isSelf = member.userId === session.data?.id;
                return (
                  <tr key={member.id}>
                    <Td>
                      <p className="font-medium">{member.fullName}</p>
                      <p className="text-xs text-ink-muted">
                        {member.email}
                        {member.username ? ` · @${member.username}` : ''}
                      </p>
                    </Td>
                    <Td>
                      <Select
                        value={member.role}
                        disabled={isSelf || update.isPending}
                        className="w-44"
                        onChange={(e) =>
                          update.mutate({ id: member.id, body: { role: e.target.value as Role } })
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t(ROLE_LABELS[role])}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Badge tone={member.isActive ? 'success' : 'neutral'}>
                        {member.isActive ? t('Actif') : t('Désactivé')}
                      </Badge>
                    </Td>
                    <Td>{member.lastLoginAt ? formatDate(member.lastLoginAt) : '—'}</Td>
                    <Td className="text-end">
                      {!isSelf && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const next = window.prompt(
                                t('Nom d’utilisateur (vide pour le retirer)'),
                                member.username ?? '',
                              );
                              if (next === null) return;
                              update.mutate({ id: member.id, body: { username: next.trim().toLowerCase() || null } });
                            }}
                          >
                            {t('Modifier l’identifiant')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              update.mutate({ id: member.id, body: { isActive: !member.isActive } })
                            }
                          >
                            {member.isActive ? t('Désactiver') : t('Réactiver')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            onClick={() => {
                              if (window.confirm(t('Retirer {name} de l’organisation ?', { name: member.fullName }))) {
                                remove.mutate(member.id);
                              }
                            }}
                          >
                            {t('Retirer')}
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {inviting && (
        <InviteDialog companies={session.data?.companies ?? []} onClose={() => setInviting(false)} />
      )}
    </>
  );
}

function InviteDialog({
  companies,
  onClose,
}: {
  companies: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('SALES');
  const [password, setPassword] = useState('');
  const [companyIds, setCompanyIds] = useState<string[]>(companies.map((c) => c.id));
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(await api.members.invite({ body: { email, username: username.trim() || undefined, fullName, role, password, companyIds } }));
    },
    onSuccess: () => {
      toast.success(t('Invitation créée'));
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Invitation impossible')),
  });

  const valid = email.includes('@') && fullName.trim() && password.length >= 8 && companyIds.length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Inviter un membre')}
      footer={
        <>
          <Button onClick={onClose}>{t('Annuler')}</Button>
          <Button variant="primary" disabled={!valid} loading={invite.isPending} onClick={() => invite.mutate()}>
            {t('Inviter')}
          </Button>
          <Card className="mt-4">
        <CardHeader
          title={t('Rôles et permissions')}
          description={t('Les rôles sont fixes ; chaque membre en reçoit un.')}
        />
        <ul className="divide-y divide-border/70">
          {ROLES.map((role) => (
            <li key={role} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:gap-6">
              <span className="w-40 shrink-0 text-sm font-medium text-ink">{t(ROLE_LABELS[role])}</span>
              <span className="text-sm text-ink-muted">{t(ROLE_DESCRIPTIONS[role])}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label={t('Nom complet')} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label={t('E-mail')} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('Nom d’utilisateur')} hint={t('Facultatif ; 3 à 32 caractères : a-z, 0-9, point, tiret, souligné')}>
          <Input
            value={username}
            autoCapitalize="none"
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
          />
        </Field>
        <Field label={t('Rôle')}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABELS[r])}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('Mot de passe temporaire')}
          hint={t('8 caractères minimum ; le membre devra le changer à sa première connexion')}
          required
        >
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-muted">{t('Sociétés accessibles')}</p>
          {companies.map((company) => (
            <Checkbox
              key={company.id}
              label={company.name}
              checked={companyIds.includes(company.id)}
              onChange={(e) =>
                setCompanyIds((current) =>
                  e.target.checked ? [...current, company.id] : current.filter((id) => id !== company.id),
                )
              }
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
