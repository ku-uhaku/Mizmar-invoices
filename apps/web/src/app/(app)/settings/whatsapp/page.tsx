'use client';

import { useQuery } from '@tanstack/react-query';
import { apiModules, unwrap } from '@/lib/api';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';
import { useWhatsappStatus } from '@/lib/whatsapp';

export default function WhatsappSettingsPage() {
  const t = useT();
  const status = useWhatsappStatus();
  const state = status.data?.status ?? null;

  const qr = useQuery({
    queryKey: ['whatsapp', 'qr'],
    queryFn: async () => unwrap(await apiModules.whatsapp.qr()),
    enabled: state === 'qr_ready',
    // The code rotates every few seconds until it is scanned.
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="WhatsApp"
        subtitle={t('Envoi des documents et relances aux clients via la passerelle OpenWA')}
      />

      <Card>
        <CardHeader
          title={t('Connexion WhatsApp')}
          actions={
            status.data?.configured ? (
              <Badge tone={state === 'ready' ? 'success' : 'progress'}>{state ?? '—'}</Badge>
            ) : undefined
          }
        />
        <div className="space-y-4 px-5 pb-5 text-sm">
          {status.isPending ? (
            <p className="text-ink-muted">…</p>
          ) : !status.data?.configured ? (
            <p className="text-ink-muted">
              {t(
                'WhatsApp n’est pas configuré. Renseignez OPENWA_URL, OPENWA_API_KEY et OPENWA_SESSION_ID dans le fichier .env puis redémarrez l’API.',
              )}
            </p>
          ) : state === 'ready' ? (
            <p>
              {t('Connecté')}
              {status.data.phone ? ` · +${status.data.phone}` : ''}
            </p>
          ) : state === 'qr_ready' ? (
            <>
              <p className="text-ink-muted">
                {t('Scannez ce code depuis WhatsApp › Appareils connectés › Connecter un appareil.')}
              </p>
              {qr.data?.qrCode ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr.data.qrCode} alt="WhatsApp QR" className="size-64 rounded-lg border border-border bg-white p-2" />
              ) : (
                <p className="text-ink-muted">…</p>
              )}
            </>
          ) : (
            <p className="text-ink-muted">
              {t('La session n’est pas prête. Démarrez-la depuis le tableau de bord OpenWA.')}
            </p>
          )}
          <p className="text-xs text-ink-muted">
            {t(
              'Passerelle non officielle : utilisez un numéro dédié, sinon le numéro peut être restreint par WhatsApp.',
            )}
          </p>
        </div>
      </Card>
    </>
  );
}
