import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, spacing, type } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAppTheme } from '@/providers/ThemeProvider';
import { MotionPressable as Pressable } from './MotionPressable';

export function Screen({ children, scroll = true, contentStyle }: { children: ReactNode; scroll?: boolean; contentStyle?: ViewStyle }) {
  const { palette } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entrance, reducedMotion]);

  const motionStyle = { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] };
  const content = scroll ? (
    <Animated.ScrollView
      style={[styles.flex, motionStyle]}
      contentContainerStyle={[styles.screenContent, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </Animated.ScrollView>
  ) : (
    <Animated.View style={[styles.screenContent, styles.flex, motionStyle, contentStyle]}>{children}</Animated.View>
  );
  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: palette.ink }]}>{content}</SafeAreaView>;
}

export function AppText({ children, style, variant = 'body', numberOfLines, adjustsFontSizeToFit, accessibilityLiveRegion }: { children: ReactNode; style?: TextStyle | TextStyle[]; variant?: keyof typeof textStyles; numberOfLines?: number; adjustsFontSizeToFit?: boolean; accessibilityLiveRegion?: 'none' | 'polite' | 'assertive' }) {
  const { palette } = useAppTheme();
  const themedColor = variant === 'bodyMuted' || variant === 'label' || variant === 'caption' ? palette.textMuted : variant === 'button' ? palette.ink : palette.text;
  return <Text accessibilityLiveRegion={accessibilityLiveRegion} numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit} style={[textStyles[variant], { color: themedColor }, style]}>{children}</Text>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="section" style={styles.sectionTitle}>{title}</AppText>
      {action && onAction ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={onAction}>
          <AppText variant="label" style={[styles.action, { color: palette.mint }]}>{action}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Surface({ children, style }: { children?: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const { palette } = useAppTheme();
  return <View style={[styles.surface, { backgroundColor: palette.surface, borderColor: palette.lineSoft }, style]}>{children}</View>;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'mint' | 'amber' | 'danger' }) {
  const { palette } = useAppTheme();
  const backgrounds = { neutral: palette.surfaceRaised, mint: palette.mintDeep, amber: palette.amberDeep, danger: palette.dangerDeep };
  const foregrounds = { neutral: palette.textMuted, mint: palette.mint, amber: palette.amber, danger: palette.danger };
  return (
    <View style={[styles.pill, toneStyles[tone], { backgroundColor: backgrounds[tone] }]}>
      <AppText variant="caption" style={[toneTextStyles[tone], { color: foregrounds[tone] }]}>{children}</AppText>
    </View>
  );
}

export function PrimaryButton({ label, onPress, loading = false, disabled = false, icon }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; icon?: ReactNode }) {
  const { palette } = useAppTheme();
  return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled || loading}
        onPress={onPress}
        style={({ pressed }) => [styles.primaryButton, { backgroundColor: pressed ? palette.sky : palette.mint }, (disabled || loading) && styles.disabled]}
      >
        {loading ? <ActivityIndicator color={palette.ink} /> : <>{icon}<AppText variant="button" style={[styles.primaryLabel, { color: palette.ink }]}>{label}</AppText></>}
      </Pressable>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.empty}>
      <AppText variant="section">{title}</AppText>
      <AppText variant="bodyMuted" style={styles.emptyText}>{description}</AppText>
    </View>
  );
}

export function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.lineSoft }]} />;
}

const textStyles = StyleSheet.create({
  display: { color: colors.text, fontFamily: type.bold, fontSize: 34, lineHeight: 38, letterSpacing: -1.1 },
  title: { color: colors.text, fontFamily: type.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  section: { color: colors.text, fontFamily: type.semibold, fontSize: 17, lineHeight: 22 },
  body: { color: colors.text, fontFamily: type.regular, fontSize: 15, lineHeight: 21 },
  bodyMuted: { color: colors.textMuted, fontFamily: type.regular, fontSize: 15, lineHeight: 21 },
  label: { color: colors.textMuted, fontFamily: type.medium, fontSize: 13, lineHeight: 18 },
  caption: { color: colors.textMuted, fontFamily: type.medium, fontSize: 11, lineHeight: 15, letterSpacing: 0.15 },
  button: { color: colors.ink, fontFamily: type.semibold, fontSize: 15, lineHeight: 20 },
  mono: { color: colors.text, fontFamily: type.semibold, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] },
});

const toneStyles = StyleSheet.create({
  neutral: { backgroundColor: colors.surfaceRaised },
  mint: { backgroundColor: colors.mintDeep },
  amber: { backgroundColor: colors.amberDeep },
  danger: { backgroundColor: colors.dangerDeep },
});

const toneTextStyles = StyleSheet.create({
  neutral: { color: colors.textMuted },
  mint: { color: colors.mint },
  amber: { color: colors.amber },
  danger: { color: colors.danger },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  screenContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.xl },
  sectionHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sectionTitle: { flex: 1, minWidth: 0 },
  action: { color: colors.mint },
  surface: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  pill: { alignSelf: 'flex-start', borderRadius: radii.sm, paddingHorizontal: 9, paddingVertical: 5 },
  primaryButton: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  primaryPressed: { backgroundColor: '#92E9C2', transform: [{ scale: 0.99 }] },
  primaryLabel: { color: colors.ink },
  disabled: { opacity: 0.45 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyText: { marginTop: spacing.sm, textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.lineSoft },
});
