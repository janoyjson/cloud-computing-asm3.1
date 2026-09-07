import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
};

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;

  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('::ffff:') && isBlockedIpv4(normalized.slice(7));
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? isBlockedIpv4(address) : version === 6 ? isBlockedIpv6(address) : true;
}

export async function assertPublicHttpUrl(
  value: string,
  resolveHost: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Monitor URL must be an absolute HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Monitor URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Monitor URL must not include credentials.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Monitor URL resolves to a blocked destination.');
  }

  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error('Monitor URL resolves to a blocked destination.');
  }

  return url;
}
