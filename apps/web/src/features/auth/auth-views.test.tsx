import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURES, type AuthStatusResponse } from '@conbert/schemas';
import { renderWithProviders } from '@/test/render';
import { AuthGate } from './AuthGate';

const user = {
  id: 'u1',
  username: 'anna',
  displayName: null,
  role: 'admin' as const,
  hasPassword: true,
  createdAt: new Date().toISOString(),
  authSource: 'local' as const,
  permissions: [...FEATURES],
};

function status(overrides: Partial<AuthStatusResponse>): AuthStatusResponse {
  return {
    setupRequired: false,
    authMode: 'local',
    proxyAvailable: false,
    proxyUser: null,
    user: null,
    ...overrides,
  };
}

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
let handler: Handler;
const calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const res = handler(url, init);
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>App content</p>
      </AuthGate>
    </QueryClientProvider>,
  );
}

describe('AuthGate', () => {
  it('shows the setup page on first start and sends the setup', async () => {
    let done = false;
    handler = (url) => {
      if (url === '/api/auth/setup') {
        done = true;
        return { status: 200, body: { user } };
      }
      return {
        status: 200,
        body: done ? status({ user }) : status({ setupRequired: true }),
      };
    };
    renderGate();
    expect(await screen.findByText('Willkommen bei Conbert!')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Einrichtungscode'), 'K7QM-3XRP');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'anna');
    await userEvent.type(screen.getByLabelText('Passwort'), 'kurz');
    expect(screen.getByText(/Noch zu kurz/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Passwort'), ' aber jetzt lang');
    await userEvent.type(screen.getByLabelText('Passwort wiederholen'), 'kurz aber jetzt lang');
    await userEvent.click(screen.getByRole('button', { name: 'Einrichtung abschließen' }));

    expect(await screen.findByText('App content')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/auth/setup')?.body).toEqual({
      mode: 'local',
      setupCode: 'K7QM-3XRP',
      username: 'anna',
      password: 'kurz aber jetzt lang',
    });
  });

  it('shows the login page and a clear error for a wrong password', async () => {
    handler = (url) =>
      url === '/api/auth/login'
        ? {
            status: 401,
            body: { error: { code: 'INVALID_LOGIN', messageKey: 'errors.invalidLogin' } },
          }
        : { status: 200, body: status({}) };
    renderGate();
    await userEvent.type(await screen.findByLabelText('Benutzername'), 'anna');
    await userEvent.type(screen.getByLabelText('Passwort'), 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText('Anmeldung fehlgeschlagen.')).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('shows the app when signed in', async () => {
    handler = () => ({ status: 200, body: status({ user }) });
    renderGate();
    expect(await screen.findByText('App content')).toBeInTheDocument();
  });

  it('explains a missing proxy login instead of a password form', async () => {
    handler = () => ({ status: 200, body: status({ authMode: 'proxy' }) });
    renderGate();
    expect(await screen.findByText('Deine Anmeldung wurde nicht erkannt.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Passwort')).not.toBeInTheDocument();
  });

  it('keeps converting on this device available when the server cannot be reached', async () => {
    let fail = true;
    vi.stubGlobal('fetch', async () => {
      if (fail) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(status({ user })), { status: 200 });
    });
    renderGate();
    // The status query retries once before giving up.
    expect(
      await screen.findByText('Keine Verbindung zum Server', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Dateien hierher ziehen')).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Erneut verbinden' }));
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument());
  });
});
