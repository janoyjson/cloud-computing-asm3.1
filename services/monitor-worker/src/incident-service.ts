import type { CheckResult } from '@cloudsentinel/shared';

import type { IncidentNotifier } from './discord-notifier.js';
import type { IncidentRepository, NotificationKind } from './incident-store.js';
import { getIncidentTransition } from './incident-transition.js';

interface IncidentServiceOptions {
  repository: IncidentRepository;
  notifier: IncidentNotifier;
  now?: () => Date;
}

interface ProcessCheckInput {
  previousCheck?: CheckResult;
  currentCheck: CheckResult;
  endpointName: string;
  endpointUrl: string;
}

export class IncidentService {
  readonly #repository: IncidentRepository;
  readonly #notifier: IncidentNotifier;
  readonly #now: () => Date;

  public constructor(options: IncidentServiceOptions) {
    this.#repository = options.repository;
    this.#notifier = options.notifier;
    this.#now = options.now ?? (() => new Date());
  }

  public async process(input: ProcessCheckInput): Promise<void> {
    const transition = getIncidentTransition(input.previousCheck, input.currentCheck);
    if (transition === 'NONE') {
      return;
    }

    const kind: NotificationKind = transition === 'OPEN' ? 'OUTAGE' : 'RECOVERY';
    const incident = transition === 'OPEN'
      ? await this.#repository.open(input.currentCheck)
      : await this.#repository.recover(input.currentCheck);
    if (!incident) {
      return;
    }

    try {
      await this.#notifier.send({
        kind,
        incident,
        check: input.currentCheck,
        endpointName: input.endpointName,
        endpointUrl: input.endpointUrl,
      });
      await this.#repository.recordNotification(incident, kind, {
        status: 'SENT',
        occurredAt: this.#now().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown notification error';
      console.error(`CloudSentinel ${kind.toLowerCase()} notification failed: ${message}`);
      await this.#repository.recordNotification(incident, kind, {
        status: 'FAILED',
        occurredAt: this.#now().toISOString(),
        error: message,
      });
    }
  }
}
