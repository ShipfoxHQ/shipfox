import type {ProjectSourceKind} from './project.js';

export const REPOSITORY_RESOURCE_KIND = 'repository';

/** A resource a project can be limited to inside a connection. In v1, a repository. */
export interface AccessResource {
  kind: string;
  externalId: string;
  /** Lowercase match key, such as `acme/app`. */
  lookupName: string;
  /** As the provider returns it, such as `acme/App`. */
  displayName: string;
}

export interface ProjectAccessConnection {
  connectionId: string;
  /** Null when the connection is gone but its scope has not been removed yet. */
  provider: string | null;
  displayName: string | null;
  resources: 'all' | AccessResource[];
}

export interface ProjectAccessConfigSource {
  kind: ProjectSourceKind;
  connectionId: string;
  externalRepositoryId: string;
  lookupName: string | null;
}

/** The connections and resources a project's workflows and agents can use. */
export interface ProjectAccess {
  projectId: string;
  /** Always part of the access, without being stored as a resource. */
  configSource: ProjectAccessConfigSource;
  connections: 'all' | ProjectAccessConnection[];
}

export interface ScopeResourcePage {
  resources: AccessResource[];
  nextCursor: string | null;
}

export interface UpdateProjectAccessCommand {
  projectId: string;
  connections:
    | 'all'
    | {connectionId: string; resources: 'all' | {kind: string; externalId: string}[]}[];
}

export type AccessMode = 'all' | 'selected';

export interface AccessDraftConnection {
  connectionId: string;
  resources: 'all' | AccessResource[];
}

/**
 * The access an admin is editing. The connection list survives a switch to All connections, so
 * switching back restores it.
 */
export interface AccessDraft {
  mode: AccessMode;
  connections: AccessDraftConnection[];
}

/** A linked project's config repository counts as a resource of its connection, and is locked. */
export function lockedConnectionId(configSource: ProjectAccessConfigSource): string | null {
  return configSource.kind === 'linked' ? configSource.connectionId : null;
}

export function accessDraftFromAccess(access: ProjectAccess): AccessDraft {
  if (access.connections === 'all') return {mode: 'all', connections: []};
  const connections: AccessDraftConnection[] = access.connections.map((connection) => ({
    connectionId: connection.connectionId,
    resources: connection.resources,
  }));
  // An unlisted config connection reaches only the config repository, which an empty list says.
  const locked = lockedConnectionId(access.configSource);
  if (locked && !connections.some((connection) => connection.connectionId === locked)) {
    connections.unshift({connectionId: locked, resources: []});
  }
  return {mode: 'selected', connections};
}

export type AccessDraftAction =
  | {type: 'set-mode'; mode: AccessMode}
  | {type: 'set-connection'; connectionId: string; listed: boolean}
  | {type: 'set-resource-scope'; connectionId: string; scope: 'all' | 'selected'}
  | {type: 'set-resource'; connectionId: string; resource: AccessResource; listed: boolean};

export function reduceAccessDraft(
  draft: AccessDraft,
  action: AccessDraftAction,
  configSource: ProjectAccessConfigSource,
): AccessDraft {
  const locked = lockedConnectionId(configSource);
  switch (action.type) {
    case 'set-mode': {
      if (action.mode === 'all') return {...draft, mode: 'all'};
      const lockedMissing =
        locked !== null && !draft.connections.some(({connectionId}) => connectionId === locked);
      return {
        mode: 'selected',
        connections: lockedMissing
          ? [{connectionId: locked, resources: 'all'}, ...draft.connections]
          : draft.connections,
      };
    }
    case 'set-connection': {
      if (action.connectionId === locked) return draft;
      const others = draft.connections.filter(
        ({connectionId}) => connectionId !== action.connectionId,
      );
      if (!action.listed) return {...draft, connections: others};
      if (others.length !== draft.connections.length) return draft;
      return {
        ...draft,
        connections: [...draft.connections, {connectionId: action.connectionId, resources: 'all'}],
      };
    }
    case 'set-resource-scope':
      return updateConnection(draft, action.connectionId, (connection) => {
        if (action.scope === 'all') return {...connection, resources: 'all'};
        return connection.resources === 'all' ? {...connection, resources: []} : connection;
      });
    case 'set-resource':
      return updateConnection(draft, action.connectionId, (connection) => {
        const current = connection.resources === 'all' ? [] : connection.resources;
        const others = current.filter(
          (resource) =>
            resource.kind !== action.resource.kind ||
            resource.externalId !== action.resource.externalId,
        );
        return {
          ...connection,
          resources: action.listed ? [...others, action.resource] : others,
        };
      });
  }
}

function updateConnection(
  draft: AccessDraft,
  connectionId: string,
  update: (connection: AccessDraftConnection) => AccessDraftConnection,
): AccessDraft {
  return {
    ...draft,
    connections: draft.connections.map((connection) =>
      connection.connectionId === connectionId ? update(connection) : connection,
    ),
  };
}

/**
 * The connections whose Selected list is empty. The config connection of a linked project is
 * exempt, because its config repository counts.
 */
export function findEmptyResourceScopes(
  draft: AccessDraft,
  configSource: ProjectAccessConfigSource,
): string[] {
  if (draft.mode === 'all') return [];
  const locked = lockedConnectionId(configSource);
  return draft.connections
    .filter(
      ({connectionId, resources}) =>
        resources !== 'all' && resources.length === 0 && connectionId !== locked,
    )
    .map(({connectionId}) => connectionId);
}

export function toUpdateProjectAccessCommand(
  projectId: string,
  draft: AccessDraft,
): UpdateProjectAccessCommand {
  if (draft.mode === 'all') return {projectId, connections: 'all'};
  return {
    projectId,
    connections: draft.connections.map(({connectionId, resources}) => ({
      connectionId,
      resources:
        resources === 'all' ? 'all' : resources.map(({kind, externalId}) => ({kind, externalId})),
    })),
  };
}

/** Whether two drafts save the same access, whatever the order of their lists. */
export function isSameAccess(left: AccessDraft, right: AccessDraft): boolean {
  return accessKey(left) === accessKey(right);
}

function accessKey(draft: AccessDraft): string {
  if (draft.mode === 'all') return 'all';
  return JSON.stringify(
    draft.connections
      .map(({connectionId, resources}) => [
        connectionId,
        resources === 'all'
          ? 'all'
          : resources.map(({kind, externalId}) => `${kind}:${externalId}`).sort(),
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}
