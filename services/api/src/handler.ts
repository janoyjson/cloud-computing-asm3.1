import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { CreateEndpointInput } from '@cloudsentinel/shared';

import { EcsCheckTaskStarter, type CheckTaskStarter } from './check-task-starter.js';
import { DynamoEndpointStore } from './dynamodb-endpoint-store.js';
import { ValidationError, type EndpointRepository } from './endpoint-store.js';

let configuredStore: EndpointRepository | undefined;
let configuredTaskStarter: CheckTaskStarter | undefined;

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

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  };
}

export function createHandler(
  getStore: () => EndpointRepository,
  getTaskStarter: () => CheckTaskStarter = getConfiguredTaskStarter,
): APIGatewayProxyHandlerV2 {
  return async (event) => {
  const routeKey = event.routeKey;

  if (routeKey === 'GET /v1/health') {
      return json(200, { status: 'ok', phase: 3 });
  }

    try {
      if (routeKey === 'GET /v1/endpoints') {
        return json(200, { items: await getStore().list() });
      }

      if (routeKey === 'POST /v1/endpoints') {
        const input = JSON.parse(event.body ?? '{}') as CreateEndpointInput;
        return json(201, await getStore().create(input));
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

export const handler = createHandler(getConfiguredStore, getConfiguredTaskStarter);
