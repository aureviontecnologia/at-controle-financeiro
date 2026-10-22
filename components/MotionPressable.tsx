import { useEffect, useState } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Subtle press feedback runs on the UI thread and never delays the action. */
export function MotionPressable({ style, onPressIn, onPressOut, onHoverIn, onHoverOut, disabled, ...props }: PressableProps) {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (disabled || reducedMotion) scale.value = 1;
    if (disabled) setPressed(false);
    return () => cancelAnimation(scale);
  }, [disabled, reducedMotion, scale]);

  const feedback = (value: number) => {
    scale.value = reducedMotion ? 1 : withTiming(value, {
      duration: value < 1 ? 100 : 160,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  };

  return <AnimatedPressable
    {...props}
    disabled={disabled}
    onPressIn={(event) => { setPressed(true); feedback(0.985); onPressIn?.(event); }}
    onPressOut={(event) => { setPressed(false); feedback(1); onPressOut?.(event); }}
    onHoverIn={(event) => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={(event) => { setHovered(false); onHoverOut?.(event); }}
    style={[typeof style === 'function' ? style({ pressed, hovered }) : style, animatedStyle]}
  />;
}
