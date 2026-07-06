import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';

export interface RunnerSession {
  id: string;
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  registrationTokenKind: 'manual' | 'ephemeral';
  provisionerId: string | null;
  provisionedRunnerId: string | null;
  labels: string[];
  toolCapabilities: RunnerToolCapabilitiesDto | null;
  toolCapabilitiesReportedAt: Date | null;
  maxClaims: number | null;
  claimsUsed: number;
  createdAt: Date;
  updatedAt: Date;
}
