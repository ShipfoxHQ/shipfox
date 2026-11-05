import {defineRoute} from '@shipfox/client-shell/runtime';
import {AzureDevOpsInstallPage} from '#pages/azure-devops-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: AzureDevOpsInstallPage,
});
