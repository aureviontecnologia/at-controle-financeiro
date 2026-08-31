# Threat model — A&T Controle Financeiro

Escala: probabilidade e impacto em `baixa`, `média` ou `alta`. As medidas abaixo são requisitos de produção, não promessas de risco zero.

| Ameaça | Prob. | Impacto | Mitigação implementada / exigida |
|---|---:|---:|---|
| Usuário acessa household alheio | Média | Alta | RLS em todas as tabelas, helper por `auth.uid()`, teste com terceiro usuário e views `security_invoker`. |
| Manipulação de IDs em requests | Alta | Alta | RPC revalida household de conta/cartão/categoria; FKs e triggers rejeitam vínculo cruzado. |
| Token roubado | Média | Alta | SecureStore, refresh seguro, logout local, expiração do JWT, revogação de sessões e biometria futura apenas como trava local. |
| Chave Groq exposta | Média | Alta | Chave apenas em secret da Edge Function, nunca `EXPO_PUBLIC_`, rotação e varredura de Git. |
| Brute force no login | Média | Alta | Rate limit do Supabase, confirmação de email, senha mínima de 10, OTP de recuperação com 8 dígitos/15 minutos e MFA recomendado. Proteção contra senhas vazadas exige plano pago e não foi fingida no plano gratuito. |
| Abuso/custo da IA | Alta | Média | 5 req/min, 25/dia/usuário, limite de 500 caracteres, timeout, max tokens e tabela `ai_usage` sem salvar pergunta. |
| SQL injection | Baixa | Alta | Cliente Supabase parametrizado; nenhuma concatenação SQL; funções com `search_path` fixo. |
| XSS no web build | Baixa | Média | React escapa texto; IA é renderizada como texto, não HTML; headers `nosniff`; sem WebView. |
| Upload malicioso | Média | Alta | Bucket privado, allowlist MIME/extensão, máximo 10 MiB, hash SHA-256 e varredura antivírus antes de produção pública. |
| Arquivo gigante / storage abuse | Média | Média | Limite no bucket e constraint no registro; cotas por household ainda devem ser monitoradas. |
| Alteração do request | Alta | Alta | RLS/RPC ignora autoridade do cliente, `created_by = auth.uid()` e constraints de valor positivo. |
| Race condition em saldo/limite | Média | Alta | RPC atômico, advisory lock por recurso e saldo derivado do ledger. |
| Duplo toque / retry de rede | Alta | Alta | Chave idempotente única; conflito retorna a transação existente e não repete o ledger. |
| Compra e pagamento duplicam despesa | Média | Alta | `card_purchase` entra no gasto; `card_payment` tem impacto consolidado zero. |
| Dados financeiros em logs | Média | Alta | Logs registram códigos/IDs técnicos; não imprimir payloads, contexto de IA, JWT ou exportações. Auditoria fica protegida por RLS. |
| Dados locais extraídos | Média | Alta | Sessão em SecureStore; modo online deve manter cache mínimo, limpar no logout e evitar backups do SO para dados sensíveis. |
| Celular roubado desbloqueado | Média | Alta | Ocultar valores, logout remoto/revogação, auto-lock/biometria futura, PIN forte do aparelho e notificações sem valores. |
| Membro removido mantém acesso Realtime | Baixa | Alta | Revogar membership e sessões; canal deve ser encerrado; RLS barra refetch. Testar propagação de revogação. |
| `service_role` usado pelo cliente | Baixa | Crítico | Nunca incluído no app; somente secret nativo do Supabase; CI deve falhar se encontrar o padrão. |
| Backup inexistente ou não restaurável | Média | Alta | Exportação não é chamada de backup; habilitar recurso real do provedor e testar restauração com periodicidade. |

## Revisões obrigatórias antes de produção

1. Pentest de autorização com três usuários e requests alterados.
2. Teste de corrida com dois dispositivos, perda de rede e retry da mesma idempotency key.
3. Varredura de dependências, secrets e artefatos de build.
4. Teste de restauração do banco e do bucket.
5. Revisão de privacidade/LGPD e prazo de retenção dos audit logs.
