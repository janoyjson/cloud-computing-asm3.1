import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
};

function blockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 0 || first === 10 || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || (normalized.startsWith('::ffff:') && blockedIpv4(normalized.slice(7)));
}

function blockedAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? blockedIpv4(address) : version === 6 ? blockedIpv6(address) : true;
}

export async function assertPublicHttpUrl(
  value: string,
  resolveHost: HostResolver = defaultResolver,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL must be an absolute HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('URL must not include credentials.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('URL resolves to a blocked destination.');
  }
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (addresses.length === 0 || addresses.some(blockedAddress)) {
    throw new Error('URL resolves to a blocked destination.');
  }
}
