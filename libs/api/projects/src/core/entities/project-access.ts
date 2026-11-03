export type ProjectConnectionAccess = 'all' | 'selected';

export interface StoredAccessResource {
  kind: string;
  externalId: string;
  lookupName: string;
  displayName: string;
}

export interface StoredConnectionScope {
  connectionId: string;
  resources: 'all' | StoredAccessResource[];
}

/** A project's access as stored: the connection mode, and the scope of each listed connection. */
export interface StoredProjectAccess {
  connectionAccess: ProjectConnectionAccess;
  scopes: StoredConnectionScope[];
}
