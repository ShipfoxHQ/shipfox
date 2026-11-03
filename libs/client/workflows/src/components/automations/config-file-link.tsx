import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

export const CONFIG_FILES_ROUTE = '/w/$workspaceSlug/p/$projectSlug/automations/files/$';

export type ConfigFileView = 'code' | 'history';

export interface ConfigFileLinkProps {
  workspaceSlug: string;
  projectSlug: string;
  /** A file or folder under `.shipfox`, or `undefined` for the bare Files tab. */
  path: string | undefined;
  view?: ConfigFileView | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** Opens a config file or folder on the Files tab. */
export function ConfigFileLink({
  workspaceSlug,
  projectSlug,
  path,
  view = 'code',
  className,
  children,
}: ConfigFileLinkProps) {
  return (
    <Link
      to={CONFIG_FILES_ROUTE}
      params={{workspaceSlug, projectSlug, _splat: path ?? ''}}
      search={configFileSearch(view) as never}
      // Code and History share a path, so only the search tells them apart.
      activeOptions={{exact: true, includeSearch: true}}
      className={className}
    >
      {children}
    </Link>
  );
}

export function configFileSearch(view: ConfigFileView): {view?: 'history'} {
  return view === 'history' ? {view: 'history'} : {};
}
