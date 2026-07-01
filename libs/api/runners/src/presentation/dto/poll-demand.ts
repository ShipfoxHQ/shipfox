import type {PollDemandResponseDto} from '@shipfox/api-runners-dto';
import type {PollDemandResult} from '#core/demand.js';

export function toPollDemandResponseDto(result: PollDemandResult): PollDemandResponseDto {
  return {
    stats: result.stats.map((stat) => ({
      labels: stat.labels,
      queued: stat.queued,
      reserved: stat.reserved,
      oldest_queued_at: stat.oldestQueuedAt.toISOString(),
    })),
    reservations: result.reservations.map((reservation) => ({
      reservation_id: reservation.reservationId,
      labels: reservation.labels,
      count: reservation.count,
      expires_at: reservation.expiresAt.toISOString(),
    })),
    terminate_provisioned_runner_ids: result.terminateProvisionedRunnerIds,
  };
}
