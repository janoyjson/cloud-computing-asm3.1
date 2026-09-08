import type { CheckResult } from '@cloudsentinel/shared';

export type IncidentTransition = 'NONE' | 'OPEN' | 'RECOVER';

export function getIncidentTransition(
  previousCheck: CheckResult | undefined,
  currentCheck: CheckResult,
): IncidentTransition {
  if (currentCheck.state === 'DOWN' && previousCheck?.state !== 'DOWN') {
    return 'OPEN';
  }

  if (currentCheck.state === 'UP' && previousCheck?.state === 'DOWN') {
    return 'RECOVER';
  }

  return 'NONE';
}
