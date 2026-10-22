import Svg, { Path } from 'react-native-svg';

type Props = { size?: number; color?: string };

export function BrandMark({ size = 32, color = '#EDF1F5' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityRole="image" accessibilityLabel="Saldo">
      <Path
        d="M31 13H22a5.5 5.5 0 0 0 0 11h4a5.5 5.5 0 0 1 0 11H17"
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
