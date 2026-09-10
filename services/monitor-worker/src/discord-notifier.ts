import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { isApprovedDiscordWebhookUrl, type CheckResult, type Incident } from '@cloudsentinel/shared';

import type { NotificationKind } from './incident-store.js';

type FetchImplementation = typeof fetch;

export interface IncidentNotification {
  kind: NotificationKind;
  incident: Incident;
  check: CheckResult;
  endpointName: string;
  endpointUrl: string;
}

export interface IncidentNotifier {
  send(notification: IncidentNotification): Promise<void>;
}

interface DiscordWebhookNotifierOptions {
  secretId: string;
  secretsClient?: SecretsManagerClient;
  fetchImplementation?: FetchImplementation;
}

function parseWebhookUrl(secretString: string | undefined): string {
  if (!secretString) {
    throw new Error('The notification secret has no string value.');
  }

  let urlValue: unknown;
  try {
    urlValue = (JSON.parse(secretString) as { url?: unknown }).url;
  } catch {
    throw new Error('The notification secret must be JSON with a url field.');
  }

  if (typeof urlValue !== 'string') {
    throw new Error('The notification secret must contain a string url field.');
  }

  if (!isApprovedDiscordWebhookUrl(urlValue)) {
    throw new Error('The notification secret does not contain an approved Discord webhook URL.');
  }

  const url = new URL(urlValue);
  url.searchParams.set('wait', 'true');
  return url.toString();
}

export class DiscordWebhookNotifier implements IncidentNotifier {
  readonly #secretId: string;
  readonly #secretsClient: SecretsManagerClient;
  readonly #fetch: FetchImplementation;
  #webhookUrl: string | undefined;

  public constructor(options: DiscordWebhookNotifierOptions) {
    this.#secretId = options.secretId;
    this.#secretsClient = options.secretsClient ?? new SecretsManagerClient({});
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  public async send(notification: IncidentNotification): Promise<void> {
    const response = await this.#fetch(await this.#getWebhookUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'CloudSentinel',
        content: this.#message(notification),
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Discord rejected the notification with HTTP ${response.status}.`);
    }
  }

  async #getWebhookUrl(): Promise<string> {
    if (this.#webhookUrl) {
      return this.#webhookUrl;
    }

    const response = await this.#secretsClient.send(new GetSecretValueCommand({
      SecretId: this.#secretId,
    }));
    this.#webhookUrl = parseWebhookUrl(response.SecretString);
    return this.#webhookUrl;
  }

  #message(notification: IncidentNotification): string {
    const status = notification.check.statusCode
      ? `HTTP ${notification.check.statusCode}`
      : notification.check.error ?? 'Network error';
    if (notification.kind === 'OUTAGE') {
      return `🔴 CloudSentinel outage\n${notification.endpointName}\n${notification.endpointUrl}\n${status}\nDetected ${notification.check.checkedAt}`;
    }

    return `🟢 CloudSentinel recovery\n${notification.endpointName}\n${notification.endpointUrl}\nRecovered in ${notification.check.responseTimeMs} ms\n${notification.check.checkedAt}`;
  }
}
