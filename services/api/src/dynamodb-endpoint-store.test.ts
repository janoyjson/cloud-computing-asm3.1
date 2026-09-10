import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
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

  it('gets an endpoint by ID', async () => {
    const endpoint = { id: 'endpoint-123', name: 'Status page' };
    const send = vi.fn().mockResolvedValue({ Item: endpoint });
    const store = new DynamoEndpointStore({
      tableName: 'CloudSentinelMonitors',
      client: { send } as unknown as DynamoDBDocumentClient,
    });

    await expect(store.get('endpoint-123')).resolves.toEqual(endpoint);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetCommand);
    expect(command.input).toEqual({
      TableName: 'CloudSentinelMonitors',
      Key: { id: 'endpoint-123' },
    });
  });

  it('finds an owner endpoint even when it is not the first GSI result', async () => {
    const target = { id: 'endpoint-123', ownerId: 'user-1', name: 'Target' };
    const send = vi.fn().mockResolvedValue({ Items: [{ id: 'other', ownerId: 'user-1' }, target] });
    const store = new DynamoEndpointStore({
      tableName: 'CloudSentinelMonitors',
      client: { send } as unknown as DynamoDBDocumentClient,
    });

    await expect(store.get('endpoint-123', 'user-1')).resolves.toEqual(target);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0]?.[0].input.Limit).toBeUndefined();
  });

  it('updates mutable endpoint fields without replacing worker-owned state', async () => {
    const existing = {
      id: 'endpoint-123',
      name: 'Status page',
      url: 'https://example.com/status',
      intervalMinutes: 15 as const,
      enabled: true,
      createdAt: '2026-09-02T01:30:00.000Z',
      updatedAt: '2026-09-02T01:30:00.000Z',
    };
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: existing })
      .mockResolvedValueOnce({ Attributes: { ...existing, intervalMinutes: 30, enabled: false } });
    const store = new DynamoEndpointStore({
      tableName: 'CloudSentinelMonitors',
      client: { send } as unknown as DynamoDBDocumentClient,
      now: () => new Date('2026-09-07T09:00:00.000Z'),
    });

    const updated = await store.update('endpoint-123', { intervalMinutes: 30, enabled: false });

    expect(updated).toMatchObject({ intervalMinutes: 30, enabled: false });
    const command = send.mock.calls[1]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input.UpdateExpression).not.toContain('latestCheck');
    expect(command.input).toMatchObject({
      TableName: 'CloudSentinelMonitors',
      Key: { id: 'endpoint-123' },
      ConditionExpression: 'attribute_exists(id)',
    });
  });

  it('deletes an endpoint and reports whether it existed', async () => {
    const send = vi.fn().mockResolvedValue({ Attributes: { id: 'endpoint-123' } });
    const store = new DynamoEndpointStore({
      tableName: 'CloudSentinelMonitors',
      client: { send } as unknown as DynamoDBDocumentClient,
    });

    await expect(store.delete('endpoint-123')).resolves.toBe(true);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteCommand);
    expect(command.input).toEqual({
      TableName: 'CloudSentinelMonitors',
      Key: { id: 'endpoint-123' },
      ReturnValues: 'ALL_OLD',
    });
  });
});
