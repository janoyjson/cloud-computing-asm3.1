import { describe, expect, it, vi } from 'vitest';

import type { CheckResult, Incident } from '@cloudsentinel/shared';

import type { IncidentNotifier } from './discord-notifier.js';
import { IncidentService } from './incident-service.js';
import type { IncidentRepository } from './incident-store.js';

const downCheck: CheckResult = {
  endpointId: 'endpoint-123',
  checkedAt: '2026-09-07T14:10:00.000Z',
  state: 'DOWN',
  source: 'SCHEDULED',
  responseTimeMs: 250,
  statusCode: 503,
};
const openIncident: Incident = {
  id: 'incident-123',
  endpointId: 'endpoint-123',
  openedAt: downCheck.checkedAt,
  status: 'OPEN',
  openingCheckId: `endpoint-123#${downCheck.checkedAt}`,
  outageNotificationStatus: 'PENDING',
};

function dependencies(send = vi.fn().mockResolvedValue(undefined)) {
  const open = vi.fn().mockResolvedValue(openIncident);
  const recover = vi.fn().mockResolvedValue({
    ...openIncident,
    status: 'RESOLVED',
    recoveredAt: '2026-09-07T14:15:00.000Z',
    recoveryNotificationStatus: 'PENDING',
  });
  const recordNotification = vi.fn().mockResolvedValue(undefined);
  const repository = { open, recover, recordNotification } satisfies IncidentRepository;
  const notifier = { send } satisfies IncidentNotifier;
  const service = new IncidentService({
    repository,
    notifier,
    now: () => new Date('2026-09-07T14:11:00.000Z'),
  });
  return { service, open, recover, recordNotification, send };
}

describe('IncidentService', () => {
  it('opens and sends one outage notification on the first failure', async () => {
    const subject = dependencies();

    await subject.service.process({
      currentCheck: downCheck,
      endpointName: 'Production API',
      endpointUrl: 'https://example.com/health',
    });

    expect(subject.open).toHaveBeenCalledWith(downCheck);
    expect(subject.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'OUTAGE' }));
    expect(subject.recordNotification).toHaveBeenCalledWith(openIncident, 'OUTAGE', {
      status: 'SENT',
      occurredAt: '2026-09-07T14:11:00.000Z',
    });
  });

  it('suppresses incident and notification duplication for repeated failures', async () => {
    const subject = dependencies();

    await subject.service.process({
      previousCheck: { ...downCheck, checkedAt: '2026-09-07T14:05:00.000Z' },
      currentCheck: downCheck,
      endpointName: 'Production API',
      endpointUrl: 'https://example.com/health',
    });

    expect(subject.open).not.toHaveBeenCalled();
    expect(subject.send).not.toHaveBeenCalled();
  });

  it('resolves and announces recovery after a failure', async () => {
    const subject = dependencies();
    const upCheck = { ...downCheck, checkedAt: '2026-09-07T14:15:00.000Z', state: 'UP' as const, statusCode: 200 };

    await subject.service.process({
      previousCheck: downCheck,
      currentCheck: upCheck,
      endpointName: 'Production API',
      endpointUrl: 'https://example.com/health',
    });

    expect(subject.recover).toHaveBeenCalledWith(upCheck);
    expect(subject.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'RECOVERY' }));
  });

  it('records webhook errors without losing the completed check', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const subject = dependencies(vi.fn().mockRejectedValue(new Error('HTTP 500')));

    await expect(subject.service.process({
      currentCheck: downCheck,
      endpointName: 'Production API',
      endpointUrl: 'https://example.com/health',
    })).resolves.toBeUndefined();

    expect(subject.recordNotification).toHaveBeenCalledWith(openIncident, 'OUTAGE', {
      status: 'FAILED',
      occurredAt: '2026-09-07T14:11:00.000Z',
      error: 'HTTP 500',
    });
    consoleError.mockRestore();
  });
});
