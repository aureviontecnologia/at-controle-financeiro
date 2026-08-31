import { Redirect, Tabs, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { CalendarRange, Home, MoreHorizontal, Plus, ReceiptText } from 'lucide-react-native';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, type } from '@/constants/theme';
import { RouteErrorFallback } from '@/components/RouteErrorFallback';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';

export default function TabLayout() {
  const router = useRouter();
  const { user } = useAuth();
  const { palette, strawberryEnabled } = useAppTheme();
  const insets = useSafeAreaInsets();
  const quickRouteLocked = useRef(false);
  const quickRouteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openQuickExpense = useCallback(() => {
    if (quickRouteLocked.current) return;
    quickRouteLocked.current = true;
    router.push('/quick-expense');
    quickRouteTimer.current = setTimeout(() => { quickRouteLocked.current = false; }, 700);
  }, [router]);

  useEffect(() => () => {
    if (quickRouteTimer.current) clearTimeout(quickRouteTimer.current);
  }, []);

  if (!user) return <Redirect href="/(auth)/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.ink },
        tabBarActiveTintColor: palette.mint,
        tabBarInactiveTintColor: palette.textDim,
        tabBarLabelStyle: { fontFamily: type.medium, fontSize: 10, marginTop: 2 },
        tabBarStyle: [styles.bar, { backgroundColor: `${palette.surface}FA`, height: 66 + Math.max(insets.bottom, spacing.sm), paddingBottom: Math.max(insets.bottom, spacing.sm), borderWidth: strawberryEnabled ? StyleSheet.hairlineWidth : 0, borderColor: palette.lineSoft }],
        tabBarItemStyle: styles.item,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: ({ color }) => <Home size={21} color={color} /> }} />
      <Tabs.Screen name="transactions" options={{ title: 'Movimentos', tabBarIcon: ({ color }) => <ReceiptText size={21} color={color} /> }} />
      <Tabs.Screen
        name="quick"
        options={{
          title: '',
          tabBarButton: () => (
            <Pressable accessibilityLabel="Adicionar gasto" accessibilityRole="button" style={({ pressed }) => [styles.quickButton, pressed && styles.quickPressed]} onPress={openQuickExpense}>
              <View style={[styles.quickInner, { backgroundColor: palette.mint }]}>{strawberryEnabled ? <><View style={[styles.leaf, styles.leafLeft]} /><View style={[styles.leaf, styles.leafRight]} /><View style={[styles.quickSeed, styles.quickSeedOne]} /><View style={[styles.quickSeed, styles.quickSeedTwo]} /></> : null}<Plus size={25} color={palette.ink} strokeWidth={2.4} /></View>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="planning" options={{ title: 'Planejar', tabBarIcon: ({ color }) => <CalendarRange size={21} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'Mais', tabBarIcon: ({ color }) => <MoreHorizontal size={22} color={color} /> }} />
    </Tabs>
  );
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteErrorFallback {...props} />;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#101619FA', borderTopWidth: 0, paddingTop: 8 },
  item: { minHeight: 54 },
  quickButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  quickPressed: { transform: [{ scale: 0.94 }] },
  quickInner: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', marginTop: -16 },
  leaf: { position: 'absolute', top: -6, width: 17, height: 9, borderRadius: 12, backgroundColor: '#8FE0B6' },
  leafLeft: { left: 11, transform: [{ rotate: '-24deg' }] },
  leafRight: { right: 11, transform: [{ rotate: '24deg' }] },
  quickSeed: { position: 'absolute', width: 3, height: 5, borderRadius: 2, backgroundColor: '#FFF0B5', opacity: 0.72 },
  quickSeedOne: { left: 8, top: 21, transform: [{ rotate: '24deg' }] },
  quickSeedTwo: { right: 8, bottom: 11, transform: [{ rotate: '-24deg' }] },
});
