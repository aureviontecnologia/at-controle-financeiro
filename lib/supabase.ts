import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const inMemorySession = new Map<string, string>();
const REMEMBER_KEY = 'aurevion.remember-session';

async function shouldPersist() {
  return (await SecureStore.getItemAsync(REMEMBER_KEY)) === 'true';
}

export async function setRememberSession(value: boolean) {
  await SecureStore.setItemAsync(REMEMBER_KEY, String(value));
}

const secureAuthStorage = {
  async getItem(key: string) {
    return (await SecureStore.getItemAsync(key)) ?? inMemorySession.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    inMemorySession.set(key, value);
    if (!(await shouldPersist())) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string) {
    inMemorySession.delete(key);
    await SecureStore.deleteItemAsync(key);
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
