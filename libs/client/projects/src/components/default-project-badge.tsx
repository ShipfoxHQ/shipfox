import {Badge} from '@shipfox/react-ui/badge';

/**
 * Marks the workspace's default project wherever projects are listed or named. Callers render it
 * when `project.isDefault` is set, never by name, so a renamed default keeps it.
 */
export function DefaultProjectBadge({className}: {className?: string}) {
  return (
    <Badge variant="feature" className={className}>
      Default
    </Badge>
  );
}
