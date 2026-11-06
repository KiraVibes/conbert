import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePublicLink } from '../downloader/tools';
import { hostCheck, isPrivateAddressError, publicFetch } from './public-net';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((_req, res) => res.end('inside'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The request fails, and the reason is the private address. */
async function refused(url: string): Promise<void> {
  const error = await publicFetch(url).then(
    () => null,
    (e: unknown) => e,
  );
  expect(isPrivateAddressError(error), String(error)).toBe(true);
}

describe('public requests', () => {
  it('works for the server itself with plain fetch (sanity check)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe('inside');
  });

  it('never reaches private addresses, by IP or by name', async () => {
    await refused(`http://127.0.0.1:${port}/`);
    await refused(`http://[::ffff:127.0.0.1]:${port}/`);
    // A name that resolves to this machine (like a rebinding DNS answer would).
    await refused(`http://localhost:${port}/`);
  });

  it('checks names before the tools get them', async () => {
    expect(await hostCheck('localhost')).toBe('private');
    expect(await hostCheck('127.0.0.1')).toBe('private');
    expect(await hostCheck('does-not-exist.invalid')).toBe('unknown');
    await expect(ensurePublicLink('http://localhost/x')).rejects.toMatchObject({
      code: 'DOWNLOAD_PRIVATE_ADDRESS',
    });
    await expect(ensurePublicLink('https://does-not-exist.invalid/')).rejects.toMatchObject({
      code: 'DOWNLOAD_HOST_UNKNOWN',
    });
    // IP addresses are checked when the link is entered, not here.
    await expect(ensurePublicLink(`http://127.0.0.1:${port}/`)).resolves.toBeUndefined();
  });
});
