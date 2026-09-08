import { AthenaClient, GetQueryExecutionCommand, GetQueryResultsCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import { AthenaAnalyticsStore } from './analytics-store.js';

describe('AthenaAnalyticsStore', () => {
  it('runs the checks query, counts incidents, and calculates overview values', async () => {
    const athenaSend = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'query-123' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [
        { Data: [{ VarCharValue: 'total_checks' }] },
        { Data: [
          { VarCharValue: '4' },
          { VarCharValue: '3' },
          { VarCharValue: '1' },
          { VarCharValue: '120.5' },
        ] },
      ] } });
    const documentSend = vi.fn().mockResolvedValue({ Count: 2 });
    const store = new AthenaAnalyticsStore({
      database: 'cloudsentinel',
      checksTable: 'checks',
      outputLocation: 's3://cloudsentinel-results/athena/',
      incidentsTable: 'CloudSentinelIncidents',
      athenaClient: { send: athenaSend } as unknown as AthenaClient,
      documentClient: { send: documentSend } as unknown as DynamoDBDocumentClient,
      waitMilliseconds: 0,
      maxWaitMilliseconds: 100,
    });

    await expect(store.overview({
      from: '2026-09-07T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
    })).resolves.toEqual({
      from: '2026-09-07T00:00:00.000Z',
      to: '2026-09-08T00:00:00.000Z',
      totalChecks: 4,
      upChecks: 3,
      downChecks: 1,
      uptimePercent: 75,
      averageResponseTimeMs: 120.5,
      incidentCount: 2,
    });

    expect(athenaSend.mock.calls[0]?.[0]).toBeInstanceOf(StartQueryExecutionCommand);
    expect(athenaSend.mock.calls[0]?.[0].input).toMatchObject({
      QueryExecutionContext: { Database: 'cloudsentinel' },
      ResultConfiguration: { OutputLocation: 's3://cloudsentinel-results/athena/' },
    });
    expect(athenaSend.mock.calls[0]?.[0].input.QueryString).toContain("checkedat");
    expect(athenaSend.mock.calls[1]?.[0]).toBeInstanceOf(GetQueryExecutionCommand);
    expect(athenaSend.mock.calls[2]?.[0]).toBeInstanceOf(GetQueryResultsCommand);
    expect(documentSend.mock.calls[0]?.[0]).toBeInstanceOf(ScanCommand);
  });

  it('rejects an inverted date range before calling AWS', async () => {
    const athenaSend = vi.fn();
    const store = new AthenaAnalyticsStore({
      database: 'cloudsentinel',
      checksTable: 'checks',
      outputLocation: 's3://cloudsentinel-results/athena/',
      incidentsTable: 'CloudSentinelIncidents',
      athenaClient: { send: athenaSend } as unknown as AthenaClient,
      documentClient: { send: vi.fn() } as unknown as DynamoDBDocumentClient,
    });

    await expect(store.overview({
      from: '2026-09-08T00:00:00.000Z',
      to: '2026-09-07T00:00:00.000Z',
    })).rejects.toThrow('Analytics range must end after it starts.');
    expect(athenaSend).not.toHaveBeenCalled();
  });
});
