import { describe, expect, it } from 'vitest';
import { contactPayload, readQrContent, wifiPayload } from './qr-content';

describe('QR contents', () => {
  it('writes and reads WLAN access, special characters included', () => {
    const wifi = {
      ssid: 'Haus;WLAN',
      password: 'ge:heim\\"1',
      security: 'WPA' as const,
      hidden: true,
    };
    const payload = wifiPayload(wifi);
    expect(payload).toBe('WIFI:T:WPA;S:Haus\\;WLAN;P:ge\\:heim\\\\\\"1;H:true;;');
    expect(readQrContent(payload)).toEqual({ kind: 'wifi', wifi });
    const open = wifiPayload({ ssid: 'Café', password: 'x', security: 'nopass', hidden: false });
    expect(open).toBe('WIFI:T:nopass;S:Café;;');
    expect(readQrContent(open)).toMatchObject({ kind: 'wifi', wifi: { security: 'nopass' } });
  });

  it('writes and reads a contact card', () => {
    const contact = {
      name: 'Anna Maria Beispiel',
      phone: '+49 170 1234567',
      email: 'anna@example.org',
      org: 'Zauber, GmbH',
      url: 'https://example.org',
    };
    const vcard = contactPayload(contact);
    expect(vcard).toContain('N:Beispiel;Anna Maria;;;');
    expect(vcard).toContain('ORG:Zauber\\, GmbH');
    const read = readQrContent(vcard);
    expect(read).toMatchObject({ kind: 'contact', contact });
  });

  it('recognises links, mail, phone and plain text', () => {
    expect(readQrContent('https://conbert.example/x?y=1')).toEqual({
      kind: 'url',
      url: 'https://conbert.example/x?y=1',
    });
    expect(readQrContent('mailto:a%40b.de?subject=Hi')).toEqual({
      kind: 'email',
      address: 'a@b.de',
    });
    expect(readQrContent('tel:+4930123')).toEqual({ kind: 'phone', number: '+4930123' });
    expect(readQrContent('Hallo Welt')).toEqual({ kind: 'text', text: 'Hallo Welt' });
    // "javascript:" and the like are plain text, never a link.
    expect(readQrContent('javascript:alert(1)').kind).toBe('text');
  });
});
