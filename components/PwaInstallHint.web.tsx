import { Share2, Smartphone, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, radii, spacing } from '@/constants/theme';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function shouldOfferInstall() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && !standalone;
}

export function PwaInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(shouldOfferInstall());
  }, []);

  if (!visible) return null;

  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <View style={styles.icon}>
        <Smartphone size={20} color={colors.mint} />
      </View>
      <View style={styles.copy}>
        <View style={styles.eyebrow}>
          <Share2 size={13} color={colors.mint} />
          <AppText variant="caption" style={styles.eyebrowText}>INSTALAR NO IPHONE</AppText>
        </View>
        <AppText variant="section">Use como aplicativo</AppText>
        <AppText variant="caption" style={styles.description}>
          No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.
        </AppText>
      </View>
      <Pressable accessibilityLabel="Fechar instrução de instalação" accessibilityRole="button" hitSlop={10} onPress={() => setVisible(false)} style={styles.close}>
        <X size={17} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.lineSoft,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.mintDeep,
    borderRadius: 14,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  copy: { flex: 1, gap: spacing.xs },
  eyebrow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  eyebrowText: { color: colors.mint, letterSpacing: 0.65 },
  description: { color: colors.textMuted, maxWidth: 290 },
  close: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
});
