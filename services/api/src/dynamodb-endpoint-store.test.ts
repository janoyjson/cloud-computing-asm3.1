import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import { DynamoEndpointStore } from './dynamodb-endpoint-store.js';

describe('DynamoEndpointStore', () => {
  it('scans every page and sorts endpoints by name', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({
        Items: [{ id: 'z', name: 'Zulu' }],
        LastEvaluatedKey: { id: 'z' },
      })
      .mockResolvedValueOnce({
        Items: [{ id: 'a', name: 'Alpha' }],
      });
    const store = new DynamoEndpointStore({
      tableName: 'CloudSentinelMonitors',
      client: { send } as unknown as DynamoDBDocumentClient,
    });

    const endpoints = await store.list();

    expect(endpoints.map((endpoint) => endpoint.name)).toEqual(['Alpha', 'Zulu']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ScanCommand);
  });

  it('validates and stores a new endpoint', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoEndpointStore({
      tableName: 'CloudSentinelMonitors',
      client: { send } as unknown as DynamoDBDocumentClient,
      createId: () => 'endpoint-123',
      now: () => new Date('2026-09-02T01:30:00.000Z'),
    });

    const endpoint = await store.create({
      name: ' Status page ',
      url: 'https://example.com/status',
      intervalMinutes: 15,
    });

    expect(endpoint).toMatchObject({ id: 'endpoint-123', name: 'Status page' });
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      TableName: 'CloudSentinelMonitors',
      Item: endpoint,
      ConditionExpression: 'attribute_not_exists(id)',
    });
  });
});
