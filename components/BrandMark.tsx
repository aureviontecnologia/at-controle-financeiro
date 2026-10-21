import Svg, { Path } from 'react-native-svg';

type Props = { size?: number; color?: string };

export function BrandMark({ size = 32, color = '#F5F7F6' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityRole="image" accessibilityLabel="Saldo">
      <Path
        d="M35 13H19a7 7 0 0 0 0 14h10a7 7 0 0 1 0 14H13"
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
