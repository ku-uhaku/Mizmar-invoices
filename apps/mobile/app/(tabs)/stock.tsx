import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdjustSheet, type AdjustTarget } from '../../src/components/adjust-sheet';
import { Empty, Field, Muted, Pill, Screen, Title } from '../../src/components/ui';
import { api, unwrap } from '../../src/lib/api';
import { colors, radius, spacing } from '../../src/lib/theme';

const trim = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

export default function StockTab() {
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [target, setTarget] = useState<AdjustTarget | null>(null);

  const stock = useQuery({
    queryKey: ['stock', search, lowOnly],
    queryFn: async () =>
      unwrap(
        await api.inventory.stock({
          query: { limit: 100, filter: lowOnly ? 'low' : 'all', ...(search ? { search } : {}) },
        }),
      ),
  });

  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={{ padding: spacing(4), paddingBottom: 0 }}>
          <Title>Stock</Title>
          <View style={{ height: spacing(3) }} />
          <Field
            label="Rechercher"
            value={search}
            onChangeText={setSearch}
            placeholder="Référence, nom, couleur…"
            autoCapitalize="none"
          />
          <Pressable
            onPress={() => setLowOnly((v) => !v)}
            style={{
              alignSelf: 'flex-start',
              minHeight: 40,
              paddingHorizontal: spacing(4),
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: lowOnly ? colors.warning : colors.borderStrong,
              backgroundColor: lowOnly ? colors.warningSoft : colors.surface,
              marginBottom: spacing(3),
            }}
          >
            <Text style={{ fontWeight: '600', color: lowOnly ? colors.warning : colors.ink }}>
              Stock bas
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={stock.data?.items ?? []}
          keyExtractor={(row) => `${row.variantId}-${row.warehouseId}`}
          refreshControl={
            <RefreshControl refreshing={stock.isRefetching} onRefresh={() => void stock.refetch()} />
          }
          contentContainerStyle={{ padding: spacing(4), paddingTop: 0, gap: spacing(2) }}
          ListEmptyComponent={
            stock.isPending ? <Muted>Chargement…</Muted> : <Empty title="Aucun article" />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                setTarget({
                  id: item.variantId,
                  name: item.productName,
                  label: item.variantLabel,
                  sku: item.sku,
                })
              }
              style={({ pressed }) => ({
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                padding: spacing(3),
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing(3) }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', color: colors.ink }} numberOfLines={1}>
                    {item.productName}
                  </Text>
                  <Muted>
                    {item.sku}
                    {item.variantLabel ? ` · ${item.variantLabel}` : ''}
                  </Muted>
                  <Muted>{item.warehouseCode}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>
                    {trim(item.available)}
                  </Text>
                  {item.isLowStock && <Pill label="bas" tone="warning" />}
                </View>
              </View>
            </Pressable>
          )}
        />

        {target && (
          <AdjustSheet visible variant={target} onClose={() => setTarget(null)} />
        )}
      </SafeAreaView>
    </Screen>
  );
}
