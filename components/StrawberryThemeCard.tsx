import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Switch, View } from 'react-native';

import { radii, spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAppTheme } from '@/providers/ThemeProvider';
import { StrawberryMark } from './StrawberryMark';
import { AppText, Pill } from './ui';

export function StrawberryThemeCard({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  const { palette } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled || reducedMotion) {
      breathe.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1_400, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(breathe, { toValue: 0, duration: 1_400, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [breathe, enabled, reducedMotion]);

  const berryMotion = {
    opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
    transform: [{ translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }, { rotate: '-8deg' }],
  };

  return (
    <View style={[styles.card, { backgroundColor: enabled ? palette.surface : '#1D0E16', borderColor: enabled ? palette.line : '#351925' }]}>
      <View pointerEvents="none" style={styles.preview}>
        <View style={styles.halo} />
        <Animated.View style={berryMotion}><StrawberryMark size={70} opacity={enabled ? 1 : 0.7} /></Animated.View>
        <Animated.View style={[styles.seed, styles.seedOne, { opacity: berryMotion.opacity }]} />
        <View style={[styles.seed, styles.seedTwo]} />
      </View>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <AppText variant="caption" style={styles.eyebrow}>EXCLUSIVO DA THAUANE</AppText>
          <AppText variant="section">Moranguinho noturno</AppText>
          <AppText variant="caption">Cereja, folhas suaves e pequenos brilhos que respondem às ações.</AppText>
        </View>
        <Switch
          accessibilityLabel="Ativar tema Moranguinho"
          value={enabled}
          onValueChange={onChange}
          trackColor={{ false: '#351925', true: palette.mintDeep }}
          thumbColor={enabled ? palette.mint : '#D6A8B9'}
        />
      </View>
      <View style={styles.pills}>
        <Pill tone={enabled ? 'mint' : 'neutral'}>{enabled ? 'ATIVO' : 'DESATIVADO'}</Pill>
        <View style={styles.privatePill}><AppText variant="caption" style={styles.privateText}>Só no perfil dela</AppText></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 176, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, overflow: 'hidden', gap: spacing.lg },
  preview: { position: 'absolute', top: -11, right: -8, width: 104, height: 108, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: '#4A1028', opacity: 0.72 },
  seed: { position: 'absolute', width: 4, height: 7, borderRadius: 3, backgroundColor: '#FFF0B5', transform: [{ rotate: '28deg' }] },
  seedOne: { top: 12, left: 12 },
  seedTwo: { bottom: 10, right: 18, opacity: 0.38 },
  topRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md, paddingRight: 4 },
  copy: { flex: 1, gap: 3, paddingRight: 54 },
  eyebrow: { color: '#FF5F91', letterSpacing: 0.65 },
  pills: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  privatePill: { borderRadius: radii.pill, backgroundColor: '#173B2E', paddingHorizontal: 10, paddingVertical: 6 },
  privateText: { color: '#8FE0B6' },
});
