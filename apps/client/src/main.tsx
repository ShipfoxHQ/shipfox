/// <reference types="@shipfox/vite/client" />

import './styles.css';

import {defaultChrome, defaultWorkspaceSetupGate} from '@shipfox/client-features/runtime';
import {composeClientApp} from '@shipfox/client-shell/runtime';
import {features} from './features.js';
import {router} from './shipfox-app.gen.js';

const element = document.getElementById('app');
if (!element) throw new Error('No element with id "app" found');

composeClientApp({
  features,
  router,
  chrome: defaultChrome,
  workspaceSetup: defaultWorkspaceSetupGate,
}).mount(element);
