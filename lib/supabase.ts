import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const inMemorySession = new Map<string, string>();
const REMEMBER_KEY = 'aurevion.remember-session';

function getWebStorage() {
  return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null;
}

async function shouldPersist() {
  if (Platform.OS === 'web') return getWebStorage()?.getItem(REMEMBER_KEY) === 'true';
  return (await SecureStore.getItemAsync(REMEMBER_KEY)) === 'true';
}

export async function setRememberSession(value: boolean) {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(REMEMBER_KEY, String(value));
    return;
  }
  await SecureStore.setItemAsync(REMEMBER_KEY, String(value));
}

const secureAuthStorage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') return getWebStorage()?.getItem(key) ?? inMemorySession.get(key) ?? null;
    return (await SecureStore.getItemAsync(key)) ?? inMemorySession.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    inMemorySession.set(key, value);
    if (!(await shouldPersist())) return;
    if (Platform.OS === 'web') getWebStorage()?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string) {
    inMemorySession.delete(key);
    if (Platform.OS === 'web') getWebStorage()?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        storage: secureAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 4 },
      },
    })
  : null;
