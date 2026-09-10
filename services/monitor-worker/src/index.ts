import type { CheckSource } from '@cloudsentinel/shared';

import { checkEndpoint } from './check-endpoint.js';
import { DiscordWebhookNotifier, type IncidentNotifier } from './discord-notifier.js';
import { IncidentService } from './incident-service.js';
import { DynamoIncidentStore } from './incident-store.js';
import { AwsResultStore } from './result-store.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function checkSource(value: string | undefined): CheckSource {
  if (!value || value === 'MANUAL') {
    return 'MANUAL';
  }

  if (value === 'SCHEDULED') {
    return 'SCHEDULED';
  }

  throw new Error('MONITOR_SOURCE must be MANUAL or SCHEDULED.');
}

async function main(): Promise<void> {
  const targetUrl = requiredEnvironment('MONITOR_TARGET_URL');
  const endpointId = requiredEnvironment('MONITOR_ENDPOINT_ID');
  const ownerId = process.env.MONITOR_OWNER_ID?.trim();
  const monitorsTableName = requiredEnvironment('MONITORS_TABLE_NAME');
  const checksTableName = requiredEnvironment('CHECKS_TABLE_NAME');
  const incidentsTableName = requiredEnvironment('INCIDENTS_TABLE_NAME');
  const resultsBucketName = requiredEnvironment('RESULTS_BUCKET_NAME');
  const notificationSecretId = process.env.NOTIFICATION_SECRET_ID?.trim();

  const result = await checkEndpoint({
    endpointId,
    url: targetUrl,
    source: checkSource(process.env.MONITOR_SOURCE),
  });

  const resultStore = new AwsResultStore({
    monitorsTableName,
    checksTableName,
    resultsBucketName,
  });
  const savedContext = await resultStore.save({ ...result, ...(ownerId ? { ownerId } : {}) });

  const notifier: IncidentNotifier = notificationSecretId
    ? new DiscordWebhookNotifier({ secretId: notificationSecretId })
    : { send: async () => undefined };
  const incidentService = new IncidentService({
    repository: new DynamoIncidentStore({ tableName: incidentsTableName }),
    notifier,
  });
  await incidentService.process({
    previousCheck: savedContext.previousCheck,
    currentCheck: result,
    endpointName: savedContext.endpointName ?? endpointId,
    endpointUrl: savedContext.endpointUrl ?? targetUrl,
  });

  console.log(JSON.stringify(result));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
