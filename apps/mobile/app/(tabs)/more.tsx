import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Muted, Pill, Screen, Title } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth-context';
import { discard, flush, pending, subscribe, type OutboxEntry } from '../../src/lib/outbox';
import { colors, radius, spacing } from '../../src/lib/theme';
import { Pressable } from 'react-native';

export default function More() {
  const { user, companyId, selectCompany, signOut } = useAuth();
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const refresh = () => void pending().then(setQueue);
    refresh();
    return subscribe(refresh);
  }, []);

  async function sync() {
    setSyncing(true);
    const { sent, failed } = await flush();
    setSyncing(false);
    Alert.alert('Synchronisation', `${sent} envoyée(s), ${failed} refusée(s)`);
  }

  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing(4), gap: spacing(4) }}>
          <Title>Plus</Title>

          <Card>
            <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{user?.fullName}</Text>
            <Muted>{user?.email}</Muted>
            <View style={{ marginTop: spacing(2) }}>
              <Pill label={user?.role ?? ''} tone="info" />
            </View>
          </Card>

          <Card>
            <Text style={{ fontWeight: '600', color: colors.ink, marginBottom: spacing(2) }}>Société</Text>
            <View style={{ gap: spacing(2) }}>
              {user?.companies.map((company) => (
                <Pressable
                  key={company.id}
                  onPress={() => void selectCompany(company.id)}
                  style={{
                    minHeight: 48,
                    justifyContent: 'center',
                    paddingHorizontal: spacing(3),
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: company.id === companyId ? colors.brand : colors.border,
                    backgroundColor: company.id === companyId ? colors.brandSoft : colors.surface,
                  }}
                >
                  <Text style={{ fontWeight: '600', color: colors.ink }}>
                    {company.code} — {company.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card>
            <Text style={{ fontWeight: '600', color: colors.ink, marginBottom: spacing(2) }}>
              File de synchronisation
            </Text>
            {queue.length === 0 ? (
              <Muted>Tout est synchronisé.</Muted>
            ) : (
              <View style={{ gap: spacing(2) }}>
                {queue.map((entry) => (
                  <View
                    key={entry.id}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing(3) }}
                  >
                    <Text style={{ fontWeight: '600', color: colors.ink }}>{entry.label}</Text>
                    {entry.lastError && (
                      <Text style={{ color: colors.danger, fontSize: 13, marginTop: 2 }}>
                        Refusée : {entry.lastError}
                      </Text>
                    )}
                    {entry.lastError && (
                      <Button label="Abandonner" variant="ghost" onPress={() => void discard(entry.id)} />
                    )}
                  </View>
                ))}
                <Button label="Synchroniser maintenant" onPress={sync} loading={syncing} />
              </View>
            )}
          </Card>

          <Button label="Se déconnecter" variant="secondary" onPress={() => void signOut()} />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
