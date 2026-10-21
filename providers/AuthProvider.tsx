import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { hasSupabaseConfig, setRememberSession, supabase } from '@/lib/supabase';
import { touchOnlinePresence } from '@/lib/financialRepository';
import type { MemberId } from '@/lib/types';

type AuthUser = {
  id: string;
  memberId: MemberId;
  name: string;
  email?: string;
  demo: boolean;
  mustChangePassword: boolean;
};

type LoginInput = { email: string; password: string; remember: boolean };
type ConfirmResetInput = { email: string; code: string; password: string };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  configured: boolean;
  signIn: (input: LoginInput) => Promise<void>;
  enterDemo: (remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (input: ConfirmResetInput) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateRecoveredPassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const DEMO_KEY = 'aurevion.demo-user';
export const PERSONAL_ACCOUNT_EMAIL = 'albertocoutodev@gmail.com';

type PasswordResetError = {
  code?: string;
  message?: string;
  status?: number;
};

function passwordResetRedirectUrl() {
  return Linking.createURL('reset-password');
}

function passwordResetErrorMessage(error: PasswordResetError) {
  const details = `${error.code ?? ''} ${error.message ?? ''}`.toLocaleLowerCase('en-US');
  if (error.status === 429 || details.includes('rate limit')) {
    return 'Muitos emails foram pedidos em pouco tempo. Aguarde alguns minutos antes de tentar novamente.';
  }
  if (details.includes('redirect')) {
    return 'O endereço de recuperação do aplicativo ainda não está autorizado. Atualize o app e tente novamente.';
  }
  return 'Não foi possível enviar o email de recuperação agora. Verifique a conexão e tente novamente.';
}

async function readDemoUser() {
  return SecureStore.getItemAsync(DEMO_KEY);
}

async function writeDemoUser(value: string) {
  await SecureStore.setItemAsync(DEMO_KEY, value);
}

async function deleteDemoUser() {
  await SecureStore.deleteItemAsync(DEMO_KEY);
}

function userFromSession(session: Session): AuthUser {
  const email = session.user.email?.toLocaleLowerCase('pt-BR');
  const name = String(email === PERSONAL_ACCOUNT_EMAIL ? 'Alberto' : session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? 'Alberto');
  return { id: session.user.id, memberId: 'alberto', name, email: session.user.email, demo: false, mustChangePassword: session.user.user_metadata?.must_change_password === true };
}

function isPersonalSession(session: Session | null): session is Session {
  return session?.user.email?.trim().toLocaleLowerCase('pt-BR') === PERSONAL_ACCOUNT_EMAIL;
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
          if (active && isPersonalSession(data.session)) setUser(userFromSession(data.session));
          else if (data.session) await supabase.auth.signOut({ scope: 'local' });
        } else {
          const saved = await readDemoUser();
          if (active && saved) setUser(JSON.parse(saved) as AuthUser);
        }
      } catch {
        // Uma falha de rede/armazenamento não pode derrubar o processo do app.
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    void restore();
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setUser(isPersonalSession(session) ? userFromSession(session) : null);
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
    void Linking.getInitialURL()
      .then((url) => (url ? handleAuthUrl(url) : undefined))
      .catch(() => undefined);
    const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleAuthUrl(url).catch(() => undefined);
    });
    return () => {
      active = false;
      subscription?.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!user || user.demo || !supabase) return;
    const touch = () => { void touchOnlinePresence(user.id).catch(() => undefined); };
    touch();
    const timer = setInterval(touch, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') touch(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [user]);

  const signIn = useCallback(async ({ email, password, remember }: LoginInput) => {
    if (!supabase) throw new Error('Conecte o projeto gratuito do Supabase para usar o login real.');
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== PERSONAL_ACCOUNT_EMAIL) throw new Error('Este aplicativo é pessoal. Entre com o email de Alberto.');
    await setRememberSession(remember);
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos.' : 'Não foi possível entrar agora.');
    if (data.session) setUser(userFromSession(data.session));
  }, []);

  const enterDemo = useCallback(async (remember: boolean) => {
    const demoUser: AuthUser = {
      id: 'demo-alberto',
      memberId: 'alberto',
      name: 'Alberto',
      demo: true,
      mustChangePassword: false,
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
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== PERSONAL_ACCOUNT_EMAIL) throw new Error('Use o email pessoal de Alberto para recuperar o acesso.');
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: passwordResetRedirectUrl(),
    });
    if (error) throw new Error(passwordResetErrorMessage(error));
  }, []);

  const confirmPasswordReset = useCallback(async ({ email, code, password }: ConfirmResetInput) => {
    if (!supabase) throw new Error('A recuperação estará disponível após conectar o Supabase.');
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== PERSONAL_ACCOUNT_EMAIL) throw new Error('Use o email pessoal de Alberto para recuperar o acesso.');
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: code.trim(),
      type: 'recovery',
    });
    if (verifyError) throw new Error('Código inválido ou expirado. Peça um novo código.');

    const { error: updateError } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (updateError) throw new Error('A nova senha não atende à política de segurança.');
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!supabase) throw new Error('A troca de senha estará disponível após conectar o Supabase.');
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user.email?.trim().toLowerCase();
    if (email !== PERSONAL_ACCOUNT_EMAIL) throw new Error('Sua sessão expirou. Entre novamente para trocar a senha.');
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) throw new Error('A senha atual está incorreta.');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
    if (updateError) throw new Error('Não foi possível salvar a nova senha. Escolha outra senha forte.');
  }, []);

  const updateRecoveredPassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('A recuperação estará disponível após conectar o Supabase.');
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error('O link de recuperação expirou ou não foi validado. Volte ao login e envie outro email.');
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (error) throw new Error('A nova senha não atende à política de segurança.');
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, configured: hasSupabaseConfig, signIn, enterDemo, signOut, requestPasswordReset, confirmPasswordReset, changePassword, updateRecoveredPassword }),
    [user, loading, signIn, enterDemo, signOut, requestPasswordReset, confirmPasswordReset, changePassword, updateRecoveredPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de AuthProvider.');
  return value;
}
