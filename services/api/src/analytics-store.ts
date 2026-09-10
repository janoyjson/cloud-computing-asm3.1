import { AthenaClient, GetQueryExecutionCommand, GetQueryResultsCommand, StartQueryExecutionCommand } from '@aws-sdk/client-athena';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

import type { AnalyticsOverview } from '@cloudsentinel/shared';

export interface AnalyticsRange {
  from: string;
  to: string;
}

interface AnalyticsStoreOptions {
  database: string;
  checksTable: string;
  outputLocation: string;
  incidentsTable: string;
  athenaClient?: AthenaClient;
  documentClient?: DynamoDBDocumentClient;
  waitMilliseconds?: number;
  maxWaitMilliseconds?: number;
}

interface AthenaMetricRow {
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  averageResponseTimeMs: number | null;
}

function sqlIdentifier(value: string): string {
  return value.replaceAll('"', '');
}

function sqlTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Analytics range must use valid ISO timestamps.');
  }
  return parsed.toISOString();
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetrics(values: readonly (string | undefined)[]): AthenaMetricRow {
  return {
    totalChecks: numberValue(values[0]),
    upChecks: numberValue(values[1]),
    downChecks: numberValue(values[2]),
    averageResponseTimeMs: values[3] === undefined || values[3] === 'null' ? null : numberValue(values[3]),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AthenaAnalyticsStore {
  readonly #database: string;
  readonly #checksTable: string;
  readonly #outputLocation: string;
  readonly #incidentsTable: string;
  readonly #athena: AthenaClient;
  readonly #document: DynamoDBDocumentClient;
  readonly #waitMilliseconds: number;
  readonly #maxWaitMilliseconds: number;

  public constructor(options: AnalyticsStoreOptions) {
    this.#database = sqlIdentifier(options.database);
    this.#checksTable = sqlIdentifier(options.checksTable);
    this.#outputLocation = options.outputLocation;
    this.#incidentsTable = options.incidentsTable;
    this.#athena = options.athenaClient ?? new AthenaClient({});
    this.#document = options.documentClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.#waitMilliseconds = options.waitMilliseconds ?? 500;
    this.#maxWaitMilliseconds = options.maxWaitMilliseconds ?? 20_000;
  }

  public async overview(range: AnalyticsRange, endpointIds?: readonly string[]): Promise<AnalyticsOverview> {
    const from = sqlTimestamp(range.from);
    const to = sqlTimestamp(range.to);
    if (new Date(from) >= new Date(to)) {
      throw new Error('Analytics range must end after it starts.');
    }

    if (endpointIds && endpointIds.length === 0) {
      return { from, to, totalChecks: 0, upChecks: 0, downChecks: 0, uptimePercent: null, averageResponseTimeMs: null, incidentCount: 0 };
    }

    const endpointFilter = endpointIds
      ? ` AND endpointid IN (${endpointIds.map((endpointId) => `'${endpointId.replaceAll("'", "''")}'`).join(', ')})`
      : '';
    const queryExecution = await this.#athena.send(new StartQueryExecutionCommand({
      QueryString: `SELECT count(*) AS total_checks,\n` +
        `coalesce(sum(CASE WHEN state = 'UP' THEN 1 ELSE 0 END), 0) AS up_checks,\n` +
        `coalesce(sum(CASE WHEN state = 'DOWN' THEN 1 ELSE 0 END), 0) AS down_checks,\n` +
        `avg(try_cast(responsetimems AS double)) AS average_response_time_ms\n` +
        `FROM "${this.#database}"."${this.#checksTable}"\n` +
        `WHERE from_iso8601_timestamp(checkedat) BETWEEN from_iso8601_timestamp('${from}') AND from_iso8601_timestamp('${to}')` + endpointFilter,
      QueryExecutionContext: { Database: this.#database },
      ResultConfiguration: { OutputLocation: this.#outputLocation },
    }));
    const queryId = queryExecution.QueryExecutionId;
    if (!queryId) throw new Error('Athena did not return a query execution ID.');

    const metrics = await this.#waitForMetrics(queryId);
    const incidentCount = await this.#countIncidents(from, to, endpointIds);
    return {
      from,
      to,
      ...metrics,
      uptimePercent: metrics.totalChecks === 0
        ? null
        : Number(((metrics.upChecks / metrics.totalChecks) * 100).toFixed(2)),
      incidentCount,
    };
  }

  async #waitForMetrics(queryId: string): Promise<AthenaMetricRow> {
    const deadline = Date.now() + this.#maxWaitMilliseconds;
    while (Date.now() <= deadline) {
      const execution = await this.#athena.send(new GetQueryExecutionCommand({ QueryExecutionId: queryId }));
      const state = execution.QueryExecution?.Status?.State;
      if (state === 'SUCCEEDED') {
        const results = await this.#athena.send(new GetQueryResultsCommand({ QueryExecutionId: queryId }));
        const row = results.ResultSet?.Rows?.[1];
        return parseMetrics((row?.Data ?? []).map((cell) => cell.VarCharValue));
      }
      if (state === 'FAILED' || state === 'CANCELLED') {
        throw new Error(`Athena query ${state.toLowerCase()}.`);
      }
      await sleep(this.#waitMilliseconds);
    }
    throw new Error('Athena query timed out.');
  }

  async #countIncidents(from: string, to: string, endpointIds?: readonly string[]): Promise<number> {
    let count = 0;
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await this.#document.send(new ScanCommand({
        TableName: this.#incidentsTable,
        FilterExpression: '#openedAt BETWEEN :from AND :to' + (endpointIds ? ' AND #endpointId IN (' + endpointIds.map((_, index) => `:endpointId${index}`).join(', ') + ')' : ''),
        ExpressionAttributeNames: {
          '#openedAt': 'openedAt',
          ...(endpointIds ? { '#endpointId': 'endpointId' } : {}),
        },
        ExpressionAttributeValues: {
          ':from': from,
          ':to': to,
          ...(endpointIds ? Object.fromEntries(endpointIds.map((endpointId, index) => [`:endpointId${index}`, endpointId])) : {}),
        },
        ProjectionExpression: 'openedAt',
        ExclusiveStartKey: exclusiveStartKey,
      }));
      count += response.Count ?? 0;
      exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
    return count;
  }
}
