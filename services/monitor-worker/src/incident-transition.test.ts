import { describe, expect, it } from 'vitest';

import type { CheckResult } from '@cloudsentinel/shared';

import { getIncidentTransition } from './incident-transition.js';

function check(state: CheckResult['state'], checkedAt: string): CheckResult {
  return {
    endpointId: 'endpoint-123',
    checkedAt,
    state,
    source: 'SCHEDULED',
    responseTimeMs: 100,
    statusCode: state === 'UP' ? 200 : 503,
  };
}

describe('getIncidentTransition', () => {
  it('opens an incident for the first observed failure', () => {
    expect(getIncidentTransition(undefined, check('DOWN', '2026-09-07T14:10:00.000Z'))).toBe('OPEN');
    expect(getIncidentTransition(
      check('UP', '2026-09-07T14:05:00.000Z'),
      check('DOWN', '2026-09-07T14:10:00.000Z'),
    )).toBe('OPEN');
  });

  it('does not duplicate an incident for repeated failures', () => {
    expect(getIncidentTransition(
      check('DOWN', '2026-09-07T14:05:00.000Z'),
      check('DOWN', '2026-09-07T14:10:00.000Z'),
    )).toBe('NONE');
  });

  it('recovers an incident when the endpoint becomes available', () => {
    expect(getIncidentTransition(
      check('DOWN', '2026-09-07T14:05:00.000Z'),
      check('UP', '2026-09-07T14:10:00.000Z'),
    )).toBe('RECOVER');
  });

  it('does nothing while an endpoint remains available', () => {
    expect(getIncidentTransition(
      check('UP', '2026-09-07T14:05:00.000Z'),
      check('UP', '2026-09-07T14:10:00.000Z'),
    )).toBe('NONE');
  });
});
