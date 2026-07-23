

import type {ProjectResponseDto as Project} from '@shipfox/api-projects-dto';
import {type WorkspaceResponseDto as Workspace} from '@shipfox/api-workspaces-dto';

export type {Project, Workspace};

type DynamicProject = import('@shipfox/api-projects-dto').ProjectDto;

export type {DynamicProject};
