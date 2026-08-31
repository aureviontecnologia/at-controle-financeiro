# A&T Controle Financeiro

Aplicativo mobile de finanças compartilhadas para Alberto e Thauane. O household é uma única unidade contábil: as contas e os cartões mostram onde o dinheiro está, mas receitas, despesas, patrimônio, orçamento e projeções são sempre do casal.

## Estado desta entrega

O projeto Supabase gratuito já está criado na conta técnica da Aurevion, conectado localmente e com as migrations aplicadas. Alberto e Thauane possuem logins separados vinculados ao mesmo household. A Edge Function do assistente também já está publicada com a chave da Groq guardada exclusivamente nos secrets do backend. As credenciais públicas do app ficam em `.env.local`, ignorado pelo Git; senhas e chaves privadas não fazem parte do código.

## O que já funciona

- Expo Router + TypeScript, Android, iOS, web e Expo Go.
- Interface permanentemente escura, responsiva e acessível, com animações bancárias sutis e respeito à redução de movimento do sistema.
- Tema opcional “Moranguinho Noturno”, exclusivo do perfil da Thauane, com paleta cereja/rosa, morangos animados e preferência salva no aparelho.
- Login real e separado por usuário com Supabase Auth, sessão persistente opcional em SecureStore e logout local.
- Modo de demonstração gratuito, sem servidor, com perfis Alberto/Thauane e dados fictícios.
- Dashboard conjunto, valores ocultáveis, contas por titular, faturas consolidadas, contas futuras e fluxo mensal.
- Lançamento rápido idempotente com Pix, débito, dinheiro, boleto, cartão, forma personalizada e parcelamento real por fatura.
- Contas únicas e assinaturas mensais com vencimento, confirmação de pagamento e lançamento na conta ou fatura escolhida.
- Cofres e caixinhas vinculados a contas, com saldo reservado separado do dinheiro livre para gastos.
- Assistente Groq compartilhado com conversa natural, histórico familiar e alterações sempre sujeitas à confirmação.
- Histórico filtrável por quem registrou — sem criar dívidas internas.
- Planejamento com meta mensal compartilhada por valor e dia, orçamentos, dívidas externas, cartões, exportação CSV/JSON e assistente.
- Avisos de novos gastos do outro membro com nome, valor e descrição; cada usuário pode desativá-los.
- PostgreSQL reproduzível com migrations, RLS, ledger, RPCs atômicos, Realtime, auditoria e storage privado.
- Edge Function da Groq: a chave fica no backend, recebe apenas contexto agregado e tem rate limit gratuito. O histórico de chats pertence ao household, é compartilhado em tempo real e permite criar ou apagar conversas.
- Atualização Android gratuita por GitHub Releases: checagem automática, APK ARM64 assinado, validação SHA-256 e confirmação final do instalador do sistema.

## Princípios contábeis

1. Uma despesa registrada por qualquer membro é despesa do household.
2. Uma transferência entre contas de Alberto e Thauane gera dois lançamentos de ledger vinculados e impacto consolidado zero.
3. Uma compra no cartão vira despesa na compra; pagar a fatura reduz a conta bancária, mas não cria uma segunda despesa.
4. O saldo de cada conta é `saldo inicial + ledger`. Nenhum endpoint aceita editar um “saldo atual” mutável.
5. Todos os valores são inteiros em centavos. A moeda padrão é BRL e o timezone é `America/Sao_Paulo`.
6. Escritas críticas passam por RPCs transacionais e usam `idempotency_key` única por household.

## Rodar sem gastar nada

Requer Node.js e o aplicativo Expo Go no celular.

```bash
npm install
npm start
```

Leia o QR Code no Expo Go. Sem `.env`, a tela de entrada oferece a demonstração local para Alberto ou Thauane. Nenhuma conta em nuvem é necessária para esse modo.

Verificações locais:

```bash
npm run typecheck
npm test
npm run build:web
```

## Conectar o Supabase gratuito

1. Crie um projeto Supabase e copie `.env.example` para `.env.local`.
2. Preencha somente `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` no app. A anon key é pública por arquitetura; RLS é a barreira real.
3. Instale a CLI e associe o projeto:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

4. Em Auth, habilite email/senha, confirmação de email e política mínima de 10 caracteres. Configure os dois usuários com nomes `Alberto` e `Thauane`; nunca use senhas iguais ou compartilhadas. No plano gratuito, a proteção nativa contra senhas vazadas não está disponível.
5. O primeiro usuário cria o household chamando `create_household('A&T')`. O segundo deve ser adicionado por fluxo administrativo seguro; não edite IDs pelo cliente.

As migrations em `supabase/migrations` criam toda a estrutura, políticas e operações. Não use `service_role` no app.

## Groq sem expor a chave

Crie a chave no console da Groq e salve como secret da Edge Function:

