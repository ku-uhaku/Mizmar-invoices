import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { flush, pending, subscribe } from '../../src/lib/outbox';
import { colors } from '../../src/lib/theme';

/** Pending-sync count, so an offline write is never invisible. */
function usePendingCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const refresh = () => void pending().then((rows) => setCount(rows.length));
    refresh();
    // Try a flush on a timer: React Native has no reliable "back online" event.
    const timer = setInterval(() => void flush(), 15_000);
    void flush();
    const unsubscribe = subscribe(refresh);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  return count;
}

export default function TabsLayout() {
  const queued = usePendingCount();

  return (
    <View style={{ flex: 1 }}>
      {queued > 0 && (
        <View style={{ backgroundColor: colors.warning, paddingVertical: 6, alignItems: 'center' }}>
          <Text style={{ color: colors.white, fontSize: 13, fontWeight: '600' }}>
            {queued} opération{queued > 1 ? 's' : ''} en attente de synchronisation
          </Text>
        </View>
      )}
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brand,
          tabBarInactiveTintColor: colors.inkSubtle,
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
          tabBarStyle: { height: 62, paddingBottom: 8, paddingTop: 6 },
        }}
      >
        <Tabs.Screen name="scan" options={{ title: 'Scanner' }} />
        <Tabs.Screen name="stock" options={{ title: 'Stock' }} />
        <Tabs.Screen name="documents" options={{ title: 'Documents' }} />
        <Tabs.Screen name="more" options={{ title: 'Plus' }} />
      </Tabs>
    </View>
  );
}
