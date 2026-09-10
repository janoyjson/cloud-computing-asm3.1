import type { PerformanceResult } from '@cloudsentinel/shared';

type FetchImplementation = typeof fetch;

interface PageSpeedClientOptions {
  apiKey?: string;
  fetchImplementation?: FetchImplementation;
  now?: () => Date;
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
}

interface PageSpeedResponse {
  lighthouseResult?: {
    categories?: Record<string, { score?: number }>;
    audits?: Record<string, { numericValue?: number }>;
  };
}

export class PageSpeedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PageSpeedError';
  }
}

function score(categories: Record<string, { score?: number }> | undefined, name: string): number {
  const value = categories?.[name]?.score;
  if (typeof value !== 'number') {
    throw new Error(`PageSpeed response did not include the ${name} score.`);
  }
  return Number((value * 100).toFixed(2));
}

function metric(audits: Record<string, { numericValue?: number }> | undefined, name: string): number | undefined {
  const value = audits?.[name]?.numericValue;
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

export class PageSpeedClient {
  readonly #apiKey: string | undefined;
  readonly #fetch: FetchImplementation;
  readonly #now: () => Date;
  readonly #attemptTimeoutMs: number;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  public constructor(options: PageSpeedClientOptions = {}) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#attemptTimeoutMs = options.attemptTimeoutMs ?? 12_000;
    this.#maxAttempts = options.maxAttempts ?? 2;
    this.#retryDelayMs = options.retryDelayMs ?? 250;
    this.#sleep = options.sleepImplementation ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  public async analyze(endpointId: string, url: string): Promise<PerformanceResult> {
    const requestUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    requestUrl.searchParams.set('url', url);
    requestUrl.searchParams.append('category', 'performance');
    requestUrl.searchParams.append('category', 'accessibility');
    requestUrl.searchParams.append('category', 'best-practices');
    requestUrl.searchParams.append('category', 'seo');
    requestUrl.searchParams.set('strategy', 'mobile');
    if (this.#apiKey) {
      requestUrl.searchParams.set('key', this.#apiKey);
    }

    let response: Response | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      response = undefined;
      lastError = undefined;
      try {
        response = await this.#fetch(requestUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(this.#attemptTimeoutMs),
        });

        if (response.ok || !this.#isRetryableStatus(response.status) || attempt === this.#maxAttempts) {
          break;
        }
      } catch (error) {
        lastError = error;
        if (!this.#isRetryableError(error)) {
          throw error;
        }
        if (attempt === this.#maxAttempts) break;
      }

      await this.#sleep(this.#retryDelayMs * attempt);
    }

    if (lastError) {
      if (lastError instanceof DOMException && lastError.name === 'TimeoutError') {
        throw new PageSpeedError(`PageSpeed timed out after ${this.#attemptTimeoutMs / 1000} seconds. The target may block Lighthouse or be too slow. Try a public HTTPS page and retry.`);
      }
      throw new Error(`PageSpeed request failed after ${this.#maxAttempts} attempts: ${this.#errorMessage(lastError)}`);
    }

    if (!response) {
      throw new Error('PageSpeed did not return a response.');
    }

    if (!response.ok) {
      const details = await this.#readErrorDetails(response);
      throw new PageSpeedError(`PageSpeed rejected the request with HTTP ${response.status}${details ? `: ${details}` : ` after ${this.#maxAttempts} attempts.`}`);
    }

    const payload = await response.json() as PageSpeedResponse;
    const lighthouse = payload.lighthouseResult;
    return {
      endpointId,
      measuredAt: this.#now().toISOString(),
      strategy: 'MOBILE',
      performanceScore: score(lighthouse?.categories, 'performance'),
      accessibilityScore: score(lighthouse?.categories, 'accessibility'),
      bestPracticesScore: score(lighthouse?.categories, 'best-practices'),
      seoScore: score(lighthouse?.categories, 'seo'),
      firstContentfulPaintMs: metric(lighthouse?.audits, 'first-contentful-paint'),
      largestContentfulPaintMs: metric(lighthouse?.audits, 'largest-contentful-paint'),
      cumulativeLayoutShift: metric(lighthouse?.audits, 'cumulative-layout-shift'),
    };
  }

  #isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  #isRetryableError(error: unknown): boolean {
    return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
      || error instanceof TypeError;
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'network error';
  }

  async #readErrorDetails(response: Response): Promise<string | undefined> {
    try {
      const payload = await response.json() as { error?: { message?: string } };
      const message = payload.error?.message?.trim();
      return message || undefined;
    } catch {
      return undefined;
    }
  }
}
