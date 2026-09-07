import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { CreateEndpointInput } from '@cloudsentinel/shared';

import { DynamoEndpointStore } from './dynamodb-endpoint-store.js';
import { ValidationError, type EndpointRepository } from './endpoint-store.js';

let configuredStore: EndpointRepository | undefined;

function getConfiguredStore(): EndpointRepository {
  if (configuredStore) {
    return configuredStore;
  }

  const tableName = process.env.MONITORS_TABLE_NAME;
  if (!tableName) {
    throw new Error('MONITORS_TABLE_NAME environment variable is required.');
  }

  configuredStore = new DynamoEndpointStore({ tableName });
  return configuredStore;
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

export function createHandler(getStore: () => EndpointRepository): APIGatewayProxyHandlerV2 {
  return async (event) => {
  const routeKey = event.routeKey;

  if (routeKey === 'GET /v1/health') {
      return json(200, { status: 'ok', phase: 2 });
  }

    try {
      if (routeKey === 'GET /v1/endpoints') {
        return json(200, { items: await getStore().list() });
      }

      if (routeKey === 'POST /v1/endpoints') {
        const input = JSON.parse(event.body ?? '{}') as CreateEndpointInput;
        return json(201, await getStore().create(input));
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

export const handler = createHandler(getConfiguredStore);
