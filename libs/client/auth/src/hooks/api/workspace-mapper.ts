import type {WorkspaceResponseDto} from '@shipfox/api-workspaces-dto';

export interface Workspace {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
}

export function toWorkspace(dto: WorkspaceResponseDto): Workspace {
  return {id: dto.id, name: dto.name, status: dto.status};
}
