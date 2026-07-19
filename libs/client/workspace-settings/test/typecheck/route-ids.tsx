import {getRouteApi} from '@tanstack/react-router';
import './settings-composition.js';

getRouteApi('/workspaces/$wid/settings/events');

// @ts-expect-error The generated route tree rejects unknown route ids.
getRouteApi('/workspaces/$wid/settings/_layout/events');
