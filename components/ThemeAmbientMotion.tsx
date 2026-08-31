import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { StrawberryMark } from './StrawberryMark';

export function ThemeAmbientMotion() {
  const reducedMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0.35)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      float.setValue(0);
      shimmer.setValue(0.55);
      drift.setValue(0);
      return;
    }

    const reveal = Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    const floating = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: -5, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(float, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    const twinkle = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 0.8, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shimmer, { toValue: 0.35, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    const drifting = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 6, duration: 2400, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(drift, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    reveal.start();
    floating.start();
    twinkle.start();
    drifting.start();
    return () => {
      reveal.stop();
      floating.stop();
      twinkle.stop();
      drifting.stop();
    };
  }, [drift, entrance, float, reducedMotion, shimmer]);

  return (
    <Animated.View pointerEvents="none" style={[styles.ambient, { opacity: entrance }]}>
      <Animated.View style={[styles.berry, styles.berryHero, { transform: [{ translateY: float }, { rotate: '12deg' }] }]}><StrawberryMark size={92} opacity={0.2} /></Animated.View>
      <Animated.View style={[styles.berry, styles.berryLeft, { transform: [{ translateY: drift }, { rotate: '-18deg' }] }]}><StrawberryMark size={54} opacity={0.09} /></Animated.View>
      <Animated.View style={[styles.berry, styles.berryBottom, { transform: [{ translateY: float }, { rotate: '18deg' }] }]}><StrawberryMark size={48} opacity={0.08} /></Animated.View>
      <Animated.View style={[styles.seed, styles.seedOne, { opacity: shimmer, transform: [{ translateY: drift }] }]} />
      <Animated.View style={[styles.seed, styles.seedTwo, { opacity: shimmer, transform: [{ translateY: float }] }]} />
      <View style={[styles.seed, styles.seedThree]} />
      <View style={[styles.seed, styles.seedFour]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ambient: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  berry: { position: 'absolute' },
  berryHero: { top: 2, right: -18 },
  berryLeft: { top: 286, left: -22 },
  berryBottom: { bottom: 132, right: -16 },
  seed: { position: 'absolute', width: 5, height: 8, borderRadius: 4, backgroundColor: '#FFF0B5', transform: [{ rotate: '24deg' }] },
  seedOne: { top: 126, right: 28 },
  seedTwo: { top: 344, left: 18 },
  seedThree: { bottom: 214, right: 16, opacity: 0.28 },
  seedFour: { top: 184, right: 8, opacity: 0.18, transform: [{ rotate: '-24deg' }] },
});
