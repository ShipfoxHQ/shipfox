import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {useNavigate} from '@tanstack/react-router';
import {ModelProviderOnboardingPage} from '#pages/model-provider-onboarding-page.js';
import {modelProviderRouteParams} from './inputs.js';

export default defineRoute({
  component: () => {
    const {wid} = useRouteParams(modelProviderRouteParams);
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
