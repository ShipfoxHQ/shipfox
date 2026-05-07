import {WorkspaceOnboardingPage} from '@shipfox/client-auth';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/_layout/workspaces/new')({
  component: WorkspaceOnboardingPage,
});
