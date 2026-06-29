import {AgentProviderOnboardingPage} from '@shipfox/client-agent';
import {createFileRoute, useNavigate} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/agent-provider')({
  component: AgentProviderOnboardingRoute,
});

function AgentProviderOnboardingRoute() {
  const {wid} = Route.useParams();
  const navigate = useNavigate();
  const goToProjectCreation = () => {
    void navigate({
      to: '/workspaces/$wid/projects/new',
      params: {wid},
      replace: true,
    });
  };

  return (
    <AgentProviderOnboardingPage
      workspaceId={wid}
      onSkip={goToProjectCreation}
      onConfigured={goToProjectCreation}
    />
  );
}
