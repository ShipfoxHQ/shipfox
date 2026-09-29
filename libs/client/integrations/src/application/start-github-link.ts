import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {useCallback} from 'react';
import type {InstallRedirect} from '#core/models.js';
import {createGithubLink} from '#hooks/api/integrations.js';

export function useStartGithubLink() {
  const analytics = useClientAnalytics();
  return useCallback(
    async (body: {workspace_id: string}): Promise<InstallRedirect> => {
      analytics.capture('github_link_started', {});
      try {
        const {authorizeUrl} = await createGithubLink(body);
        return {installUrl: authorizeUrl};
      } catch (error) {
        analytics.capture('github_link_failed', {reason: 'start-failed'});
        throw error;
      }
    },
    [analytics],
  );
}
