import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { hasSupabaseConfig, setRememberSession, supabase } from '@/lib/supabase';
import { touchOnlinePresence } from '@/lib/financialRepository';
import type { MemberId } from '@/lib/types';

type AuthUser = {
  id: string;
  memberId: MemberId;
  name: string;
  email?: string;
  demo: boolean;
};

type LoginInput = { email: string; password: string; remember: boolean };
type ConfirmResetInput = { email: string; code: string; password: string };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  configured: boolean;
  signIn: (input: LoginInput) => Promise<void>;
  enterDemo: (memberId: MemberId, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (input: ConfirmResetInput) => Promise<void>;
  updateRecoveredPassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const DEMO_KEY = 'aurevion.demo-user';

function webStorage() {
  return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null;
}

async function readDemoUser() {
  if (Platform.OS === 'web') return webStorage()?.getItem(DEMO_KEY) ?? null;
  return SecureStore.getItemAsync(DEMO_KEY);
}

async function writeDemoUser(value: string) {
  if (Platform.OS === 'web') webStorage()?.setItem(DEMO_KEY, value);
  else await SecureStore.setItemAsync(DEMO_KEY, value);
}

async function deleteDemoUser() {
  if (Platform.OS === 'web') webStorage()?.removeItem(DEMO_KEY);
  else await SecureStore.deleteItemAsync(DEMO_KEY);
}

function userFromSession(session: Session): AuthUser {
  const email = session.user.email?.toLocaleLowerCase('pt-BR');
  const knownName = email === 'thauane.oliveira0515@gmail.com' ? 'Thauane' : email === 'albertocoutodev@gmail.com' ? 'Alberto' : undefined;
  const name = String(knownName ?? session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? 'Membro');
  const normalized = name.toLocaleLowerCase('pt-BR');
  const memberId: MemberId = normalized.includes('thauane') ? 'thauane' : 'alberto';
  return { id: session.user.id, memberId, name, email: session.user.email, demo: false };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        if (supabase) {
          const { data } = await supabase.auth.getSession();
          if (active && data.session) setUser(userFromSession(data.session));
        } else {
          const saved = await readDemoUser();
          if (active && saved) setUser(JSON.parse(saved) as AuthUser);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void restore();
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setUser(session ? userFromSession(session) : null);
      setLoading(false);
    }).data.subscription;
    async function handleAuthUrl(url: string) {
      if (!supabase || !url.includes('reset-password')) return;
      const parsed = Linking.parse(url);
      const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : null;
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        return;
      }
      const fragment = url.split('#')[1] ?? '';
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    }
    void Linking.getInitialURL().then((url) => { if (url) void handleAuthUrl(url); });
    const linkingSubscription = Linking.addEventListener('url', ({ url }) => { void handleAuthUrl(url); });
    return () => {
      active = false;
      subscription?.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!user || user.demo || !supabase) return;
    const touch = () => void touchOnlinePresence(user.id);
    touch();
    const timer = setInterval(touch, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') touch(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [user]);

  const signIn = useCallback(async ({ email, password, remember }: LoginInput) => {
    if (!supabase) throw new Error('Conecte o projeto gratuito do Supabase para usar o login real.');
    await setRememberSession(remember);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos.' : 'Não foi possível entrar agora.');
    if (data.session) setUser(userFromSession(data.session));
  }, []);

  const enterDemo = useCallback(async (memberId: MemberId, remember: boolean) => {
    const demoUser: AuthUser = {
      id: `demo-${memberId}`,
      memberId,
      name: memberId === 'alberto' ? 'Alberto' : 'Thauane',
      demo: true,
    };
    setUser(demoUser);
    if (remember) await writeDemoUser(JSON.stringify(demoUser));
    else await deleteDemoUser();
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut({ scope: 'local' });
    await deleteDemoUser();
    setUser(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('A recuperação estará disponível após conectar o Supabase.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: Linking.createURL('/reset-password') });
    if (error) throw new Error('Não foi possível enviar o email de recuperação agora.');
  }, []);

  const confirmPasswordReset = useCallback(async ({ email, code, password }: ConfirmResetInput) => {
    if (!supabase) throw new Error('A recuperação estará disponível após conectar o Supabase.');
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'recovery',
    });
    if (verifyError) throw new Error('Código inválido ou expirado. Peça um novo código.');

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw new Error('A nova senha não atende à política de segurança.');
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
  }, []);

  const updateRecoveredPassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('A recuperação estará disponível após conectar o Supabase.');
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error('O link de recuperação expirou ou não foi validado. Volte ao login e envie outro email.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error('A nova senha não atende à política de segurança.');
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, configured: hasSupabaseConfig, signIn, enterDemo, signOut, requestPasswordReset, confirmPasswordReset, updateRecoveredPassword }),
    [user, loading, signIn, enterDemo, signOut, requestPasswordReset, confirmPasswordReset, updateRecoveredPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de AuthProvider.');
  return value;
}
