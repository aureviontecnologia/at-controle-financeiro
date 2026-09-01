import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { dailyExpenseTotal } from './finance';
import { formatMoney } from './format';
import { supabase } from './supabase';
import type { CreditCard, Transaction, UpcomingExpense } from './types';

const PUSH_API_URL = process.env.EXPO_PUBLIC_PUSH_API_URL ?? 'https://at-controle-financeiro-aurevion.aureviontecnologia.workers.dev';
const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
let handlerConfigured = false;

function nativeNotifications(): typeof import('expo-notifications') {
  return require('expo-notifications');
}

export type SharedNotificationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';
export type PartnerActivity = { type: 'expense' | 'income' | 'transfer' | 'account' | 'card' | 'goal' | 'scheduled' | 'daily_limit' | 'other'; amountCents: number; description: string };

export function configureSharedNotificationHandler() {
  if (handlerConfigured || Platform.OS === 'web') return;
  try {
    const ExpoNotifications = nativeNotifications();
    ExpoNotifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerConfigured = true;
  } catch {
    // O restante do app funciona mesmo se o serviço nativo ainda estiver iniciando.
  }
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
  try {
    configureSharedNotificationHandler();
    const ExpoNotifications = nativeNotifications();
    const permission = await ExpoNotifications.getPermissionsAsync();
    return permission.granted ? 'granted' : permission.canAskAgain ? 'prompt' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function notifyPartnerActivity(householdId: string, event: PartnerActivity) {
  try {
    const result = await pushRequest('/api/push/dispatch', { householdId, event });
    return Number(result?.delivered ?? 0);
  } catch {
    return 0;
  }
}

async function showCurrentDeviceNotification(title: string, body: string, tag: string) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window) || window.Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, { body, icon: '/pwa-192.png', badge: '/pwa-192.png', tag, data: { url: '/' } });
    return;
  }
  const ExpoNotifications = nativeNotifications();
  configureSharedNotificationHandler();
  const permission = await ExpoNotifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ExpoNotifications.scheduleNotificationAsync({ content: { title, body, sound: 'default', data: { route: '/' } }, trigger: null });
}

function reminderDaysUntil(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  const now = new Date();
  return Math.ceil((new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime()) / 86_400_000);
}

export async function syncFinanceReminders(input: { householdId: string; cards: CreditCard[]; upcoming: UpcomingExpense[]; transactions: Transaction[]; dailySpendLimitCents: number }) {
  const reminders: Array<{ id: string; title: string; body: string }> = [];
  for (const expense of input.upcoming) {
    const days = reminderDaysUntil(expense.dueDate);
    if (!expense.paid && days >= 0 && days <= 3) reminders.push({ id: `bill-${expense.id}-${days}`, title: days === 0 ? 'Conta vence hoje' : `Conta vence em ${days} dia${days === 1 ? '' : 's'}`, body: `${expense.title} · ${formatMoney(expense.amountCents)}` });
  }
  for (const card of input.cards) for (const invoice of card.invoices ?? []) {
    const days = reminderDaysUntil(invoice.dueDate);
    if (invoice.status !== 'paid' && days >= 0 && days <= 3) reminders.push({ id: `invoice-${invoice.id}-${days}`, title: days === 0 ? 'Fatura vence hoje' : `Fatura vence em ${days} dia${days === 1 ? '' : 's'}`, body: `${card.name} · ${formatMoney(invoice.amountCents)}` });
  }
  const spentToday = dailyExpenseTotal(input.transactions);
  if (input.dailySpendLimitCents > 0 && spentToday > input.dailySpendLimitCents) reminders.push({ id: `daily-${new Date().toISOString().slice(0, 10)}`, title: 'Limite diário ultrapassado', body: `Gastos de ${formatMoney(spentToday)} excederam o limite em ${formatMoney(spentToday - input.dailySpendLimitCents)}.` });

  for (const reminder of reminders) {
    const key = `at-reminder:${input.householdId}:${reminder.id}`;
    if (await AsyncStorage.getItem(key)) continue;
    try {
      await showCurrentDeviceNotification(reminder.title, reminder.body, reminder.id);
      await AsyncStorage.setItem(key, new Date().toISOString());
    } catch {
      // Alertas locais complementam os avisos visíveis da tela inicial.
    }
  }
}
