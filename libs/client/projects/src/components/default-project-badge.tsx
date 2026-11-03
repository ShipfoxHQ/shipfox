import {Badge} from '@shipfox/react-ui/badge';

/**
 * Marks the workspace's default project, wherever projects are listed or named. It reads the
 * project's flag, never its name, so a renamed default keeps it. No other marker uses this style.
 */
export function DefaultProjectBadge({className}: {className?: string}) {
  return (
    <Badge variant="feature" className={className}>
      Default
    </Badge>
  );
}
