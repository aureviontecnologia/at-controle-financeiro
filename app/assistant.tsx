import { router } from 'expo-router';
import { ArrowUp, Check, History, MessageSquareText, Plus, ShieldCheck, Trash2, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/BrandMark';
import { MotionPressable as Pressable } from '@/components/MotionPressable';
import { Reveal } from '@/components/Reveal';
import { AppText, EmptyState } from '@/components/ui';
import { colors, radii, spacing, type } from '@/constants/theme';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { archiveAiConversation, createAiConversation, fetchAiConversations, fetchAiMessages } from '@/lib/chatRepository';
import { liquidPosition, monthlyCashFlow, projectedAvailable, totalAvailable, totalCardUsage } from '@/lib/finance';
import { formatMoney } from '@/lib/format';
import { saveOnlineMonthlyGoal } from '@/lib/financialRepository';
import { supabase } from '@/lib/supabase';
import type { AiConversation, AiMessage, AssistantProposal } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useAppTheme } from '@/providers/ThemeProvider';
import { useFinanceStore } from '@/store/useFinanceStore';

const suggestions = ['Revisar despesas do mês', 'Analisar próximos vencimentos', 'Planejar uma reserva financeira'];

function conversationDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
}

export default function AssistantScreen() {
  const finance = useFinanceData();
  const { user } = useAuth();
  const { palette } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const newChatRequested = useRef(false);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [syncVersion, setSyncVersion] = useState(0);
  const [chatNotice, setChatNotice] = useState('');
  const [applyingAction, setApplyingAction] = useState<string | null>(null);
  const [appliedActions, setAppliedActions] = useState(() => new Set<string>());
  const online = Boolean(supabase && finance.householdId && user && !user.demo);
  const activeConversation = conversations.find((item) => item.id === activeConversationId);

  useEffect(() => {
    if (!online || !finance.householdId) return;
    let active = true;
    void fetchAiConversations(finance.householdId).then((items) => {
      if (!active) return;
      setConversations(items);
      setActiveConversationId((current) => current && items.some((item) => item.id === current) ? current : newChatRequested.current ? null : items[0]?.id ?? null);
      setChatNotice('');
    }).catch((reason) => { if (active) setChatNotice(reason instanceof Error ? reason.message : 'O histórico não pôde ser carregado.'); });
    return () => { active = false; };
  }, [finance.householdId, online, syncVersion]);

  useEffect(() => {
    if (!online || !activeConversationId) {
      setMessages([]);
      return;
    }
    let active = true;
    setLoadingChat(true);
    void fetchAiMessages(activeConversationId).then((items) => { if (active) setMessages(items); }).catch((reason) => { if (active) setChatNotice(reason instanceof Error ? reason.message : 'As mensagens não puderam ser carregadas.'); }).finally(() => { if (active) setLoadingChat(false); });
    return () => { active = false; };
  }, [activeConversationId, online, syncVersion]);

  useEffect(() => {
    if (!online || !finance.householdId || !supabase) return;
    const client = supabase;
    let channel: ReturnType<typeof client.channel> | undefined;
    try {
      channel = client.channel(`ai-chat:${finance.householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_conversations', filter: `household_id=eq.${finance.householdId}` }, () => setSyncVersion((value) => value + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_messages', filter: `household_id=eq.${finance.householdId}` }, () => setSyncVersion((value) => value + 1))
      .subscribe();
    } catch {
      setChatNotice('Atualização automática indisponível. O histórico será atualizado ao abrir a conversa.');
    }
    return () => { if (channel) void client.removeChannel(channel).catch(() => undefined); };
  }, [finance.householdId, online]);

  function localAnswer(input: string) {
    const normalized = input.toLocaleLowerCase('pt-BR');
    if (/^(oi+|ol[áa]|bom dia|boa tarde|boa noite|e a[ií]|tudo bem)[!?.\s]*$/u.test(normalized)) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
      return `${greeting}, ${user?.name ?? 'Alberto'}. Em que posso ajudar? Posso analisar despesas, saldos e vencimentos, ou ajudar no seu planejamento.`;
    }
    if (/qual (?:é|e) (?:o )?seu nome|quem (?:é|e) voc[eê]|como voc[eê] se chama/u.test(normalized)) return 'Sou o assistente do Saldo. Posso conversar, analisar seu histórico financeiro e preparar lançamentos para sua autorização.';
    if (!finance.accounts.length && !finance.transactions.length && !finance.cards.length) return 'Ainda não há dados financeiros sincronizados para analisar. Mesmo assim, posso ajudar a planejar. Cadastre uma conta ou cartão e registre a primeira movimentação para liberar análises reais.';
    const flow = monthlyCashFlow(finance.transactions);
    const net = liquidPosition(finance.accounts, finance.cards, finance.debts);
    if (normalized.includes('gast')) return `Neste mês, você registrou ${formatMoney(flow.expenseCents)} em gastos. Transferências entre suas contas ficaram fora desse total.`;
    if (normalized.includes('líquid') || normalized.includes('positivo') || normalized.includes('dev')) return net >= 0 ? `A posição líquida está positiva em ${formatMoney(net)} depois de descontar faturas e dívidas externas registradas.` : `As faturas e dívidas externas superam o saldo atual em ${formatMoney(Math.abs(net))}.`;
    if (normalized.includes('dispon')) return `O patrimônio disponível agora é ${formatMoney(totalAvailable(finance.accounts))}. Esse valor mostra o caixa atual antes dos próximos compromissos.`;
    if (normalized.includes('compromet') || normalized.includes('sobr')) return `Depois das contas previstas e faturas, o saldo projetado é ${formatMoney(projectedAvailable(finance.accounts, finance.upcoming, finance.cards))}. As faturas abertas somam ${formatMoney(totalCardUsage(finance.cards))}.`;
    return `Entendi. Com os dados disponíveis agora, você tem ${formatMoney(totalAvailable(finance.accounts))} em contas, ${formatMoney(totalCardUsage(finance.cards))} em faturas e posição líquida de ${formatMoney(net)}. Se quiser, diga “investigue meus gastos” e eu organizo os principais pontos.`;
  }

  function requestAction(messageId: string, proposal: AssistantProposal) {
    const title = proposal.kind === 'set_monthly_goal' ? 'Autorizar alteração da meta?' : proposal.kind === 'prepare_income' ? 'Preparar esta entrada?' : 'Preparar este gasto?';
    Alert.alert(title, proposal.summary, [
      { text: 'Cancelar', style: 'cancel' },
      { text: proposal.kind === 'set_monthly_goal' ? 'Autorizar e aplicar' : 'Autorizar e revisar', onPress: () => void applyAction(messageId, proposal) },
    ]);
  }

  async function applyAction(messageId: string, proposal: AssistantProposal) {
    if (applyingAction || !user) return;
    setApplyingAction(messageId);
    try {
      if (proposal.kind === 'prepare_expense') {
        router.push({ pathname: '/quick-expense', params: { amountCents: String(proposal.amountCents), description: proposal.description, category: proposal.category } });
      } else if (proposal.kind === 'prepare_income') {
        router.push({ pathname: '/quick-income', params: { amountCents: String(proposal.amountCents), description: proposal.description, category: proposal.category } } as never);
      } else if (user.demo) {
        useFinanceStore.getState().setMonthlyGoal({ id: `assistant-goal-${Date.now()}`, month: new Date().toISOString().slice(0, 7) + '-01', targetCents: proposal.amountCents, targetDay: proposal.targetDay, createdBy: user.id, updatedAt: new Date().toISOString() });
      } else {
        if (!finance.householdId) throw new Error('Seu espaço financeiro ainda não terminou de sincronizar.');
        await saveOnlineMonthlyGoal({ householdId: finance.householdId, targetCents: proposal.amountCents, targetDay: proposal.targetDay });
        await finance.refresh();
      }
      setAppliedActions((current) => new Set(current).add(messageId));
      setChatNotice(proposal.kind === 'prepare_expense' ? 'Gasto preparado. Confira a conta/cartão e salve.' : proposal.kind === 'prepare_income' ? 'Entrada preparada. Confira a conta e salve.' : 'Meta alterada após sua autorização.');
    } catch (reason) {
      Alert.alert('Alteração não aplicada', reason instanceof Error ? reason.message : 'Confira a conexão e tente novamente.');
    } finally {
      setApplyingAction(null);
    }
  }

  function startNewChat() {
    newChatRequested.current = true;
    setHistoryOpen(false);
    setActiveConversationId(null);
    setMessages([]);
    setQuestion('');
    setChatNotice('');
  }

  function openConversation(id: string) {
    newChatRequested.current = false;
    setHistoryOpen(false);
    setActiveConversationId(id);
    setChatNotice('');
  }

  function confirmDelete(conversation: AiConversation) {
    if (!finance.householdId) return;
    Alert.alert('Apagar conversa?', `“${conversation.title}” será removida do seu histórico.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: () => void archiveAiConversation(finance.householdId!, conversation.id).then(() => { if (activeConversationId === conversation.id) startNewChat(); setSyncVersion((value) => value + 1); }).catch((reason) => Alert.alert('Não foi possível apagar', reason instanceof Error ? reason.message : 'Tente novamente.')) },
    ]);
  }

  async function send(value = question) {
    const clean = value.trim().slice(0, 500);
    if (!clean || sending || !user) return;
    setQuestion('');
    setSending(true);
    setChatNotice('');
    const temporaryId = `temporary-${Date.now()}`;
    let conversationId = activeConversationId;
    try {
      if (online && finance.householdId) {
        if (!conversationId) {
          const created = await createAiConversation(finance.householdId, user.id, clean);
          conversationId = created.id;
          newChatRequested.current = false;
          setConversations((items) => [created, ...items]);
          setActiveConversationId(created.id);
        }
        setMessages((items) => [...items, { id: temporaryId, conversationId: conversationId!, role: 'user', text: clean, createdBy: user.id, createdAt: new Date().toISOString() }]);
        const { data, error } = await supabase!.functions.invoke('financial-assistant', { body: { householdId: finance.householdId, conversationId, question: clean } });
        if (error) throw error;
        const savedMessages = Array.isArray(data?.messages) ? data.messages.filter((item: unknown): item is AiMessage => Boolean(item && typeof item === 'object' && 'id' in item && 'text' in item && 'role' in item)) : [];
        if (data?.proposedAction && savedMessages.length) savedMessages[savedMessages.length - 1].proposedAction = data.proposedAction as AssistantProposal;
        if (!savedMessages.length) throw new Error('A resposta chegou sem histórico verificável.');
        setMessages((items) => [...items.filter((item) => item.id !== temporaryId), ...savedMessages.filter((saved: AiMessage) => !items.some((item) => item.id === saved.id))]);
        setSyncVersion((version) => version + 1);
      } else {
        const now = new Date().toISOString();
        setMessages((items) => [...items, { id: temporaryId, conversationId: 'local', role: 'user', text: clean, createdBy: user.id, createdAt: now }, { id: `${temporaryId}-answer`, conversationId: 'local', role: 'assistant', text: localAnswer(clean), createdBy: user.id, createdAt: now }]);
      }
    } catch {
      const fallback = localAnswer(clean);
      setMessages((items) => [...items.filter((item) => item.id !== temporaryId), { id: temporaryId, conversationId: conversationId ?? 'local', role: 'user', text: clean, createdBy: user.id, createdAt: new Date().toISOString() }, { id: `${temporaryId}-answer`, conversationId: conversationId ?? 'local', role: 'assistant', text: fallback, createdBy: user.id, createdAt: new Date().toISOString() }]);
      setChatNotice('Serviço indisponível. Resposta local, não salva no histórico.');
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion }), 80);
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.ink, paddingTop: Math.max(insets.top, spacing.md) }]} behavior="height" keyboardVerticalOffset={0}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar assistente" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={[styles.iconButton, { backgroundColor: palette.surface }]}><X size={20} color={palette.text} /></Pressable>
        <View style={styles.heading}><AppText variant="section" numberOfLines={1}>{activeConversation?.title ?? 'Assistente'}</AppText><AppText variant="caption">Histórico pessoal</AppText></View>
        <View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="Histórico de chats" onPress={() => setHistoryOpen(true)} style={[styles.smallButton, { backgroundColor: palette.surface }]}><History size={18} color={palette.text} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Novo chat" onPress={startNewChat} style={[styles.smallButton, { backgroundColor: palette.mintDeep }]}><Plus size={19} color={palette.mint} /></Pressable></View>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion })}>
        {!messages.length && !loadingChat ? <Reveal style={styles.welcome}><BrandMark size={48} color={palette.mint} /><AppText variant="title" style={styles.welcomeTitle}>Análise e planejamento</AppText><AppText variant="bodyMuted" style={styles.welcomeCopy}>Consulte saldos, revise despesas e organize seus próximos lançamentos.</AppText></Reveal> : null}
        {messages.map((message) => <Reveal key={message.id} style={styles.messageBlock}><View style={[styles.message, { backgroundColor: message.role === 'user' ? palette.skyDeep : 'transparent' }, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}><AppText variant="body">{message.text}</AppText></View>{message.proposedAction ? <View style={[styles.actionCard, { backgroundColor: palette.surfaceRaised, borderColor: palette.line }]}><View style={styles.actionHeading}><ShieldCheck size={16} color={palette.mint} /><AppText variant="label">ALTERAÇÃO PROPOSTA</AppText></View><AppText variant="body">{message.proposedAction.summary}</AppText><Pressable accessibilityRole="button" disabled={applyingAction === message.id || appliedActions.has(message.id)} onPress={() => requestAction(message.id, message.proposedAction!)} style={({ pressed }) => [styles.actionButton, { backgroundColor: appliedActions.has(message.id) ? palette.mintDeep : palette.mint }, pressed && styles.actionPressed]}>{appliedActions.has(message.id) ? <Check size={17} color={palette.mint} /> : <ShieldCheck size={17} color={palette.ink} />}<AppText variant="button" style={{ color: appliedActions.has(message.id) ? palette.mint : palette.ink }}>{appliedActions.has(message.id) ? 'Autorizado e concluído' : applyingAction === message.id ? 'Aplicando…' : 'Revisar e autorizar'}</AppText></Pressable></View> : null}</Reveal>)}
        {loadingChat || sending ? <View accessibilityRole="progressbar" style={styles.loading}><ActivityIndicator size="small" color={palette.mint} /><AppText variant="bodyMuted">{loadingChat ? 'Carregando conversa…' : 'Preparando resposta…'}</AppText></View> : null}
        {messages.length < 2 && !loadingChat ? <View style={styles.suggestions}>{suggestions.map((item) => <Pressable key={item} disabled={sending} onPress={() => void send(item)} style={[styles.suggestion, { borderColor: palette.line }]}><AppText variant="label">{item}</AppText></Pressable>)}</View> : null}
      </ScrollView>
      {chatNotice ? <View style={styles.notice}><ShieldCheck size={14} color={palette.amber} /><AppText variant="caption" style={styles.noticeText}>{chatNotice}</AppText></View> : null}
      <View style={[styles.composer, { backgroundColor: palette.surface, paddingBottom: Math.max(insets.bottom, spacing.md) }]}><TextInput accessibilityLabel="Pergunta para o assistente" multiline maxLength={500} placeholder="Pergunte sobre suas finanças" placeholderTextColor={palette.textDim} selectionColor={palette.mint} value={question} onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion }), 180)} onChangeText={setQuestion} style={[styles.input, { backgroundColor: palette.surfaceRaised, color: palette.text }]} /><Pressable accessibilityRole="button" accessibilityLabel="Enviar pergunta" disabled={!question.trim() || sending} onPress={() => void send()} style={[styles.send, { backgroundColor: palette.mint }, (!question.trim() || sending) && styles.sendDisabled]}><ArrowUp size={20} color={palette.ink} /></Pressable></View>

      <Modal visible={historyOpen} transparent animationType={reducedMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalRoot}><Pressable accessibilityLabel="Fechar histórico" style={StyleSheet.absoluteFill} onPress={() => setHistoryOpen(false)} /><View style={[styles.sheet, { backgroundColor: palette.surface, paddingBottom: Math.max(insets.bottom, spacing.xl) }]}><View style={styles.sheetHeader}><View><AppText variant="title">Seus chats</AppText><AppText variant="caption">Histórico pessoal de Alberto</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Fechar histórico" onPress={() => setHistoryOpen(false)} style={[styles.smallButton, { backgroundColor: palette.surfaceRaised }]}><X size={18} color={palette.text} /></Pressable></View><Pressable accessibilityRole="button" onPress={startNewChat} style={[styles.newChat, { backgroundColor: palette.mintDeep }]}><Plus size={18} color={palette.mint} /><AppText variant="section" style={{ color: palette.mint }}>Novo chat</AppText></Pressable><ScrollView style={styles.historyList} contentContainerStyle={styles.historyContent}>{conversations.length ? conversations.map((conversation) => <Pressable key={conversation.id} accessibilityRole="button" onPress={() => openConversation(conversation.id)} style={[styles.historyRow, { backgroundColor: conversation.id === activeConversationId ? palette.surfaceRaised : 'transparent' }]}><View style={[styles.historyIcon, { backgroundColor: palette.skyDeep }]}><MessageSquareText size={17} color={palette.sky} /></View><View style={styles.historyCopy}><AppText variant="body" numberOfLines={1}>{conversation.title}</AppText><AppText variant="caption">{conversationDate(conversation.updatedAt)}</AppText></View><Pressable accessibilityRole="button" accessibilityLabel={`Apagar ${conversation.title}`} hitSlop={8} onPress={(event) => { event.stopPropagation(); confirmDelete(conversation); }} style={styles.trash}><Trash2 size={17} color={palette.danger} /></Pressable></Pressable>) : <EmptyState title="Nenhum chat salvo" description="Sua primeira pergunta criará um histórico pessoal." />}</ScrollView></View></View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink }, header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm }, iconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, alignItems: 'center', gap: 2 }, private: { flexDirection: 'row', alignItems: 'center', gap: 4 }, headerActions: { flexDirection: 'row', gap: spacing.xs }, smallButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  messages: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 },
  welcome: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.lg },
  welcomeTitle: { textAlign: 'center', fontSize: 25 },
  welcomeCopy: { textAlign: 'center', maxWidth: 320 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  messageBlock: { gap: spacing.sm }, message: { maxWidth: '92%', borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }, assistantMessage: { alignSelf: 'flex-start', paddingLeft: 0 }, userMessage: { alignSelf: 'flex-end', borderBottomRightRadius: 5 }, suggestions: { gap: spacing.sm, marginTop: spacing.md }, suggestion: { minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  actionCard: { alignSelf: 'flex-start', maxWidth: '92%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.lg, gap: spacing.md }, actionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, actionButton: { minHeight: 48, borderRadius: radii.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg }, actionPressed: { opacity: 0.8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.xs }, noticeText: { flex: 1 }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md }, input: { flex: 1, maxHeight: 120, minHeight: 48, borderRadius: radii.md, fontFamily: type.regular, fontSize: 16, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, textAlignVertical: 'top' }, send: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, sendDisabled: { opacity: 0.4 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.62)' }, sheet: { maxHeight: '78%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.lg }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.lg }, newChat: { minHeight: 50, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, historyList: { flexGrow: 0 }, historyContent: { gap: spacing.xs, paddingBottom: spacing.md }, historyRow: { minHeight: 66, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md }, historyIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, historyCopy: { flex: 1, gap: 2 }, trash: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
