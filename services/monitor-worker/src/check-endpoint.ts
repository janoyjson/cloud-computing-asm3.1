import type { CheckResult, CheckSource } from '@cloudsentinel/shared';

import { assertPublicHttpUrl, type HostResolver } from './url-safety.js';

type FetchImplementation = typeof fetch;

export interface CheckEndpointInput {
  endpointId: string;
  url: string;
  source: CheckSource;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function checkEndpoint(
  input: CheckEndpointInput,
  fetchImplementation: FetchImplementation = fetch,
  now: () => number = Date.now,
  resolveHost?: HostResolver,
): Promise<CheckResult> {
  const startedAt = now();
  const checkedAt = new Date(startedAt).toISOString();
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxRedirects = input.maxRedirects ?? 5;

  try {
    let currentUrl = await assertPublicHttpUrl(input.url, resolveHost);
    let response: Response | undefined;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      response = await fetchImplementation(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': 'CloudSentinel/0.2 (+availability-monitor)',
        },
      });

      const location = response.headers.get('location');
      const isRedirect = response.status >= 300 && response.status < 400 && location;
      if (!isRedirect) {
        break;
      }

      if (redirectCount === maxRedirects) {
        throw new Error(`Endpoint exceeded ${maxRedirects} redirects.`);
      }

      currentUrl = await assertPublicHttpUrl(new URL(location, currentUrl).toString(), resolveHost);
    }

    if (!response) {
      throw new Error('Endpoint did not return a response.');
    }

    return {
      endpointId: input.endpointId,
      checkedAt,
      state: response.ok ? 'UP' : 'DOWN',
      source: input.source,
      responseTimeMs: Math.max(0, now() - startedAt),
      statusCode: response.status,
    };
  } catch (error) {
    return {
      endpointId: input.endpointId,
      checkedAt,
      state: 'DOWN',
      source: input.source,
      responseTimeMs: Math.max(0, now() - startedAt),
      error: (error instanceof Error ? error.message : 'Unknown monitoring error').slice(0, 240),
    };
  }
}
