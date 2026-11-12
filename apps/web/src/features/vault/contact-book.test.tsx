import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '@conbert/schemas';
import { findMissingKeys } from '@conbert/i18n';
import { renderWithProviders } from '@/test/render';
import { ContactBook, ContactChecklist } from './ContactBook';

const KEY_A = `age1${'q'.repeat(58)}`;
const KEY_B = `age1${'p'.repeat(58)}`;

const contact = (id: string, name: string, publicKey: string): Contact => ({
  id,
  name,
  publicKey,
  note: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

let contacts: Contact[];
const calls: { method: string; url: string; body: unknown }[] = [];

beforeEach(() => {
  contacts = [contact('c1', 'Anna', KEY_A)];
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url === '/api/keys/me') return json(200, { key: null });
    if (url === '/api/keys/contacts' && method === 'POST') {
      const created = contact('c2', body.name, body.publicKey);
      contacts.push(created);
      return json(201, { contact: created });
    }
    if (url === '/api/keys/contacts') return json(200, { contacts });
    return json(404, { error: { code: 'NOT_FOUND', messageKey: 'errors.notFound' } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('contact book', () => {
  it('lists contacts and saves a new one by name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactBook />);
    expect(await screen.findByText('Anna')).toBeInTheDocument();

    // The label also holds the ⓘ button, so find the field by its id.
    const keyField = () => document.getElementById('contact-key') as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Kontakt speichern' });
    await user.type(screen.getByLabelText('Name'), 'Ben');
    await user.type(keyField(), 'AGE-SECRET-KEY-1ABC');
    // A private key is called out and can't be saved.
    expect(screen.getByRole('alert')).toHaveTextContent('privater Schlüssel');
    expect(save).toBeDisabled();

    await user.clear(keyField());
    await user.type(keyField(), KEY_B);
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Ben',
        publicKey: KEY_B,
      }),
    );
    expect(await screen.findByText('Ben')).toBeInTheDocument();
  });

  it('ticks recipients by name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <ContactChecklist
        contacts={[contact('c1', 'Anna', KEY_A), contact('c2', 'Ben', KEY_B)]}
        selected={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Ben' }));
    expect(onChange).toHaveBeenCalledWith(['c2']);
  });

  it('explains an empty contact book and every contact error', () => {
    renderWithProviders(<ContactChecklist contacts={[]} selected={[]} onChange={() => {}} />);
    expect(screen.getByText(/Kontaktbuch ist noch leer/)).toBeInTheDocument();
    const keys = ['contactKeyInvalid', 'contactExists', 'contactLimit'].flatMap((k) =>
      ['what', 'cause', 'action'].map((part) => `errors.${k}.${part}`),
    );
    expect(findMissingKeys(keys)).toEqual([]);
  });
});
