import {RequiredActionLink} from '@shipfox/client-shell/runtime';
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from '@shipfox/react-ui/alert';
import type {JobExecution} from '#core/workflow-run.js';

export function DurationLimitNotice({execution}: {execution: JobExecution | undefined}) {
  if (!execution?.durationCapped || !execution.durationNotice) return null;
  const {durationNotice} = execution;
  const requiredAction = durationNotice.requiredAction;
  return (
    <Alert
      variant="warning"
      animated={false}
      className="rounded-none border-x-0 border-t border-b border-tag-warning-border bg-transparent px-row py-row"
    >
      <AlertContent>
        <AlertTitle>Job duration limited</AlertTitle>
        <AlertDescription>{durationNotice.message}</AlertDescription>
        {requiredAction !== undefined ? (
          <AlertActions>
            <RequiredActionLink action={requiredAction} appearance="button" />
          </AlertActions>
        ) : null}
      </AlertContent>
    </Alert>
  );
}
