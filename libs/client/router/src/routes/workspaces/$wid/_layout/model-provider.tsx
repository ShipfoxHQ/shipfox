import {ModelProviderOnboardingPage} from '@shipfox/client-agent';
import {createFileRoute, useNavigate} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/model-provider')({
  component: ModelProviderOnboardingRoute,
});

function ModelProviderOnboardingRoute() {
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
    <ModelProviderOnboardingPage
      workspaceId={wid}
      onSkip={goToProjectCreation}
      onConfigured={goToProjectCreation}
    />
  );
}
