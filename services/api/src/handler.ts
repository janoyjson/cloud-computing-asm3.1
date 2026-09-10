import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { discordWebhookSecretId, type AnalyticsOverview, type CreateEndpointInput, type PerformanceResult, type UpdateEndpointInput } from '@cloudsentinel/shared';

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
import { DynamoIncidentStore, type IncidentRepository } from './incident-store.js';
import { hashPassword, issueJwt, normalizeEmail, publicUser, verifyJwt, verifyPassword, type AuthPrincipal } from './auth.js';
import { DynamoUserStore, UserAlreadyExistsError, type UserRepository } from './user-store.js';
import { SecretsManagerDiscordWebhookStore, type DiscordWebhookStore } from './discord-webhook-store.js';

let configuredStore: EndpointRepository | undefined;
let configuredTaskStarter: CheckTaskStarter | undefined;
let configuredRecurringScheduler: RecurringCheckScheduler | undefined;
let configuredPerformanceStore: DynamoPerformanceStore | undefined;
let configuredPageSpeedClient: PageSpeedClient | undefined;
let configuredAnalyticsStore: AthenaAnalyticsStore | undefined;
let configuredIncidentStore: IncidentRepository | undefined;
let configuredUserStore: UserRepository | undefined;
let configuredDiscordWebhookStore: DiscordWebhookStore | undefined;

export interface PerformanceAnalyzer {
  analyze(endpointId: string, url: string): Promise<PerformanceResult>;
}

export interface PerformanceRepository {
  save(result: PerformanceResult): Promise<void>;
  list(endpointId: string): Promise<PerformanceResult[]>;
}

