import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Icon,
  ScrollArea,
} from '@shipfox/react-ui';
import {Link, useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';

export interface ProjectSwitcherProps {
  workspaceId: string;
  activeProjectId?: string | undefined;
  onSelect?: () => void;
}

export function ProjectSwitcher({workspaceId, activeProjectId, onSelect}: ProjectSwitcherProps) {
  const navigate = useNavigate();
  const query = useProjectsInfiniteQuery(workspaceId);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];

  // Eagerly fetch additional pages once the popover opens; the switcher should
  // show the full list, not just the first page. (Lazy-fetch + cursor pagination
  // are deferred — see TODOS.md "Project switcher lazy-fetch + pagination".)
  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  const handleSelect = (projectId: string) => {
    navigate({
      to: '/workspaces/$wid/projects/$pid',
      params: {wid: workspaceId, pid: projectId},
    });
    onSelect?.();
  };

  const handleSelectAll = () => {
    navigate({to: '/workspaces/$wid', params: {wid: workspaceId}});
    onSelect?.();
  };

  return (
    <Command>
      <CommandInput placeholder="Search projects..." />
      <ScrollArea>
        <CommandList className="max-h-300">
          <CommandGroup>
            <CommandItem value="__all" keywords={['all projects']} onSelect={handleSelectAll}>
              <Icon
                name="check"
                className={`size-16 mr-8 ${activeProjectId ? 'opacity-0' : 'opacity-100'}`}
              />
              All projects
            </CommandItem>
          </CommandGroup>
          {query.isError ? (
            <CommandEmpty>Couldn&apos;t load projects.</CommandEmpty>
          ) : query.isLoading ? (
            <CommandEmpty>Loading projects...</CommandEmpty>
          ) : projects.length === 0 ? (
            <CommandEmpty>No projects yet.</CommandEmpty>
          ) : (
            <CommandGroup heading="Projects">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.id}
                  keywords={[project.name]}
                  onSelect={() => handleSelect(project.id)}
                >
                  <Icon
                    name="check"
                    className={`size-16 mr-8 ${
                      activeProjectId === project.id ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup>
            <CommandItem value="__create" onSelect={() => onSelect?.()} asChild>
              <Link
                to="/workspaces/$wid/projects/new"
                params={{wid: workspaceId}}
                className="flex items-center gap-8"
              >
                <Icon name="addLine" className="size-16" />
                Create project
              </Link>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </ScrollArea>
    </Command>
  );
}
