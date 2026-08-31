import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { colors, strawberryColors, type AppColors } from '@/constants/theme';
import { useAuth } from './AuthProvider';

const THAUANE_THEME_KEY = 'at.theme.strawberry.thauane';

type ThemeContextValue = {
  palette: AppColors;
  canUseStrawberry: boolean;
  strawberryEnabled: boolean;
  setStrawberryEnabled: (enabled: boolean) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const canUseStrawberry = user?.memberId === 'thauane';
  const [preference, setPreference] = useState(true);

  useEffect(() => {
    let active = true;
    if (!canUseStrawberry) return () => { active = false; };
    void AsyncStorage.getItem(THAUANE_THEME_KEY)
      .then((saved) => {
        if (active) setPreference(saved === null ? true : saved === 'true');
      })
      .catch(() => {
        if (active) setPreference(true);
      });
    return () => { active = false; };
  }, [canUseStrawberry]);

  const setStrawberryEnabled = useCallback(async (enabled: boolean) => {
    if (!canUseStrawberry) return;
    setPreference(enabled);
    await AsyncStorage.setItem(THAUANE_THEME_KEY, String(enabled));
  }, [canUseStrawberry]);

  const strawberryEnabled = canUseStrawberry && preference;
  const value = useMemo(() => ({
    palette: strawberryEnabled ? strawberryColors : colors,
    canUseStrawberry,
    strawberryEnabled,
    setStrawberryEnabled,
  }), [canUseStrawberry, setStrawberryEnabled, strawberryEnabled]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme precisa estar dentro de ThemeProvider.');
  return value;
}
