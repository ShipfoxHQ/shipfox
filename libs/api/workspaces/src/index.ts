import {
  WORKSPACES_INVITATION_SEND_REQUESTED,
  type WorkspacesEventMap,
  workspacesEventSchemas,
} from '@shipfox/api-workspaces-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, workspacesOutbox} from '#db/index.js';
import {createApiKeyAuthMethod} from '#presentation/auth/api-key-auth.js';
import {workspacesE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {workspacesRoutes} from '#presentation/routes/index.js';
import {onInvitationSendRequested} from '#presentation/subscribers/index.js';

export type {ApiKey} from '#core/entities/api-key.js';
export type {Invitation} from '#core/entities/invitation.js';
export type {Membership} from '#core/entities/membership.js';
export type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
export {
  InvitationEmailMismatchError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
} from '#core/errors.js';
export {acceptWorkspaceInvitation, peekInvitationByRawToken} from '#core/invitations.js';
export {requireWorkspaceMembership} from '#core/workspaces.js';
export {db, migrationsPath} from '#db/index.js';
export {listMembershipsByUser} from '#db/memberships.js';
export {createApiKeyAuthMethod} from '#presentation/auth/api-key-auth.js';
export {requireMembership} from '#presentation/auth/require-membership.js';
export {workspacesRoutes as routes} from '#presentation/routes/index.js';

const subscriber = subscriberFactory<WorkspacesEventMap>();

export const workspacesModule: ShipfoxModule = {
  name: 'workspaces',
  database: {db, migrationsPath},
  auth: [createApiKeyAuthMethod()],
  routes: workspacesRoutes,
  e2eRoutes: [workspacesE2eRoutes],
  publishers: [
    {name: 'workspaces', table: workspacesOutbox, db, eventSchemas: workspacesEventSchemas},
  ],
  subscribers: [subscriber(WORKSPACES_INVITATION_SEND_REQUESTED, onInvitationSendRequested)],
};
