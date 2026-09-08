export const monitoringIntervals = [5, 15, 30, 60] as const;

export type MonitoringIntervalMinutes = (typeof monitoringIntervals)[number];
export type MonitorState = 'UP' | 'DOWN' | 'UNKNOWN';
export type CheckSource = 'MANUAL' | 'SCHEDULED';

export interface CheckResult {
  endpointId: string;
  checkedAt: string;
  state: Exclude<MonitorState, 'UNKNOWN'>;
  source: CheckSource;
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
}

export interface MonitoredEndpoint {
  id: string;
  name: string;
  url: string;
  intervalMinutes: MonitoringIntervalMinutes;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  latestCheck?: CheckResult;
}

export interface CreateEndpointInput {
  name: string;
  url: string;
  intervalMinutes: MonitoringIntervalMinutes;
}

export interface UpdateEndpointInput {
  name?: string;
  url?: string;
  intervalMinutes?: MonitoringIntervalMinutes;
  enabled?: boolean;
}

export interface Incident {
  id: string;
  endpointId: string;
  openedAt: string;
  recoveredAt?: string;
  status: 'OPEN' | 'RESOLVED';
  openingCheckId: string;
  recoveryCheckId?: string;
  outageNotificationStatus: 'PENDING' | 'SENT' | 'FAILED';
  outageNotifiedAt?: string;
  outageNotificationError?: string;
  recoveryNotificationStatus?: 'PENDING' | 'SENT' | 'FAILED';
  recoveryNotifiedAt?: string;
  recoveryNotificationError?: string;
}

export interface PerformanceResult {
  endpointId: string;
  measuredAt: string;
  strategy: 'MOBILE';
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
  cumulativeLayoutShift?: number;
}

export function getEndpointState(endpoint: MonitoredEndpoint): MonitorState {
  return endpoint.latestCheck?.state ?? 'UNKNOWN';
}

export function calculateUptimePercent(results: readonly CheckResult[]): number | null {
  if (results.length === 0) {
    return null;
  }

  const successfulChecks = results.filter((result) => result.state === 'UP').length;
  return Number(((successfulChecks / results.length) * 100).toFixed(2));
}

export function isMonitoringInterval(value: number): value is MonitoringIntervalMinutes {
  return monitoringIntervals.some((interval) => interval === value);
}

