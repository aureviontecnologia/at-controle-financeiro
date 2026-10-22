import { useEffect, useRef, type PropsWithChildren } from 'react';
import { Animated, Easing, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';

export function Reveal({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) { progress.setValue(1); return; }
    const animation = Animated.timing(progress, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>{children}</Animated.View>;
}
