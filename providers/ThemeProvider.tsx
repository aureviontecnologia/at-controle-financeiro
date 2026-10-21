import { createContext, useContext, type PropsWithChildren } from 'react';

import { colors, type AppColors } from '@/constants/theme';

type ThemeContextValue = {
  palette: AppColors;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  return <ThemeContext.Provider value={{ palette: colors }}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme precisa estar dentro de ThemeProvider.');
  return value;
}