export interface AnalyticsRepository {
  overview(range: AnalyticsRange, endpointIds?: readonly string[]): Promise<AnalyticsOverview>;
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

function getConfiguredIncidentStore(): IncidentRepository {
  if (configuredIncidentStore) return configuredIncidentStore;
  configuredIncidentStore = new DynamoIncidentStore({ tableName: requiredEnvironment('INCIDENTS_TABLE_NAME') });
  return configuredIncidentStore;
}

function getConfiguredUserStore(): UserRepository {
  if (configuredUserStore) return configuredUserStore;
  configuredUserStore = new DynamoUserStore({ tableName: requiredEnvironment('USERS_TABLE_NAME') });
  return configuredUserStore;
}

function getConfiguredDiscordWebhookStore(): DiscordWebhookStore {
  if (configuredDiscordWebhookStore) return configuredDiscordWebhookStore;
  configuredDiscordWebhookStore = new SecretsManagerDiscordWebhookStore();
  return configuredDiscordWebhookStore;
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

function bearerToken(event: Parameters<APIGatewayProxyHandlerV2>[0]): string | undefined {
  const headers = event.headers ?? {};
  const supplied = headers.authorization ?? headers.Authorization ?? headers['x-cloudsentinel-access-token'];
  if (!supplied) return undefined;
  return supplied.startsWith('Bearer ') ? supplied.slice('Bearer '.length).trim() : supplied.trim();
}

function authenticatedPrincipal(event: Parameters<APIGatewayProxyHandlerV2>[0]): AuthPrincipal | undefined {
  const secret = configuredJwtSecret();
  const token = bearerToken(event);
  return secret && token ? verifyJwt(token, secret) : undefined;
}

function configuredJwtSecret(): string | undefined {
  return process.env.JWT_SECRET?.trim() || process.env.API_ACCESS_TOKEN?.trim();
}

function authSecret(): string {
  const secret = configuredJwtSecret();
  if (!secret) throw new Error('JWT_SECRET environment variable is required.');
  return secret;
}

function credentials(input: unknown): { email: string; password: string } {
  if (typeof input !== 'object' || input === null) throw new ValidationError('Email and password are required.');
  const candidate = input as { email?: unknown; password?: unknown };
  if (typeof candidate.email !== 'string' || !/^\S+@\S+\.\S+$/.test(candidate.email.trim())) {
    throw new ValidationError('A valid email address is required.');
  }
  if (typeof candidate.password !== 'string' || candidate.password.length < 12 || candidate.password.length > 128) {
    throw new ValidationError('Password must contain between 12 and 128 characters.');
  }
  return { email: normalizeEmail(candidate.email), password: candidate.password };
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
  getIncidentRepository: () => IncidentRepository = getConfiguredIncidentStore,
  getUserRepository: () => UserRepository = getConfiguredUserStore,
  getDiscordWebhookStore: () => DiscordWebhookStore = getConfiguredDiscordWebhookStore,
): APIGatewayProxyHandlerV2 {
  return async (event) => {
  const routeKey = event.routeKey;

  if (routeKey === 'GET /v1/health') {
      return json(200, { status: 'ok', phase: 6 });
  }

    const principal = authenticatedPrincipal(event);
    const ownerId = principal?.sub;
    const isAuthRoute = routeKey === 'POST /v1/auth/register' || routeKey === 'POST /v1/auth/login';
    if (!isAuthRoute && configuredJwtSecret() && !principal) {
      return json(401, { error: { code: 'UNAUTHORIZED', message: 'A valid JWT bearer token is required.' } });
    }

    try {
      if (routeKey === 'POST /v1/auth/register') {
        const { email, password } = credentials(parseJsonBody(event));
        const user = await getUserRepository().create(email, hashPassword(password));
        const session = issueJwt(user, authSecret());
        return json(201, { ...session, user: publicUser(user) });
      }

      if (routeKey === 'POST /v1/auth/login') {
        const { email, password } = credentials(parseJsonBody(event));
        const user = await getUserRepository().getByEmail(email);
        if (!user || !verifyPassword(password, user.passwordHash)) {
          return json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
        }
        const session = issueJwt(user, authSecret());
        return json(200, { ...session, user: publicUser(user) });
      }

      if (routeKey === 'GET /v1/auth/me') {
        return principal
          ? json(200, { user: { id: principal.sub, email: principal.email } })
          : json(401, { error: { code: 'UNAUTHORIZED', message: 'A valid JWT bearer token is required.' } });
      }

      if (routeKey === 'GET /v1/settings/discord') {
        if (!ownerId) return json(401, { error: { code: 'UNAUTHORIZED', message: 'A signed-in user is required.' } });
        return json(200, await getDiscordWebhookStore().get(ownerId));
      }

      if (routeKey === 'PUT /v1/settings/discord') {
        if (!ownerId) return json(401, { error: { code: 'UNAUTHORIZED', message: 'A signed-in user is required.' } });
        const input = parseJsonBody(event) as { webhookUrl?: unknown };
        if (typeof input.webhookUrl !== 'string' || !input.webhookUrl.trim()) {
          throw new ValidationError('A Discord webhook URL is required.');
        }

        await getDiscordWebhookStore().set(ownerId, input.webhookUrl);
        const secretId = discordWebhookSecretId(ownerId);
        for (const endpoint of await getStore().list(ownerId)) {
          await getRecurringScheduler().upsert(endpoint, secretId);
        }
        return json(200, { configured: true });
      }

      if (routeKey === 'DELETE /v1/settings/discord') {
        if (!ownerId) return json(401, { error: { code: 'UNAUTHORIZED', message: 'A signed-in user is required.' } });
        await getDiscordWebhookStore().remove(ownerId);
        for (const endpoint of await getStore().list(ownerId)) {
          await getRecurringScheduler().upsert(endpoint, discordWebhookSecretId(ownerId));
        }
        return json(200, { configured: false });
      }

      if (routeKey === 'GET /v1/endpoints') {
        return json(200, { items: await getStore().list(ownerId) });
      }

      if (routeKey === 'POST /v1/endpoints') {
        const input = parseJsonBody(event) as CreateEndpointInput;
        await validateEndpointUrl(input.url, validatePublicUrl);
        const endpoint = await getStore().create(input, ownerId);

        try {
          const secretId = ownerId ? discordWebhookSecretId(ownerId) : undefined;
          if (ownerId) await getRecurringScheduler().upsert(endpoint, secretId);
          else await getRecurringScheduler().upsert(endpoint);
        } catch (error) {
          await getStore().delete(endpoint.id, ownerId).catch((rollbackError: unknown) => {
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
        const existing = await getStore().get(endpointId, ownerId);
        if (!existing) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }
        const endpoint = await getStore().update(endpointId, input, ownerId);
        if (!endpoint) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }

        try {
          const secretId = ownerId ? discordWebhookSecretId(ownerId) : undefined;
          if (ownerId) await getRecurringScheduler().upsert(endpoint, secretId);
          else await getRecurringScheduler().upsert(endpoint);
        } catch (error) {
          await getStore().update(endpointId, {
            name: existing.name,
            url: existing.url,
            intervalMinutes: existing.intervalMinutes,
            enabled: existing.enabled,
          }, ownerId).catch((rollbackError: unknown) => {
            console.error('Could not roll back endpoint after schedule update failed', rollbackError);
          });
          throw error;
        }
        return json(200, endpoint);
      }

      if (routeKey === 'DELETE /v1/endpoints/{id}') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) {
          throw new ValidationError('Endpoint ID is required.');
        }

        const endpoint = await getStore().get(endpointId, ownerId);
        if (!endpoint) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }

        await getRecurringScheduler().remove(endpointId);
        await getStore().delete(endpointId, ownerId);
        return json(200, { id: endpointId, status: 'DELETED' });
      }

      if (routeKey === 'POST /v1/endpoints/{id}/checks') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) {
          throw new ValidationError('Endpoint ID is required.');
        }

        const endpoint = await getStore().get(endpointId, ownerId);
        if (!endpoint) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }

