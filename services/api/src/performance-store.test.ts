import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import { DynamoPerformanceStore } from './performance-store.js';

const result = {
  endpointId: 'endpoint-1',
  measuredAt: '2026-09-08T00:00:00.000Z',
  strategy: 'MOBILE' as const,
  performanceScore: 91,
  accessibilityScore: 88,
  bestPracticesScore: 77,
  seoScore: 100,
};

describe('DynamoPerformanceStore', () => {
  it('writes a performance result with the composite key', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoPerformanceStore({
      tableName: 'CloudSentinelPerformance',
      client: { send } as unknown as DynamoDBDocumentClient,
    });

    await store.save(result);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      TableName: 'CloudSentinelPerformance',
      Item: result,
      ConditionExpression: 'attribute_not_exists(endpointId) AND attribute_not_exists(measuredAt)',
    });
  });

  it('lists newest performance results first', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [result] });
    const store = new DynamoPerformanceStore({
      tableName: 'CloudSentinelPerformance',
      client: { send } as unknown as DynamoDBDocumentClient,
    });

    await expect(store.list('endpoint-1', 10)).resolves.toEqual([result]);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      TableName: 'CloudSentinelPerformance',
      KeyConditionExpression: 'endpointId = :endpointId',
      ExpressionAttributeValues: { ':endpointId': 'endpoint-1' },
      ScanIndexForward: false,
      Limit: 10,
    });
  });
});
