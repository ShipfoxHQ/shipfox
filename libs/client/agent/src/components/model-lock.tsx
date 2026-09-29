import {Alert, AlertActions, AlertContent, AlertDescription} from '@shipfox/react-ui/alert';
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
  const locks = distinctLocks(models);
  if (locks.length === 0) return null;

  return (
    <div className="flex flex-col gap-inline">
      {locks.map((lock) => (
        <Alert key={`${lock.message}|${lock.action?.url ?? ''}`} variant="info" animated={false}>
          <AlertContent>
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

function distinctLocks(models: readonly AgentModel[]): ModelLock[] {
  const byNotice = new Map<string, ModelLock>();
  for (const model of models) {
    if (model.locked === undefined) continue;
    byNotice.set(`${model.locked.message}|${model.locked.action?.url ?? ''}`, model.locked);
  }
  return [...byNotice.values()];
}
