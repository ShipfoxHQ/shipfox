import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import type {AgentModel, ModelLock} from '#core/models.js';

/** Marks a locked model in a list. The reason is explained once by `ModelLockNotices`. */
export function ModelLockIcon({lock}: {lock: ModelLock}) {
  return (
    <>
      <Icon
        name="lockLine"
        aria-hidden="true"
        className="size-16 shrink-0 text-foreground-neutral-muted"
      />
      <span className="sr-only">Locked: {lock.label}</span>
    </>
  );
}

/** One callout per distinct reason, so a list of locked models explains itself once. */
export function ModelLockNotices({models}: {models: readonly AgentModel[]}) {
  const groups = groupByNotice(models);
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-inline">
      {groups.map(({key, lock, labels}) => (
        <Alert key={key} variant="info" animated={false}>
          <AlertContent>
            <AlertTitle>{lockedTitle(labels)}</AlertTitle>
            <AlertDescription>{lock.message}</AlertDescription>
            {lock.action ? (
              <AlertActions>
                <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
                  <a href={lock.action.url}>{lock.action.message}</a>
                </Button>
              </AlertActions>
            ) : null}
          </AlertContent>
        </Alert>
      ))}
    </div>
  );
}

function lockedTitle(labels: readonly string[]): string {
  const [first, second] = labels;
  if (labels.length === 1) return `${first} is locked`;
  if (labels.length === 2) return `${first} and ${second} are locked`;
  return `${labels.length} models are locked`;
}

function groupByNotice(
  models: readonly AgentModel[],
): {key: string; lock: ModelLock; labels: string[]}[] {
  const groups = new Map<string, {key: string; lock: ModelLock; labels: string[]}>();
  for (const model of models) {
    if (model.locked === undefined) continue;
    const key = `${model.locked.message}|${model.locked.action?.url ?? ''}`;
    const group = groups.get(key) ?? {key, lock: model.locked, labels: []};
    group.labels.push(model.label);
    groups.set(key, group);
  }
  return [...groups.values()];
}
