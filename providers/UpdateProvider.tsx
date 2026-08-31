import { Download, ShieldCheck, X } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Alert, AppState, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, PrimaryButton } from '@/components/ui';
import { radii, spacing } from '@/constants/theme';
import {
  checkForRemoteUpdate,
  currentAppVersion,
  downloadAndOpenInstaller,
  isExpoGo,
  type AvailableUpdate,
} from '@/lib/remoteUpdates';
import { useAppTheme } from '@/providers/ThemeProvider';

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdateContextValue = {
  checkNow: () => Promise<void>;
  currentVersion: string;
  isChecking: boolean;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: PropsWithChildren) {
  const { palette } = useAppTheme();
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastCheckedAt = useRef(0);
  const checkingRef = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (checkingRef.current) return;
    if (Platform.OS === 'web') {
      if (manual) Alert.alert('Atualizações automáticas', 'No iPhone, a versão mais recente é carregada automaticamente ao abrir o aplicativo.');
      return;
    }
    checkingRef.current = true;
    setIsChecking(true);
    try {
      const update = await checkForRemoteUpdate();
      lastCheckedAt.current = Date.now();
      setAvailable(update);
      if (manual && !update) {
        Alert.alert('Tudo atualizado', `Você já está na versão ${currentAppVersion}.`);
      }
    } catch {
      if (manual) Alert.alert('Não foi possível verificar', 'Confira sua internet e tente novamente.');
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const timer = setTimeout(() => void check(false), 2_500);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastCheckedAt.current >= AUTO_CHECK_INTERVAL_MS) {
        void check(false);
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [check]);

  const install = useCallback(async () => {
    if (!available) return;
    if (isExpoGo) {
      Alert.alert(
        'Atualização do APK',
        'No Expo Go, o aplicativo instalado é o próprio Expo Go. A página da versão será aberta; no Samsung, use o APK do A&T para receber este fluxo automático.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir versão', onPress: () => void downloadAndOpenInstaller(available) },
        ],
      );
      return;
    }

    setIsDownloading(true);
    setProgress(0);
    try {
      await downloadAndOpenInstaller(available, setProgress);
    } catch (error) {
      Alert.alert(
        'Atualização protegida',
        error instanceof Error ? error.message : 'O APK não pôde ser preparado com segurança.',
      );
    } finally {
      setIsDownloading(false);
    }
  }, [available]);

  const value = useMemo(
    () => ({ checkNow: () => check(true), currentVersion: currentAppVersion, isChecking }),
    [check, isChecking],
  );

  return (
    <UpdateContext.Provider value={value}>
      {children}
      <Modal animationType="fade" transparent visible={Boolean(available)} onRequestClose={() => setAvailable(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.line }]}>
            {!isDownloading ? (
              <Pressable accessibilityLabel="Fechar atualização" hitSlop={12} onPress={() => setAvailable(null)} style={styles.close}>
                <X size={20} color={palette.textMuted} />
              </Pressable>
            ) : null}
            <View style={[styles.icon, { backgroundColor: palette.mintDeep }]}>
              <Download size={24} color={palette.mint} />
            </View>
            <AppText variant="title">Atualização disponível</AppText>
            <AppText variant="bodyMuted" style={styles.centered}>
              Versão {available?.version} · {available ? Math.round(available.size / 1024 / 1024) : 0} MB
            </AppText>
            <AppText variant="body" style={styles.notes} numberOfLines={5}>{available?.notes}</AppText>
            {isDownloading ? (
              <View style={styles.progressArea}>
                <View style={[styles.progressTrack, { backgroundColor: palette.lineSoft }]}>
                  <View style={[styles.progressFill, { backgroundColor: palette.mint, width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <AppText variant="caption">Baixando e verificando · {Math.round(progress * 100)}%</AppText>
              </View>
            ) : (
              <PrimaryButton label={isExpoGo ? 'Abrir versão' : 'Baixar e instalar'} onPress={() => void install()} icon={<ShieldCheck size={18} color={palette.ink} />} />
            )}
            <AppText variant="caption" style={styles.centered}>
              SHA-256 verificado. O Android pedirá sua confirmação final.
            </AppText>
          </View>
        </View>
      </Modal>
    </UpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const context = useContext(UpdateContext);
  if (!context) throw new Error('useAppUpdate deve ser usado dentro de UpdateProvider.');
  return context;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: spacing.xl },
  card: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xl, gap: spacing.md },
  close: { position: 'absolute', right: spacing.lg, top: spacing.lg, zIndex: 2 },
  icon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
  notes: { marginVertical: spacing.xs },
  progressArea: { gap: spacing.sm },
  progressTrack: { height: 7, borderRadius: radii.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radii.pill },
});
