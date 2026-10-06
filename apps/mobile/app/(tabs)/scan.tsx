import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdjustSheet } from '../../src/components/adjust-sheet';
import { Button, Card, Empty, Muted, Pill, Screen, Title } from '../../src/components/ui';
import { api, unwrap } from '../../src/lib/api';
import { colors, spacing } from '../../src/lib/theme';

const trim = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  // Cameras fire the same barcode many times a second; without a latch the
  // lookup would be re-issued on every frame.
  const lastScan = useRef<{ code: string; at: number } | null>(null);

  const result = useQuery({
    queryKey: ['scan', code],
    queryFn: async () => unwrap(await api.catalog.searchVariants({ query: { q: code!, limit: 5 } })),
    enabled: Boolean(code),
  });

  const match = result.data?.find((v) => v.barcode === code) ?? result.data?.[0];

  if (!permission) return <Screen />;

  if (!permission.granted) {
    return (
      <Screen style={{ justifyContent: 'center', padding: spacing(6) }}>
        <Title>Caméra requise</Title>
        <Muted style={{ marginVertical: spacing(3) }}>
          Autorisez la caméra pour scanner les codes-barres des articles.
        </Muted>
        <Button label="Autoriser la caméra" onPress={() => void requestPermission()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={{ height: 260, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'code39', 'qr'],
            }}
            onBarcodeScanned={({ data }) => {
              const now = Date.now();
              const last = lastScan.current;
              if (last && last.code === data && now - last.at < 2000) return;
              lastScan.current = { code: data, at: now };
              setCode(data);
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '28%',
              left: '10%',
              right: '10%',
              height: '44%',
              borderWidth: 2,
              borderColor: colors.white,
              borderRadius: 12,
              opacity: 0.8,
            }}
          />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing(4), gap: spacing(3) }}>
          {!code ? (
            <Empty title="Visez un code-barres" hint="La fiche de l’article s’affiche ici." />
          ) : result.isPending ? (
            <Muted>Recherche de {code}…</Muted>
          ) : !match ? (
            <Card>
              <Text style={{ fontWeight: '600', color: colors.ink }}>Code inconnu</Text>
              <Muted>{code}</Muted>
              <View style={{ height: spacing(3) }} />
              <Button label="Scanner à nouveau" variant="secondary" onPress={() => setCode(null)} />
            </Card>
          ) : (
            <Card>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
                {match.productName}
              </Text>
              {match.variantLabel && <Muted>{match.variantLabel}</Muted>}
              <Muted>
                {match.sku} · {match.barcode}
              </Muted>

              <View style={{ flexDirection: 'row', gap: spacing(2), marginVertical: spacing(3) }}>
                <Pill
                  label={`Disponible ${trim(match.available)}`}
                  tone={Number(match.available) <= 0 ? 'danger' : match.isLowStock ? 'warning' : 'success'}
                />
                <Pill label={`En stock ${trim(match.onHand)}`} />
                {Number(match.reserved) > 0 && (
                  <Pill label={`Réservé ${trim(match.reserved)}`} tone="info" />
                )}
              </View>

              {match.sellingPrice && (
                <Text style={{ fontSize: 15, color: colors.ink, marginBottom: spacing(3) }}>
                  Prix : {match.sellingPrice} DH
                </Text>
              )}

              <View style={{ gap: spacing(2) }}>
                <Button label="Ajuster le stock" onPress={() => setAdjusting(true)} />
                <Button label="Scanner un autre article" variant="secondary" onPress={() => setCode(null)} />
              </View>
            </Card>
          )}
        </ScrollView>

        {match && (
          <AdjustSheet
            visible={adjusting}
            variant={{ id: match.variantId, name: match.productName, label: match.variantLabel, sku: match.sku }}
            onClose={() => setAdjusting(false)}
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}
