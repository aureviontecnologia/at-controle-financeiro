import { Platform } from 'react-native';

export const colors = {
  ink: '#0C1117',
  surface: '#141B23',
  surfaceRaised: '#1B2530',
  surfacePressed: '#24313F',
  line: '#344150',
  lineSoft: '#27323E',
  text: '#EDF1F5',
  textMuted: '#A0ADBB',
  textDim: '#82909F',
  mint: '#B5CADD',
  mintDeep: '#233343',
  sky: '#B5CADD',
  skyDeep: '#233343',
  amber: '#D0BA91',
  amberDeep: '#302C24',
  danger: '#EBA0A2',
  dangerDeep: '#352529',
  white: '#FFFFFF',
} as const;

export type AppColors = { [Key in keyof typeof colors]: string };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 44,
} as const;

export const radii = {
  sm: 8,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const type = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  mono: 'IBMPlexMono_500Medium',
} as const;

export const shadows = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
  android: { elevation: 5 },
  default: {},
});
