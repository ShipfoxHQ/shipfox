import {rankTemplatesForLabels} from '#template-selection.js';
import type {ProvisionerTemplate, TemplateCounts} from '#types.js';

/**
 * Free slots the provisioner may still start for a template: its configured
 * concurrency cap minus everything it already has starting or running. Clamped at
 * zero so an over-count (for example a stale report) never advertises negative
 * capacity.
 */
export function templateAvailableSlots(
  template: ProvisionerTemplate,
  counts: TemplateCounts,
): number {
  return Math.max(0, template.maxConcurrency - counts.starting - counts.running);
}

/** One reservation's worth of demand the API has granted to this provisioner. */
export interface ReservationDemand {
  readonly reservationId: string;
  readonly labels: readonly string[];
  readonly count: number;
}

/** A decision to start `count` runners for one reservation from one template. */
export interface PlannedLaunchGroup<Spec = unknown> {
  readonly reservationId: string;
  readonly template: ProvisionerTemplate<Spec>;
  readonly count: number;
}

/**
 * Decide how many runners to start, and from which templates, for the reservations
 * the API granted, never exceeding the free slots in `availableByKey`. Reservations
 * are filled cheapest-template-first and spill to the next matching template when the
 * preferred one is full. Pure and deterministic: the same reservations, templates,
 * and capacity always plan the same launches.
 *
 * Slots are charged against a private copy of `availableByKey`, so two reservations
 * in one poll response cannot both claim the same slot.
 */
export function planLaunches<Spec>(params: {
  reservations: readonly ReservationDemand[];
  templates: readonly ProvisionerTemplate<Spec>[];
  availableByKey: ReadonlyMap<string, number>;
}): PlannedLaunchGroup<Spec>[] {
  const remainingByKey = new Map(params.availableByKey);
  const planned: PlannedLaunchGroup<Spec>[] = [];

  for (const reservation of params.reservations) {
    let remaining = reservation.count;

    for (const template of rankTemplatesForLabels(reservation.labels, params.templates)) {
      if (remaining <= 0) break;

      const available = remainingByKey.get(template.key) ?? 0;
      if (available <= 0) continue;

      const take = Math.min(remaining, available);
      planned.push({reservationId: reservation.reservationId, template, count: take});
      remainingByKey.set(template.key, available - take);
      remaining -= take;
    }
  }

  return planned;
}
