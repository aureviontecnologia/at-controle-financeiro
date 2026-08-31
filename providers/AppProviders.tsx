import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type PropsWithChildren } from 'react';

import { configureSharedNotificationHandler } from '@/lib/notifications';

import { AuthProvider } from './AuthProvider';
import { ThemeProvider } from './ThemeProvider';
import { UpdateProvider } from './UpdateProvider';

export function AppProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    // Alguns aparelhos inicializam o serviço do Google depois do React Native.
    // A configuração de push é opcional e nunca deve encerrar o app.
    try { configureSharedNotificationHandler(); } catch { /* aguarda nova tentativa ao ativar notificações */ }
  }, []);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: (count, error) => count < 2 && !String(error).toLowerCase().includes('permiss'),
            refetchOnReconnect: true,
          },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider><ThemeProvider><UpdateProvider>{children}</UpdateProvider></ThemeProvider></AuthProvider>
    </QueryClientProvider>
  );
}
