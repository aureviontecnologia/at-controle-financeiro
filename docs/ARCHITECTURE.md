# Arquitetura

## Limites de confiança

O app mobile é um cliente não confiável. Ele pode validar campos para boa UX, mas todas as permissões, vínculos de household e invariantes financeiras são repetidas no PostgreSQL.

```text
Expo app
  ├─ Supabase Auth ── JWT curto + refresh token em SecureStore
  ├─ PostgREST ────── leitura com RLS
  ├─ RPCs ─────────── escrita financeira atômica + idempotência
  ├─ Realtime ─────── invalidação/refetch após commit
  └─ Edge Function ── contexto agregado ── Groq API
```

O cliente recebe somente anon key. `service_role` e `GROQ_API_KEY` existem apenas no ambiente da Edge Function.

## Modelo financeiro

`transactions` representa a operação humana; `ledger_entries` representa o efeito sobre contas. Uma transferência interna possui uma transação e duas entradas de sinais opostos. Compras no cartão pertencem a uma fatura; o pagamento da fatura possui entrada negativa na conta, mas impacto de despesa consolidada zero.

O saldo vem da view `account_balances`:

```text
opening_balance_cents + Σ ledger_entries.amount_cents
```

Views usam `security_invoker`, logo respeitam as policies das tabelas base.

## Concorrência

As RPCs críticas usam uma transação PostgreSQL implícita, chave única `(household_id, idempotency_key)` e advisory locks por conta/cartão/fatura. Isso serializa operações que competem pelo mesmo saldo/limite sem bloquear households independentes.

## Sincronização

O commit no PostgreSQL é a fonte de verdade. Realtime apenas notifica; ao receber um evento, o cliente invalida os dados do household e busca novamente. Uma desconexão não transforma operação pendente em concluída. Retry reutiliza a chave de idempotência original.

## Retenção e exclusão

Dados financeiros importantes usam `deleted_at`/arquivamento, preservando auditoria e referências. Anexos podem ser removidos do bucket após política de retenção, mas o registro de auditoria permanece conforme exigência legal definida pelo produto.
