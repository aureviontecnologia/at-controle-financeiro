import Svg, { Circle, Path } from 'react-native-svg';

export function StrawberryMark({ size = 28, opacity = 1 }: { size?: number; opacity?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" opacity={opacity} accessibilityRole="image" accessibilityLabel="Moranguinho">
      <Path d="M20 11c-7.8 0-11.9 4.7-10 11.7C12 30.2 18 35.8 20 37c2-1.2 8-6.8 10-14.3C31.9 15.7 27.8 11 20 11Z" fill="#FF5F91" fillOpacity={0.24} stroke="#FF5F91" strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M20 12c-1.4-4.2-4.5-5.8-7.5-5.7 1.4 2.1 2.1 4.1 2 6.1M20 12c1.4-4.2 4.5-5.8 7.5-5.7-1.4 2.1-2.1 4.1-2 6.1M20 11.5V5.2" fill="none" stroke="#8FE0B6" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="15.5" cy="19" r="1" fill="#FFF0B5" />
      <Circle cx="23.7" cy="18" r="1" fill="#FFF0B5" />
      <Circle cx="19.5" cy="25" r="1" fill="#FFF0B5" />
      <Circle cx="25" cy="27" r="1" fill="#FFF0B5" />
      <Circle cx="15.8" cy="29" r="1" fill="#FFF0B5" />
    </Svg>
  );
}
