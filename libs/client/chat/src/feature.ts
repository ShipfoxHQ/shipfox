import {defineClientFeature} from '@shipfox/client-shell';

export const chatFeature = defineClientFeature({
  id: 'shipfox.chat',
  projectDock: {
    load: () => import('./components/chat-dock.js'),
  },
});
