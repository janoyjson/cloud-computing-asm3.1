import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { AnalyticsOverview, CreateEndpointInput, PerformanceResult, UpdateEndpointInput } from '@cloudsentinel/shared';

import { EcsCheckTaskStarter, type CheckTaskStarter } from './check-task-starter.js';
import { DynamoEndpointStore } from './dynamodb-endpoint-store.js';
import { ValidationError, type EndpointRepository } from './endpoint-store.js';
import { PageSpeedClient } from './pagespeed-client.js';
import { DynamoPerformanceStore } from './performance-store.js';
import { AthenaAnalyticsStore, type AnalyticsRange } from './analytics-store.js';
import { assertPublicHttpUrl } from './url-safety.js';
import {
  EventBridgeRecurringCheckScheduler,
  type RecurringCheckScheduler,
} from './recurring-check-scheduler.js';

let configuredStore: EndpointRepository | undefined;
let configuredTaskStarter: CheckTaskStarter | undefined;
let configuredRecurringScheduler: RecurringCheckScheduler | undefined;
let configuredPerformanceStore: DynamoPerformanceStore | undefined;
let configuredPageSpeedClient: PageSpeedClient | undefined;
let configuredAnalyticsStore: AthenaAnalyticsStore | undefined;

export interface PerformanceAnalyzer {
  analyze(endpointId: string, url: string): Promise<PerformanceResult>;
}

export interface PerformanceRepository {
  save(result: PerformanceResult): Promise<void>;
  list(endpointId: string): Promise<PerformanceResult[]>;
}

export interface AnalyticsRepository {
  overview(range: AnalyticsRange): Promise<AnalyticsOverview>;
}

export type PublicUrlValidator = (url: string) => Promise<void>;

