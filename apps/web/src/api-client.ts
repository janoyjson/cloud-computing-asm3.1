import type { CreateEndpointInput, MonitoredEndpoint } from '@cloudsentinel/shared';

interface EndpointListResponse {
  items: MonitoredEndpoint[];
}

interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

type FetchClient = typeof fetch;

export class CloudSentinelApiClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchClient;

  public constructor(
    baseUrl: string,
    fetchClient: FetchClient = window.fetch.bind(window),
  ) {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
      throw new Error('The API base URL must use HTTPS.');
    }

    this.#baseUrl = parsedUrl.toString().replace(/\/$/, '');
    this.#fetch = fetchClient;
  }

  public async listEndpoints(): Promise<MonitoredEndpoint[]> {
    const response = await this.#request<EndpointListResponse>('/v1/endpoints');
    return response.items;
  }

  public createEndpoint(input: CreateEndpointInput): Promise<MonitoredEndpoint> {
    return this.#request<MonitoredEndpoint>('/v1/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    const payload = await response.json() as T & ApiErrorResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `API request failed with status ${response.status}.`);
    }

    return payload;
  }
}
