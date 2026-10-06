import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, unwrap } from '../lib/api';
import { enqueue, flush } from '../lib/outbox';
import { colors, radius, spacing } from '../lib/theme';
import { Button, ErrorText, Field, Muted } from './ui';

const REASONS: Array<[string, string]> = [
  ['DAMAGED', 'Endommagé'],
  ['LOST', 'Perdu'],
  ['SHRINKAGE', 'Démarque'],
  ['FOUND', 'Retrouvé'],
  ['CORRECTION', 'Correction'],
];

export interface AdjustTarget {
  id: string;
  name: string;
  label: string | null;
  sku: string;
}

/**
 * Stock adjustment from the shelf.
 *
 * Always written to the outbox first and flushed immediately, rather than
 * posted directly: the code path is the same online and offline, so the offline
 * case is exercised on every adjustment instead of only when the signal drops.
 */
export function AdjustSheet({
  visible,
  variant,
  onClose,
}: {
  visible: boolean;
  variant: AdjustTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState('-1');
  const [reason, setReason] = useState('DAMAGED');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const warehouses = unwrap(await api.inventory.listWarehouses()).filter((w) => w.isActive);
      const warehouse = warehouses[0];
      if (!warehouse) throw new Error('Aucun dépôt disponible');

      await enqueue({
        method: 'POST',
        path: '/api/v1/inventory/stock/adjustments',
        label: `${variant.sku} ${delta}`,
        body: {
          warehouseId: warehouse.id,
          reason,
          note: note || undefined,
          lines: [{ variantId: variant.id, quantityDelta: delta }],
        },
      });
      await flush();
      void queryClient.invalidateQueries({ queryKey: ['scan'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ajustement impossible');
    } finally {
      setPending(false);
    }
  }

  const valid = Number(delta) !== 0 && !Number.isNaN(Number(delta));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: spacing(4) }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>Ajuster le stock</Text>
          <Muted>
            {variant.name}
            {variant.label ? ` — ${variant.label}` : ''} · {variant.sku}
          </Muted>

          <View style={{ height: spacing(4) }} />
          <ErrorText>{error}</ErrorText>

          <Text style={{ fontSize: 13, fontWeight: '500', color: colors.inkMuted, marginBottom: 6 }}>
            Écart (négatif = sortie)
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing(2), marginBottom: spacing(3) }}>
            {['-10', '-5', '-1', '+1', '+5'].map((preset) => (
              <Pressable
                key={preset}
                onPress={() => setDelta(preset.replace('+', ''))}
                style={{
                  flex: 1,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: delta === preset.replace('+', '') ? colors.brand : colors.borderStrong,
                  backgroundColor: delta === preset.replace('+', '') ? colors.brandSoft : colors.surface,
                }}
              >
                <Text style={{ fontWeight: '600', color: colors.ink }}>{preset}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Quantité exacte" value={delta} onChangeText={setDelta} keyboardType="numbers-and-punctuation" />

          <Text style={{ fontSize: 13, fontWeight: '500', color: colors.inkMuted, marginBottom: 6 }}>
            Motif
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginBottom: spacing(3) }}>
            {REASONS.map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setReason(value)}
                style={{
                  minHeight: 44,
                  paddingHorizontal: spacing(4),
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: reason === value ? colors.brand : colors.borderStrong,
                  backgroundColor: reason === value ? colors.brandSoft : colors.surface,
                }}
              >
                <Text style={{ fontWeight: '600', color: reason === value ? colors.brand : colors.ink }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Field label="Note" value={note} onChangeText={setNote} placeholder="Facultatif" />

          <View style={{ gap: spacing(2), marginTop: spacing(2) }}>
            <Button label="Enregistrer" onPress={submit} loading={pending} disabled={!valid} />
            <Button label="Annuler" variant="ghost" onPress={onClose} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
