import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { resources } from '@conbert/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';

/** A separate i18n instance for tests, fixed to German. */
export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  resources,
  lng: 'de',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions) {
  // A fresh query cache per test; no retries, so failed requests show up at once.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <TooltipProvider>{ui}</TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
    options,
  );
}
