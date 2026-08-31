import type { ErrorBoundaryProps } from 'expo-router';
import { RefreshCw, ShieldAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText, PrimaryButton, Screen, Surface } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useAppTheme } from '@/providers/ThemeProvider';

export function RouteErrorFallback({ error, retry }: ErrorBoundaryProps) {
  const { palette } = useAppTheme();
  const diagnostic = error instanceof Error && error.message
    ? error.message.slice(0, 180)
    : 'Falha inesperada ao abrir esta tela.';

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <Surface style={styles.card}>
        <View style={[styles.icon, { backgroundColor: palette.dangerDeep }]}>
          <ShieldAlert size={24} color={palette.danger} />
        </View>
        <AppText variant="title">Esta aba encontrou um problema.</AppText>
        <AppText variant="bodyMuted">
          O restante do aplicativo e os dados continuam protegidos. Tente carregar a tela novamente.
        </AppText>
        <PrimaryButton label="Tentar novamente" onPress={retry} icon={<RefreshCw size={18} color={palette.ink} />} />
        <AppText variant="caption" style={styles.diagnostic}>{diagnostic}</AppText>
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  card: { gap: spacing.lg },
  icon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  diagnostic: { opacity: 0.7 },
});
