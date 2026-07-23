// Source-shape fixtures use these module names without adding runtime dependencies
// to the tooling package.

declare module '@shipfox/api-projects-dto' {
  export interface ProjectResponseDto {
    readonly id: string;
  }

  export interface CreateProjectBodyDto {
    readonly name: string;
  }

  export interface ListProjectsQueryDto {
    readonly cursor?: string;
  }

  export const createProjectBodySchema: {
    readonly shape: {
      readonly name: unknown;
    };
  };
}

declare module '@shipfox/api-workspaces-dto' {
  export interface WorkspaceResponseDto {
    readonly id: string;
  }
}

declare module '@tanstack/react-query' {
  export interface QueryClient {}

  export function useQueryClient(): {
    readonly setQueryData: (...args: unknown[]) => void;
  };

  export function useQuery(): unknown;
}

declare module '@shipfox/client-api' {
  export function apiRequest(...args: unknown[]): unknown;

  export function checkedApiRequest(...args: unknown[]): unknown;
}
