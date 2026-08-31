import { Platform } from 'react-native';

export const colors = {
  ink: '#070A0C',
  surface: '#101619',
  surfaceRaised: '#172024',
  surfacePressed: '#1D292D',
  line: '#253136',
  lineSoft: '#1B2428',
  text: '#F2F6F4',
  textMuted: '#8E9B98',
  textDim: '#61706C',
  mint: '#79E2B3',
  mintDeep: '#173B2E',
  sky: '#82B5FF',
  skyDeep: '#172C46',
  amber: '#F1B96B',
  amberDeep: '#3A2B18',
  danger: '#FF8F8F',
  dangerDeep: '#3D2022',
  white: '#FFFFFF',
} as const;

export type AppColors = { [Key in keyof typeof colors]: string };

export const strawberryColors: AppColors = {
  ink: '#12070D',
  surface: '#1D0E16',
  surfaceRaised: '#29131F',
  surfacePressed: '#351827',
  line: '#5A2940',
  lineSoft: '#351925',
  text: '#FFF7FA',
  textMuted: '#D6A8B9',
  textDim: '#9F7184',
  mint: '#FF5F91',
  mintDeep: '#4A1028',
  sky: '#FFACC7',
  skyDeep: '#431327',
  amber: '#FFE08F',
  amberDeep: '#3A2B19',
  danger: '#FF7B91',
  dangerDeep: '#481622',
  white: '#FFFFFF',
};

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
  sm: 10,
  md: 16,
  lg: 22,
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
