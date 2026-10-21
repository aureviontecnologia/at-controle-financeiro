import { Platform } from 'react-native';

export const colors = {
  ink: '#090B0C',
  surface: '#111416',
  surfaceRaised: '#171B1D',
  surfacePressed: '#1D2225',
  line: '#2B3134',
  lineSoft: '#202528',
  text: '#F5F7F6',
  textMuted: '#9AA29F',
  textDim: '#68716D',
  mint: '#8BE3B6',
  mintDeep: '#153429',
  sky: '#B7C9C0',
  skyDeep: '#202B26',
  amber: '#D8BD86',
  amberDeep: '#31291B',
  danger: '#FF9696',
  dangerDeep: '#392022',
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
  md: 12,
  lg: 16,
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
