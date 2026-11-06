import { BlockList, isIP } from 'node:net';

/**
 * Matches client addresses against the configured proxy list
 * (single IPs or CIDR ranges, IPv4 and IPv6).
 */
export function createProxyMatcher(
  entries: readonly string[],
): (address: string | undefined) => boolean {
  const list = new BlockList();
  for (const entry of entries) {
    const [ip = '', prefix] = entry.split('/');
    const family = isIP(ip);
    if (family === 0) throw new Error(`Invalid address in CONBERT_TRUSTED_PROXIES: ${entry}`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(ip, type);
    else list.addSubnet(ip, Number(prefix), type);
  }
  return (address) => {
    if (!address) return false;
    // IPv4 clients on a dual-stack socket appear as ::ffff:1.2.3.4
    const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
    const family = isIP(plain);
    if (family === 0) return false;
    return list.check(plain, family === 4 ? 'ipv4' : 'ipv6');
  };
}
