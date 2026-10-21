# Saldo

Aplicativo pessoal de controle financeiro do Alberto, com visual escuro e minimalista. O produto reúne contas, cartões, faturas, despesas, entradas, ticket-benefício, cofres, metas e projeções mensais sem misturar valores de naturezas diferentes.

## Plataformas

- Android: APK independente, com atualização por GitHub Releases.
- Somente Android. PWA, web e iOS estão desativados.
- O APK é independente e não depende do Expo Go nem de um computador ligado para uso normal.

## Principais recursos

- Conta pessoal vinculada a `albertocoutodev@gmail.com`.
- Login persistente, saída segura, troca de senha autenticada e recuperação por link ou código.
- Primeiro acesso com senha temporária exige imediatamente uma nova senha forte.
- Contas, dinheiro, cofres e ticket mantidos em saldos separados.
- Cartões com limite total, disponível, fatura atual, próximas faturas e pagamentos parciais.
- Despesas e rendas rápidas, inclusive entregas, salário, vendas e reembolsos.
- Projeção mensal que compara saldo, entradas previstas, contas e faturas por vencimento.
- Assistente financeiro Groq com contexto pessoal, histórico e ações que sempre pedem confirmação.
- Dados sincronizados no Supabase: o mesmo login carrega os registros em outro Android. Não substitui um backup independente com recuperação por data.
- Notificações pessoais de movimentações, vencimentos, recargas e limite diário.
- Modo local de demonstração quando as variáveis de nuvem não estiverem configuradas.

## Desenvolvimento

Requer Node.js 20+.

```bash
npm install
npm run start
```

Para conferir o projeto:

```bash
npm run typecheck
npm test
npx expo export --platform android
```

As configurações públicas do Supabase ficam em `.env.local`, ignorado pelo Git. Chaves privadas, senhas e tokens nunca devem entrar no repositório.

## Autenticação e recuperação

O Supabase Auth é a fonte de verdade. O aplicativo aceita somente a conta pessoal configurada, valida a senha atual antes da troca direta e exige senha de pelo menos 12 caracteres com maiúscula, minúscula, número e símbolo.

O fluxo “Esqueci minha senha” envia o link seguro padrão do Supabase. É possível pedir outro email após 60 segundos, respeitando também o limite de envio do servidor. A tela aceita código, mas o email com código depende de SMTP e template personalizados: esse envio personalizado não está ativo no mailer gratuito. Os modelos opcionais estão em `supabase/templates/`.

## Supabase

As migrations ficam em `supabase/migrations/`. A migration `202610190001_personal_alberto_workspace.sql` consolida os registros existentes na conta do Alberto, remove o acesso antigo de terceiros e ativa a troca obrigatória de senha.

O assistente é publicado como Edge Function e a chave da Groq permanece apenas nos secrets do backend:

```bash
npx supabase functions deploy financial-assistant --project-ref SEU_PROJECT_REF
npx supabase secrets set GROQ_API_KEY=... GROQ_MODEL=openai/gpt-oss-20b APP_ORIGIN=aurevion:// --project-ref SEU_PROJECT_REF
```

## Cloudflare Notifications API

```bash
npx wrangler deploy
```

O Worker não hospeda uma PWA. Ele aceita apenas as rotas autenticadas de notificação do Android. O banco D1 contém somente dados técnicos necessários às inscrições de push. Veja [docs/REMOTE_UPDATES.md](docs/REMOTE_UPDATES.md) para o fluxo de versão do APK.

## Segurança

- Row Level Security protege os dados no Supabase.
- O app não armazena PAN, CVV, senha bancária nem chave privada.
- Sessões ficam no SecureStore do Android.
- Operações financeiras da IA exigem confirmação humana.
- Backups Android estão desativados.
- Notificações não exibem segredos.
- Consulte [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Licença

Uso privado.
