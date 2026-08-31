# Atualizações remotas

O APK Android consulta automaticamente a versão estável mais recente em:

`https://api.github.com/repos/aureviontecnologia/at-controle-financeiro/releases/latest`

O processo não exige servidor pago:

1. uma tag `vX.Y.Z` dispara o workflow `Publicar APK Android`;
2. o GitHub compila somente ARM64, assina com a chave guardada em Actions Secrets e publica o APK em Releases;
3. ao abrir ou retomar o aplicativo, uma consulta é feita no máximo uma vez a cada seis horas;
4. uma versão maior oferece o download dentro do app;
5. antes de abrir o instalador, o tamanho e o SHA-256 fornecido pelo GitHub são verificados;
6. o Android confere novamente a assinatura do pacote e sempre exige confirmação humana para instalar.

## Publicar uma versão

Atualize o código, rode as verificações e crie uma tag sem reutilizar números:

```bash
npm run typecheck
npm test
git tag v1.0.1
git push origin main v1.0.1
```

O número interno do Android usa o contador monotônico do workflow. A versão visível vem da tag. Nunca apague e recrie uma tag publicada.

## Secrets do repositório

O workflow exige os seguintes Actions Secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

A chave de assinatura nunca deve entrar no Git, nos artefatos ou nos logs. Uma troca da chave impede que o Android aceite a atualização sobre uma instalação existente.

## Expo Go e iPhone

Expo Go executa o projeto dentro de outro aplicativo. Portanto, ele não pode instalar nem atualizar o APK do A&T. Durante o desenvolvimento ele carrega o bundle oferecido pelo servidor do QR. No iPhone, um aplicativo independente requer um build iOS assinado; distribuição estável normalmente passa por TestFlight/App Store e pelas regras da Apple.
