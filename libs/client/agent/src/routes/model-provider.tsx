import {defineRoute} from '@shipfox/client-shell/runtime';
import {useNavigate, useParams} from '@tanstack/react-router';
import {ModelProviderOnboardingPage} from '#pages/model-provider-onboarding-page.js';

export default defineRoute({
  component: () => {
    const {wid} = useParams({strict: false}) as {wid: string};
    const navigate = useNavigate();
    const goToProjectCreation = () => {
      void navigate({to: '/workspaces/$wid/projects/new', params: {wid}, replace: true});
    };
    return (
      <ModelProviderOnboardingPage
        workspaceId={wid}
        onSkip={goToProjectCreation}
        onConfigured={goToProjectCreation}
      />
    );
  },
});
