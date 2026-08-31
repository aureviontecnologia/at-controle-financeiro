import Svg, { Path } from 'react-native-svg';

type Props = { size?: number; color?: string; secondaryColor?: string };

export function BrandMark({ size = 32, color = '#79E2B3', secondaryColor = '#82B5FF' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityRole="image" accessibilityLabel="A e T Controle Financeiro">
      <Path
        d="M5.8 36.5 15.2 11.5 24.6 36.5"
        fill="none"
        stroke={color}
        strokeWidth={4.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M27 12.8h15.2M34.6 12.8v23.7"
        fill="none"
        stroke={secondaryColor}
        strokeWidth={4.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M10.4 27.2h12" fill="none" stroke={color} strokeWidth={4.6} strokeLinecap="round" />
      <Path d="M22.4 27.2h12.2" fill="none" stroke={secondaryColor} strokeWidth={4.6} strokeLinecap="round" />
    </Svg>
  );
}
