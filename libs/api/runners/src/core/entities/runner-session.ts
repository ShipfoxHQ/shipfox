import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';

export interface RunnerSession {
  id: string;
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  registrationTokenKind: 'manual' | 'ephemeral' | 'activation';
  runnerInstanceId: string | null;
  provisionerId: string | null;
  providerRunnerId: string | null;
  labels: string[];
  toolCapabilities: RunnerToolCapabilitiesDto | null;
  toolCapabilitiesReportedAt: Date | null;
  maxClaims: number | null;
  claimsUsed: number;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
