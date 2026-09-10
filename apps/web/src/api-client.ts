import type {
  AnalyticsOverview,
  CreateEndpointInput,
  Incident,
  MonitoredEndpoint,
  PerformanceResult,
  UpdateEndpointInput,
} from '@cloudsentinel/shared';

interface EndpointListResponse {
  items: MonitoredEndpoint[];
}

interface StartCheckResponse {
  taskArn: string;
  status: 'STARTED';
}

interface PerformanceListResponse {
  items: PerformanceResult[];
}

interface IncidentListResponse {
  items: Incident[];
}

export interface DiscordWebhookSettings {
  configured: boolean;
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
  #accessToken: string | undefined;

  public constructor(
    baseUrl: string,
    fetchClient: FetchClient = window.fetch.bind(window),
    accessToken?: string,
  ) {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
      throw new Error('The API base URL must use HTTPS.');
    }

    this.#baseUrl = parsedUrl.toString().replace(/\/$/, '');
    this.#fetch = fetchClient;
    this.#accessToken = accessToken?.trim() || undefined;
  }

  public setAccessToken(accessToken?: string): void {
    this.#accessToken = accessToken?.trim() || undefined;
  }

  public async listEndpoints(): Promise<MonitoredEndpoint[]> {
    const response = await this.#request<EndpointListResponse>('/v1/endpoints');
    return response.items;
  }

  public getDiscordWebhookSettings(): Promise<DiscordWebhookSettings> {
    return this.#request<DiscordWebhookSettings>('/v1/settings/discord');
  }

  public saveDiscordWebhook(webhookUrl: string): Promise<DiscordWebhookSettings> {
    return this.#request<DiscordWebhookSettings>('/v1/settings/discord', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhookUrl }),
    });
  }

  public removeDiscordWebhook(): Promise<DiscordWebhookSettings> {
    return this.#request<DiscordWebhookSettings>('/v1/settings/discord', { method: 'DELETE' });
  }

  public createEndpoint(input: CreateEndpointInput): Promise<MonitoredEndpoint> {
    return this.#request<MonitoredEndpoint>('/v1/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  public updateEndpoint(endpointId: string, input: UpdateEndpointInput): Promise<MonitoredEndpoint> {
    return this.#request<MonitoredEndpoint>(`/v1/endpoints/${encodeURIComponent(endpointId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  public async deleteEndpoint(endpointId: string): Promise<void> {
    await this.#request(`/v1/endpoints/${encodeURIComponent(endpointId)}`, { method: 'DELETE' });
  }

  public startCheck(endpointId: string): Promise<StartCheckResponse> {
    return this.#request<StartCheckResponse>(`/v1/endpoints/${encodeURIComponent(endpointId)}/checks`, {
      method: 'POST',
    });
  }

  public runPerformance(endpointId: string): Promise<PerformanceResult> {
    return this.#request<PerformanceResult>(`/v1/endpoints/${encodeURIComponent(endpointId)}/performance`, {
      method: 'POST',
    });
  }

  public listPerformance(endpointId: string): Promise<PerformanceResult[]> {
    return this.#request<PerformanceListResponse>(`/v1/endpoints/${encodeURIComponent(endpointId)}/performance`)
      .then((response) => response.items);
  }

  public listIncidents(endpointId: string): Promise<Incident[]> {
    return this.#request<IncidentListResponse>(`/v1/endpoints/${encodeURIComponent(endpointId)}/incidents`)
      .then((response) => response.items);
  }

  public getAnalyticsOverview(range?: { from?: string; to?: string }): Promise<AnalyticsOverview> {
    const query = new URLSearchParams();
    if (range?.from) query.set('from', range.from);
    if (range?.to) query.set('to', range.to);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.#request<AnalyticsOverview>(`/v1/analytics/overview${suffix}`);
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.#accessToken) {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
      return this.#parseResponse<T>(response);
    }

    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${this.#accessToken}`);
    const response = await this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers });
    return this.#parseResponse<T>(response);
  }

  async #parseResponse<T>(response: Response): Promise<T> {
    const payload = await response.json() as T & ApiErrorResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `API request failed with status ${response.status}.`);
    }

    return payload;
  }
}