async function validateEndpointUrl(url: string, validator: PublicUrlValidator): Promise<void> {
  try {
    await validator(url);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : 'URL is not safe to monitor.');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

function requiredEnvironmentList(name: string): string[] {
  const values = requiredEnvironment(name).split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value.`);
  }

  return values;
}

function getConfiguredStore(): EndpointRepository {
  if (configuredStore) {
    return configuredStore;
  }

  configuredStore = new DynamoEndpointStore({ tableName: requiredEnvironment('MONITORS_TABLE_NAME') });
  return configuredStore;
}

function getConfiguredTaskStarter(): CheckTaskStarter {
  if (configuredTaskStarter) {
    return configuredTaskStarter;
  }

  configuredTaskStarter = new EcsCheckTaskStarter({
    cluster: requiredEnvironment('ECS_CLUSTER'),
    taskDefinition: requiredEnvironment('ECS_TASK_DEFINITION'),
    subnets: requiredEnvironmentList('ECS_SUBNET_IDS'),
    securityGroups: requiredEnvironmentList('ECS_SECURITY_GROUP_IDS'),
    containerName: process.env.ECS_CONTAINER_NAME?.trim() || 'monitor-worker',
    assignPublicIp: process.env.ECS_ASSIGN_PUBLIC_IP?.trim().toLowerCase() !== 'false',
  });
  return configuredTaskStarter;
}

function getConfiguredRecurringScheduler(): RecurringCheckScheduler {
  if (configuredRecurringScheduler) {
    return configuredRecurringScheduler;
  }

  configuredRecurringScheduler = new EventBridgeRecurringCheckScheduler({
    clusterArn: requiredEnvironment('ECS_CLUSTER_ARN'),
    taskDefinitionArn: requiredEnvironment('ECS_TASK_DEFINITION_ARN'),
    roleArn: requiredEnvironment('SCHEDULER_EXECUTION_ROLE_ARN'),
    subnets: requiredEnvironmentList('ECS_SUBNET_IDS'),
    securityGroups: requiredEnvironmentList('ECS_SECURITY_GROUP_IDS'),
    containerName: process.env.ECS_CONTAINER_NAME?.trim() || 'monitor-worker',
    assignPublicIp: process.env.ECS_ASSIGN_PUBLIC_IP?.trim().toLowerCase() !== 'false',
    groupName: process.env.SCHEDULER_GROUP_NAME?.trim() || 'default',
  });
  return configuredRecurringScheduler;
}

function getConfiguredPerformanceStore(): DynamoPerformanceStore {
  if (configuredPerformanceStore) return configuredPerformanceStore;
  configuredPerformanceStore = new DynamoPerformanceStore({ tableName: requiredEnvironment('PERFORMANCE_TABLE_NAME') });
  return configuredPerformanceStore;
}

function getConfiguredPageSpeedClient(): PageSpeedClient {
  if (configuredPageSpeedClient) return configuredPageSpeedClient;
  configuredPageSpeedClient = new PageSpeedClient({ apiKey: process.env.PAGESPEED_API_KEY?.trim() || undefined });
  return configuredPageSpeedClient;
}

function getConfiguredAnalyticsStore(): AthenaAnalyticsStore {
  if (configuredAnalyticsStore) return configuredAnalyticsStore;
  configuredAnalyticsStore = new AthenaAnalyticsStore({
    database: requiredEnvironment('ATHENA_DATABASE'),
    checksTable: requiredEnvironment('ATHENA_CHECKS_TABLE'),
    outputLocation: requiredEnvironment('ATHENA_OUTPUT_LOCATION'),
    incidentsTable: process.env.INCIDENTS_TABLE_NAME?.trim() || 'CloudSentinelIncidents',
  });
  return configuredAnalyticsStore;
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event: Parameters<APIGatewayProxyHandlerV2>[0]): unknown {
  const body = event.body ?? '{}';
  if (body.length > 16_384) {
    throw new ValidationError('Request body must be 16 KB or smaller.');
  }
  return JSON.parse(body);
}

export function createHandler(
  getStore: () => EndpointRepository,
  getTaskStarter: () => CheckTaskStarter = getConfiguredTaskStarter,
  getRecurringScheduler: () => RecurringCheckScheduler = getConfiguredRecurringScheduler,
  getPerformanceAnalyzer: () => PerformanceAnalyzer = getConfiguredPageSpeedClient,
  getPerformanceRepository: () => PerformanceRepository = getConfiguredPerformanceStore,
  getAnalyticsRepository: () => AnalyticsRepository = getConfiguredAnalyticsStore,
  validatePublicUrl: PublicUrlValidator = assertPublicHttpUrl,
): APIGatewayProxyHandlerV2 {
  return async (event) => {
  const routeKey = event.routeKey;

  if (routeKey === 'GET /v1/health') {
      return json(200, { status: 'ok', phase: 5 });
  }

    try {
      if (routeKey === 'GET /v1/endpoints') {
        return json(200, { items: await getStore().list() });
      }

      if (routeKey === 'POST /v1/endpoints') {
        const input = parseJsonBody(event) as CreateEndpointInput;
        await validateEndpointUrl(input.url, validatePublicUrl);
        const endpoint = await getStore().create(input);

        try {
          await getRecurringScheduler().upsert(endpoint);
        } catch (error) {
          await getStore().delete(endpoint.id).catch((rollbackError: unknown) => {
            console.error('Could not roll back endpoint after schedule creation failed', rollbackError);
          });
          throw error;
        }

        return json(201, endpoint);
      }

      if (routeKey === 'PATCH /v1/endpoints/{id}') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) {
          throw new ValidationError('Endpoint ID is required.');
        }

        const input = parseJsonBody(event) as UpdateEndpointInput;
        if (input.url !== undefined) await validateEndpointUrl(input.url, validatePublicUrl);
        const endpoint = await getStore().update(endpointId, input);
        if (!endpoint) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }

        await getRecurringScheduler().upsert(endpoint);
        return json(200, endpoint);
      }

      if (routeKey === 'DELETE /v1/endpoints/{id}') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) {
          throw new ValidationError('Endpoint ID is required.');
        }

        const endpoint = await getStore().get(endpointId);
        if (!endpoint) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }

        await getRecurringScheduler().remove(endpointId);
        await getStore().delete(endpointId);
        return json(200, { id: endpointId, status: 'DELETED' });
      }

      if (routeKey === 'POST /v1/endpoints/{id}/checks') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) {
          throw new ValidationError('Endpoint ID is required.');
        }

        const endpoint = await getStore().get(endpointId);
        if (!endpoint) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }

        return json(202, await getTaskStarter().start(endpoint));
      }

      if (routeKey === 'POST /v1/endpoints/{id}/performance') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) throw new ValidationError('Endpoint ID is required.');
        const endpoint = await getStore().get(endpointId);
        if (!endpoint) return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        const result = await getPerformanceAnalyzer().analyze(endpoint.id, endpoint.url);
        await getPerformanceRepository().save(result);
        return json(201, result);
      }

      if (routeKey === 'GET /v1/endpoints/{id}/performance') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) throw new ValidationError('Endpoint ID is required.');
        if (!await getStore().get(endpointId)) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }
        return json(200, { items: await getPerformanceRepository().list(endpointId) });
      }

      if (routeKey === 'GET /v1/analytics/overview') {
        const now = new Date();
        const from = event.queryStringParameters?.from ?? new Date(now.getTime() - 86_400_000).toISOString();
        const to = event.queryStringParameters?.to ?? now.toISOString();
        return json(200, await getAnalyticsRepository().overview({ from, to }));
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return json(400, { error: { code: 'VALIDATION_ERROR', message: error.message } });
      }

      if (error instanceof SyntaxError) {
        return json(400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
      }

      console.error('Unhandled API error', error);
      return json(500, { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
    }

    return json(404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  };
}

export const handler = createHandler(
  getConfiguredStore,
  getConfiguredTaskStarter,
  getConfiguredRecurringScheduler,
);
