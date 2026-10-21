import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { dailyExpenseTotal } from './finance';
import { formatMoney } from './format';
import { supabase } from './supabase';
import type { CreditCard, Transaction, UpcomingExpense } from './types';
import { useFinanceStore } from '../store/useFinanceStore';

const PUSH_API_URL = process.env.EXPO_PUBLIC_PUSH_API_URL ?? 'https://at-controle-financeiro-aurevion.aureviontecnologia.workers.dev';
const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
let handlerConfigured = false;

function nativeNotifications(): typeof import('expo-notifications') {
  return require('expo-notifications');
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';
export type FinancialActivity = { type: 'expense' | 'income' | 'transfer' | 'account' | 'card' | 'goal' | 'scheduled' | 'daily_limit' | 'other'; amountCents: number; description: string };

export function configureNotificationHandler() {
  if (handlerConfigured) return;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${PUSH_API_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'A sessão expirou. Entre novamente.' : 'O servidor de notificações não respondeu.');
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function registerNativePush(householdId: string) {
  const ExpoNotifications = nativeNotifications();
  configureNotificationHandler();
  await ExpoNotifications.setNotificationChannelAsync('financas-pessoais', {
    name: 'Finanças pessoais',
    description: 'Confirmações de gastos, entradas, contas, cartões, metas e vencimentos.',
    importance: ExpoNotifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 100, 180],
    sound: 'default',
  });
  let permission = await ExpoNotifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await ExpoNotifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('A permissão de notificação não foi concedida.');
  if (!EXPO_PROJECT_ID) throw new Error('O identificador seguro de push do APK ainda não foi configurado.');
  const token = (await ExpoNotifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID })).data;
  await pushRequest('/api/push/register', {
    householdId,
    platform: 'expo',
    token,
    deviceLabel: `Android · ${Constants.deviceName ?? 'Saldo.'}`,
  });
}

export async function prepareFinancialNotifications(input: { householdId: string }) {
  await registerNativePush(input.householdId);
  return true;
}

export async function disableFinancialNotifications(input: { householdId: string }) {
  await pushRequest('/api/push/unregister', { householdId: input.householdId, platform: 'expo' });
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    configureNotificationHandler();
    const ExpoNotifications = nativeNotifications();
    const permission = await ExpoNotifications.getPermissionsAsync();
    return permission.granted ? 'granted' : permission.canAskAgain ? 'prompt' : 'denied';
  } catch {
    return 'unavailable';
  }
}

function activityCopy(event: FinancialActivity) {
  const amount = formatMoney(event.amountCents);
  const description = event.description.trim() || 'movimentação';
  const copies: Record<FinancialActivity['type'], [string, string]> = {
    expense: ['Gasto registrado', `${amount} · ${description}`],
    income: ['Entrada registrada', `${amount} · ${description}`],
    transfer: ['Transferência registrada', `${amount} · ${description}`],
    account: ['Conta adicionada', `${description} · saldo ${amount}`],
    card: ['Cartão adicionado', `${description} · limite ${amount}`],
    goal: ['Meta atualizada', `${amount} · ${description}`],
    scheduled: ['Conta prevista', `${amount} · ${description}`],
    daily_limit: ['Limite diário atingido', `${amount} gastos hoje · ${description}`],
    other: ['Finanças atualizadas', `${amount} · ${description}`],
  };
  return copies[event.type];
}

export async function notifyFinancialActivity(householdId: string, event: FinancialActivity) {
  if (!useFinanceStore.getState().notificationsEnabled) return 0;
  try {
    const result = await pushRequest('/api/push/dispatch', { householdId, event });
    const delivered = Number(result?.delivered ?? 0);
    if (delivered < 1) {
      const [title, body] = activityCopy(event);
      await showCurrentDeviceNotification(title, body, `saldo-${event.type}-${Date.now()}`);
    }
    return delivered;
  } catch {
    const [title, body] = activityCopy(event);
    await showCurrentDeviceNotification(title, body, `saldo-${event.type}-${Date.now()}`).catch(() => undefined);
    return 0;
  }
}

async function showCurrentDeviceNotification(title: string, body: string, tag: string) {
  const ExpoNotifications = nativeNotifications();
  configureNotificationHandler();
  const permission = await ExpoNotifications.getPermissionsAsync();
  if (!permission.granted) return false;
  await ExpoNotifications.scheduleNotificationAsync({ content: { title, body, sound: 'default', data: { route: '/', tag } }, trigger: null });
  return true;
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
      const shown = await showCurrentDeviceNotification(reminder.title, reminder.body, reminder.id);
      if (shown) await AsyncStorage.setItem(key, new Date().toISOString());
    } catch {
      // Alertas locais complementam os avisos visíveis da tela inicial.
    }
  }
}