```bash
npx supabase secrets set GROQ_API_KEY=... GROQ_MODEL=openai/gpt-oss-20b APP_ORIGIN=aurevion://
npx supabase functions deploy financial-assistant
```

`GROQ_API_KEY` nunca recebe o prefixo `EXPO_PUBLIC_`. O modelo padrão é o `openai/gpt-oss-20b`, modelo de produção econômico da Groq. A função valida JWT, membership, tamanho da pergunta, origem web e limites de 5 requisições/minuto e 25/dia por usuário. Ela consulta o contexto agregado no servidor; o cliente não envia extratos nem saldos no prompt.

## Realtime e rede instável

As tabelas relevantes entram na publicação `supabase_realtime`. O cliente usa TanStack Query para cache e refetch na reconexão. O modo local persiste a demonstração em AsyncStorage; sessões ficam em SecureStore. Operações online devem exibir `pending`, `synced` ou `error` e reutilizar a mesma chave de idempotência após falha de rede.

Não mostre “sincronizado” antes da confirmação do backend. Não armazene a base financeira online completa em texto puro no dispositivo; mantenha apenas o cache mínimo necessário e ofereça limpeza no logout.

## Exportação e recuperação

A recuperação de senha abre a troca dentro do aplicativo pelo link seguro enviado pelo Supabase. A tela também aceita o código de 6 dígitos quando o template de email estiver configurado com `{{ .Token }}`. O SMTP padrão gratuito do Supabase bloqueia a edição desse template; para usar somente código, conecte um SMTP próprio. Até lá, o link interno é o fluxo funcional e seguro.

CSV serve para análise; JSON preserva estrutura suficiente para migração. Os arquivos são criados no cache do aparelho e entregues pela folha nativa de compartilhamento. Exportação não substitui backup do banco.

Para produção, habilite os backups/PITR disponíveis no plano Supabase escolhido, monitore restaurações e faça testes periódicos. No plano gratuito, confirme a política vigente antes do lançamento; não prometa recuperação que o provedor não oferece.

## EAS / Android / iOS

O arquivo `eas.json` contém perfis de development, preview (APK) e production (AAB/IPA). Vincule o projeto real sem inventar IDs:

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile production --platform all
```

Build iOS distribuível exige conta Apple; Google Play exige conta Play Console. Esses custos e credenciais pertencem às lojas, não ao código. Até lá, Expo Go é o caminho gratuito.

O Expo Go serve para desenvolvimento e carrega o projeto oferecido pelo servidor do QR; ele não instala o A&T como aplicativo independente. O APK Android consulta as Releases públicas do GitHub e oferece atualizações assinadas. Consulte [docs/REMOTE_UPDATES.md](docs/REMOTE_UPDATES.md) para publicar versões sem servidor pago.

Desde o Expo SDK 53, notificações push remotas não funcionam no Expo Go. Nele, os avisos de gasto são locais e em tempo real enquanto o projeto está aberto. Avisos com o aplicativo encerrado exigem um build próprio configurado com FCM no Android e APNs no iOS.

As contas de infraestrutura (Supabase, Groq e Expo/EAS) podem permanecer centralizadas no email técnico da Aurevion. “Aurevion” não aparece como nome do produto para Alberto e Thauane.

## Segurança e privacidade

- RLS está ativo em todas as tabelas sensíveis; não existe policy `USING (true)`.
- IDs de conta, cartão, categoria e usuário são revalidados no banco.
- `transactions`, `ledger_entries`, faturas e pagamentos não aceitam escrita direta de `authenticated`; apenas RPCs revisadas podem alterá-los.
- Anexos aceitam apenas JPEG, PNG, WebP e PDF, no máximo 10 MiB, bucket privado e caminho iniciado pelo household.
- Cartões guardam apenas nome e últimos quatro dígitos; nunca PAN, CVV ou senha.
- Auditoria registra ator e alterações. Logs de infraestrutura não devem conter payload financeiro, JWT ou chave de API.
- Veja [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Estrutura

```text
app/                    rotas e telas Expo Router
components/             marca e componentes visuais
lib/                    motor financeiro, Supabase, formatos e exportação
providers/              autenticação e cache
store/                  demonstração local
supabase/migrations/     schema, RLS e RPCs atômicos
supabase/functions/      gateway seguro para Groq
supabase/tests/          testes de políticas
docs/                    arquitetura e threat model
```

## Antes de publicar

- Rodar testes de RLS contra três usuários reais de homologação (Alberto, Thauane e um usuário externo).
- Testar restauração de backup, revogação de sessão, aparelhos roubados e concorrência com dois celulares.
- Configurar monitoramento sem valores financeiros em logs.
- Executar varredura de dependências e atualizar somente dentro da faixa suportada pelo Expo SDK.
- Concluir revisão legal/LGPD, termos de uso e política de privacidade.
