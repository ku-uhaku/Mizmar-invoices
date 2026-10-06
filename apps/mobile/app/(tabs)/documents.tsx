import { useMutation, useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, Muted, Pill, Screen, Title } from '../../src/components/ui';
import { api, unwrap } from '../../src/lib/api';
import { colors, spacing } from '../../src/lib/theme';

const TYPE_LABELS: Record<string, string> = {
  DEVIS: 'Devis',
  SALES_ORDER: 'Bon de commande',
  DELIVERY_NOTE: 'Bon de livraison',
  SALES_INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  PURCHASE_ORDER: 'Commande fournisseur',
  GOODS_RECEIPT: 'Bon de réception',
  PURCHASE_INVOICE: "Facture d'achat",
};

const BADGE_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  VALIDATED: 'Validé',
  SENT: 'Envoyé',
  CANCELLED: 'Annulé',
  PARTIALLY_FULFILLED: 'Partiel',
  FULFILLED: 'Terminé',
  UNPAID: 'Non payé',
  PARTIALLY_PAID: 'Part. payé',
  PAID: 'Payé',
  OVERDUE: 'En retard',
};

const TONES = { neutral: 'neutral', info: 'info', progress: 'warning', success: 'success', danger: 'danger' } as const;

export default function DocumentsTab() {
  const [sharing, setSharing] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: ['documents'],
    queryFn: async () => unwrap(await api.documents.list({ query: { limit: 50 } })),
  });

  const share = useMutation({
    mutationFn: async (id: string) => {
      setSharing(id);
      const pdf = unwrap(
        await api.documents.renderPdf({ params: { id }, body: { locale: 'FR', forceRerender: false } }),
      );
      // Download then hand to the native share sheet, which covers print,
      // WhatsApp and mail without the app implementing any of them.
      const destination = new File(Paths.cache, pdf.fileName);
      // A previous share of the same document leaves the file behind, and the
      // download refuses to overwrite it.
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(pdf.url, destination);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: pdf.fileName });
      }
    },
    onError: (cause) =>
      Alert.alert('PDF indisponible', cause instanceof Error ? cause.message : 'Réessayez plus tard'),
    onSettled: () => setSharing(null),
  });

  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={{ padding: spacing(4), paddingBottom: spacing(2) }}>
          <Title>Documents</Title>
        </View>
        <FlatList
          data={documents.data?.items ?? []}
          keyExtractor={(row) => row.id}
          refreshControl={
            <RefreshControl refreshing={documents.isRefetching} onRefresh={() => void documents.refetch()} />
          }
          contentContainerStyle={{ padding: spacing(4), paddingTop: 0, gap: spacing(3) }}
          ListEmptyComponent={
            documents.isPending ? <Muted>Chargement…</Muted> : <Empty title="Aucun document" />
          }
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>
                    {item.number ?? `Brouillon ${item.draftLabel}`}
                  </Text>
                  <Muted>{TYPE_LABELS[item.type] ?? item.type}</Muted>
                  <Muted>{item.contactName}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{item.totalInclVat} DH</Text>
                  {item.settlement !== 'NOT_APPLICABLE' && Number(item.outstandingAmount) > 0 && (
                    <Text style={{ fontSize: 12, color: colors.warning }}>
                      reste {item.outstandingAmount}
                    </Text>
                  )}
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: spacing(3) }}>
                {item.badges.map((badge) => (
                  <Pill
                    key={badge.key}
                    label={BADGE_LABELS[badge.key] ?? badge.key}
                    tone={TONES[badge.tone as keyof typeof TONES] ?? 'neutral'}
                  />
                ))}
              </View>

              {item.lifecycle !== 'DRAFT' && (
                <Button
                  label="Partager le PDF"
                  variant="secondary"
                  loading={sharing === item.id}
                  onPress={() => share.mutate(item.id)}
                />
              )}
            </Card>
          )}
        />
      </SafeAreaView>
    </Screen>
  );
}
