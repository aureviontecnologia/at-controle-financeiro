import { useNetworkState } from 'expo-network';
import { WifiOff } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/constants/theme';
import { AppText } from './ui';
import { useAppTheme } from '@/providers/ThemeProvider';

export function NetworkBanner() {
  const network = useNetworkState();
  const { palette } = useAppTheme();
  if (network.isConnected !== false && network.isInternetReachable !== false) return null;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: palette.amberDeep }]}>
      <WifiOff size={17} color={palette.amber} />
      <View style={styles.copy}>
        <AppText variant="body">Sem conexão</AppText>
        <AppText variant="caption">Os dados exibidos podem estar desatualizados. Reconecte antes de salvar um lançamento.</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.amberDeep, borderRadius: radii.md, padding: spacing.md },
  copy: { flex: 1, gap: 2 },
});
