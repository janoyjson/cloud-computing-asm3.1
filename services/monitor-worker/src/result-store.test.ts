import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import { AwsResultStore } from './result-store.js';

describe('AwsResultStore', () => {
  it('stores the check, updates latest state, and archives partitioned JSON', async () => {
    const previousCheck = {
      endpointId: 'endpoint-1',
      checkedAt: '2026-09-02T11:17:33.000Z',
      state: 'DOWN' as const,
      source: 'SCHEDULED' as const,
      responseTimeMs: 1000,
      statusCode: 503,
    };
    const documentSend = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Attributes: {
          id: 'endpoint-1',
          name: 'Client API',
          url: 'https://example.com/health',
          latestCheck: previousCheck,
        },
      });
    const s3Send = vi.fn().mockResolvedValue({});
    const store = new AwsResultStore({
      monitorsTableName: 'CloudSentinelMonitors',
      checksTableName: 'CloudSentinelChecks',
      resultsBucketName: 'cloudsentinel-results-test',
      documentClient: { send: documentSend } as unknown as DynamoDBDocumentClient,
      s3Client: { send: s3Send } as unknown as S3Client,
    });
    const result = {
      endpointId: 'endpoint-1',
      checkedAt: '2026-09-02T11:22:33.000Z',
      state: 'UP' as const,
      source: 'MANUAL' as const,
      responseTimeMs: 125,
      statusCode: 200,
    };

    const context = await store.save(result);

    expect(documentSend.mock.calls[0]?.[0]).toBeInstanceOf(PutCommand);
    expect(documentSend.mock.calls[1]?.[0]).toBeInstanceOf(UpdateCommand);
    expect(documentSend.mock.calls[1]?.[0].input.ReturnValues).toBe('ALL_OLD');
    expect(s3Send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(s3Send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: 'cloudsentinel-results-test',
      Key: 'checks/year=2026/month=09/day=02/endpointId=endpoint-1/2026-09-02T11-22-33.000Z.json',
      ContentType: 'application/json',
    });
    expect(context).toEqual({
      previousCheck,
      endpointName: 'Client API',
      endpointUrl: 'https://example.com/health',
    });
  });
});
