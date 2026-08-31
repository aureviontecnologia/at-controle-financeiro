import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const PUSH_API_URL = process.env.EXPO_PUBLIC_PUSH_API_URL ?? 'https://at-controle-financeiro-aurevion.aureviontecnologia.workers.dev';
const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
let handlerConfigured = false;

function nativeNotifications(): typeof import('expo-notifications') {
  return require('expo-notifications');
}

export type SharedNotificationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';
export type PartnerActivity = { type: 'expense' | 'income' | 'transfer' | 'account' | 'card' | 'goal' | 'scheduled' | 'other'; amountCents: number; description: string };

export function configureSharedNotificationHandler() {
  if (handlerConfigured || Platform.OS === 'web') return;
  handlerConfigured = true;
  const ExpoNotifications = nativeNotifications();
  ExpoNotifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function sessionToken() {
  const result = await supabase?.auth.getSession();
  const token = result?.data.session?.access_token;
  if (!token) throw new Error('Entre novamente para ativar as notificações.');
  return token;
}

async function pushRequest(path: string, body: unknown) {
  const token = await sessionToken();
  const response = await fetch(`${PUSH_API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'A sessão expirou. Entre novamente.' : 'O servidor de notificações não respondeu.');
  return response.json();
}

function base64UrlToBytes(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function registerWebPush(householdId: string) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Este navegador não oferece notificações em segundo plano. No iPhone, instale o PWA na Tela de Início primeiro.');
  }
  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') throw new Error('A permissão de notificação não foi concedida.');

  const keyResponse = await fetch(`${PUSH_API_URL}/api/push/public-key`, { cache: 'no-store' });
  const keyData = await keyResponse.json();
  if (!keyResponse.ok || typeof keyData?.publicKey !== 'string' || !keyData.publicKey) throw new Error('A chave de notificação do PWA não está disponível.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(keyData.publicKey) });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('O navegador não concluiu a assinatura de notificação.');
  await pushRequest('/api/push/register', {
    householdId,
    platform: 'web',
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    deviceLabel: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'PWA no iPhone' : 'PWA no navegador',
  });
}

async function registerNativePush(householdId: string) {
  const ExpoNotifications = nativeNotifications();
  configureSharedNotificationHandler();
  if (Platform.OS === 'android') {
    await ExpoNotifications.setNotificationChannelAsync('shared-finances', {
      name: 'Movimentações da família',
      description: 'Entradas, gastos, transferências, contas, cartões e metas do casal.',
      importance: ExpoNotifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      sound: 'default',
    });
  }
  let permission = await ExpoNotifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await ExpoNotifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('A permissão de notificação não foi concedida.');
  if (!EXPO_PROJECT_ID) throw new Error('O identificador seguro de push do APK ainda não foi configurado.');
  const token = (await ExpoNotifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID })).data;
  await pushRequest('/api/push/register', {
    householdId,
    platform: 'expo',
    token,
    deviceLabel: `${Platform.OS === 'android' ? 'Android' : 'iOS'} · ${Constants.deviceName ?? 'A&T'}`,
  });
}

export async function prepareSharedExpenseNotifications(input: { householdId: string }) {
  if (Platform.OS === 'web') await registerWebPush(input.householdId);
  else await registerNativePush(input.householdId);
  return true;
}

export async function disableSharedExpenseNotifications(input: { householdId: string }) {
  await pushRequest('/api/push/unregister', { householdId: input.householdId, platform: Platform.OS === 'web' ? 'web' : 'expo' });
}

export async function getSharedNotificationPermission(): Promise<SharedNotificationPermission> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window) || !('PushManager' in window)) return 'unavailable';
    return window.Notification.permission === 'granted' ? 'granted' : window.Notification.permission === 'denied' ? 'denied' : 'prompt';
  }
  configureSharedNotificationHandler();
  const ExpoNotifications = nativeNotifications();
  const permission = await ExpoNotifications.getPermissionsAsync();
  return permission.granted ? 'granted' : permission.canAskAgain ? 'prompt' : 'denied';
}

export async function notifyPartnerActivity(householdId: string, event: PartnerActivity) {
  try {
    const result = await pushRequest('/api/push/dispatch', { householdId, event });
    return Number(result?.delivered ?? 0);
  } catch {
    return 0;
  }
}
