import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold, useFonts } from '@expo-google-fonts/figtree';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { AppProviders } from '@/providers/AppProviders';
import { useAppTheme } from '@/providers/ThemeProvider';

void SplashScreen.preventAutoHideAsync();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const diagnostic = error instanceof Error && error.message ? error.message.slice(0, 180) : 'Falha inesperada.';
  return (
    <View style={fallbackStyles.screen}>
      <View style={fallbackStyles.card}>
        <Text style={fallbackStyles.label}>PROTEÇÃO DE RECUPERAÇÃO</Text>
        <Text style={fallbackStyles.title}>O aplicativo encontrou um problema.</Text>
        <Text style={fallbackStyles.body}>Os dados continuam protegidos. Toque abaixo para recarregar a tela sem encerrar o aplicativo.</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={({ pressed }) => [fallbackStyles.button, pressed && fallbackStyles.pressed]}>
          <Text style={fallbackStyles.buttonText}>Tentar novamente</Text>
        </Pressable>
        <Text style={fallbackStyles.diagnostic}>{diagnostic}</Text>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <AppProviders>
      <AppNavigator />
    </AppProviders>
  );
}

function AppNavigator() {
  const { palette } = useAppTheme();

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    void Promise.all([
      NavigationBar.setVisibilityAsync('visible'),
      NavigationBar.setButtonStyleAsync('light'),
      NavigationBar.setBehaviorAsync('inset-swipe'),
    ]).catch(() => undefined);
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.ink }, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="quick-expense" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="accounts" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="cards" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="members" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="security" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="monthly-goal" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}

const fallbackStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 22, padding: 24, gap: 14 },
  label: { color: colors.mint, fontSize: 12, fontWeight: '700', letterSpacing: 0.7 },
  title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700' },
  body: { color: colors.textMuted, fontSize: 16, lineHeight: 23 },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  pressed: { opacity: 0.82 },
  buttonText: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  diagnostic: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
});
