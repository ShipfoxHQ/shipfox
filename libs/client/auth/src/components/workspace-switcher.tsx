import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Icon,
} from '@shipfox/react-ui';
import {Link, useNavigate} from '@tanstack/react-router';
import {useSetAtom} from 'jotai';
import {useAuthState} from '#hooks/use-auth-state.js';
import {lastWorkspaceIdAtom} from '#state/last-workspace.js';

export interface WorkspaceSwitcherProps {
  activeWorkspaceId: string | undefined;
  onSelect?: () => void;
}

export function WorkspaceSwitcher({activeWorkspaceId, onSelect}: WorkspaceSwitcherProps) {
  const {workspaces} = useAuthState();
  const navigate = useNavigate();
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);

  const handleSelect = (workspaceId: string) => {
    try {
      setLastWorkspaceId(workspaceId);
    } catch {
      // localStorage may throw in private browsing or quota-exceeded; persistence is best-effort.
    }
    navigate({to: '/workspaces/$wid', params: {wid: workspaceId}});
    onSelect?.();
  };

  return (
    <Command>
      <CommandInput placeholder="Search workspaces..." />
      <CommandList>
        <CommandEmpty>No workspaces found.</CommandEmpty>
        <CommandGroup heading="Workspaces">
          {workspaces.map((workspace) => (
            <CommandItem
              key={workspace.id}
              value={workspace.id}
              keywords={[workspace.name]}
              onSelect={() => handleSelect(workspace.id)}
            >
              <Icon
                name="check"
                className={`size-16 mr-8 ${
                  activeWorkspaceId === workspace.id ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {workspace.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <CommandSeparator />
      <CommandGroup forceMount>
        <CommandItem value="__create" onSelect={() => onSelect?.()} forceMount asChild>
          <Link to="/setup/workspaces/new" className="flex items-center gap-8">
            <Icon name="addLine" className="size-16" />
            Create workspace
          </Link>
        </CommandItem>
      </CommandGroup>
    </Command>
  );
}
