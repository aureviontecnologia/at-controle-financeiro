import { supabase } from './supabase';
import type { AiConversation, AiMessage } from './types';

function requireClient() {
  if (!supabase) throw new Error('O histórico compartilhado precisa do Supabase conectado.');
  return supabase;
}

export async function fetchAiConversations(householdId: string): Promise<AiConversation[]> {
  const client = requireClient();
  const { data, error } = await client.from('ai_conversations').select('id,title,created_by,created_at,updated_at').eq('household_id', householdId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(50);
  if (error) throw new Error('Não foi possível carregar o histórico dos chats.');
  return (data ?? []).map((item) => ({ id: item.id, title: item.title, createdBy: item.created_by, createdAt: item.created_at, updatedAt: item.updated_at }));
}

export async function fetchAiMessages(conversationId: string): Promise<AiMessage[]> {
  const client = requireClient();
  const { data, error } = await client.from('ai_messages').select('id,conversation_id,role,content,created_by,created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error('Não foi possível carregar as mensagens deste chat.');
  return (data ?? []).reverse().map((item) => ({ id: item.id, conversationId: item.conversation_id, role: item.role as AiMessage['role'], text: item.content, createdBy: item.created_by, createdAt: item.created_at }));
}

export async function createAiConversation(householdId: string, userId: string, firstQuestion: string): Promise<AiConversation> {
  const client = requireClient();
  const title = firstQuestion.trim().replace(/\s+/g, ' ').slice(0, 64) || 'Novo chat';
  const { data, error } = await client.from('ai_conversations').insert({ household_id: householdId, title, created_by: userId }).select('id,title,created_by,created_at,updated_at').single();
  if (error) throw new Error('Não foi possível criar um novo chat.');
  return { id: data.id, title: data.title, createdBy: data.created_by, createdAt: data.created_at, updatedAt: data.updated_at };
}

export async function archiveAiConversation(householdId: string, conversationId: string) {
  const client = requireClient();
  const { error } = await client.rpc('archive_ai_conversation', { target_household: householdId, target_conversation: conversationId });
  if (error) throw new Error('Não foi possível apagar este chat.');
}