        const secretId = ownerId ? discordWebhookSecretId(ownerId) : undefined;
        return json(202, ownerId
          ? await getTaskStarter().start(endpoint, secretId)
          : await getTaskStarter().start(endpoint));
      }

      if (routeKey === 'POST /v1/endpoints/{id}/performance') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) throw new ValidationError('Endpoint ID is required.');
        const endpoint = await getStore().get(endpointId, ownerId);
        if (!endpoint) return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        const result = await getPerformanceAnalyzer().analyze(endpoint.id, endpoint.url);
        const ownedResult = { ...result, ...(ownerId ? { ownerId } : {}) };
        await getPerformanceRepository().save(ownedResult);
        return json(201, ownedResult);
      }

      if (routeKey === 'GET /v1/endpoints/{id}/performance') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) throw new ValidationError('Endpoint ID is required.');
        if (!await getStore().get(endpointId, ownerId)) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }
        return json(200, { items: await getPerformanceRepository().list(endpointId) });
      }

      if (routeKey === 'GET /v1/endpoints/{id}/incidents') {
        const endpointId = event.pathParameters?.id?.trim();
        if (!endpointId) throw new ValidationError('Endpoint ID is required.');
        if (!await getStore().get(endpointId, ownerId)) {
          return json(404, { error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found.' } });
        }
        return json(200, { items: await getIncidentRepository().list(endpointId) });
      }

      if (routeKey === 'GET /v1/analytics/overview') {
        const now = new Date();
        const from = event.queryStringParameters?.from ?? new Date(now.getTime() - 86_400_000).toISOString();
        const to = event.queryStringParameters?.to ?? now.toISOString();
        const range = { from, to };
        const endpointIds = ownerId ? (await getStore().list(ownerId)).map((endpoint) => endpoint.id) : undefined;
        return json(200, endpointIds
          ? await getAnalyticsRepository().overview(range, endpointIds)
          : await getAnalyticsRepository().overview(range));
      }
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        return json(409, { error: { code: 'USER_ALREADY_EXISTS', message: error.message } });
      }
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
