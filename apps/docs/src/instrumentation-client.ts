import posthog from 'posthog-js';
import {sanitizePosthogCapture, sanitizeTrackedUrl} from '@/lib/docs-analytics-core';

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogUrl = process.env.NEXT_PUBLIC_POSTHOG_URL;

if (posthogKey && posthogUrl) {
  posthog.init(posthogKey, {
    api_host: posthogUrl,
    defaults: '2025-05-24',
    autocapture: {
      element_attribute_ignorelist: ['href', 'src', 'value'],
    },
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_dead_clicks: true,
    capture_heatmaps: true,
    capture_performance: true,
    capture_exceptions: true,
    disable_session_recording: false,
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      recordBody: false,
      recordHeaders: false,
      maskCapturedNetworkRequestFn: (request) => ({
        ...request,
        ...(request.name ? {name: sanitizeTrackedUrl(request.name)} : {}),
      }),
    },
    person_profiles: 'identified_only',
    before_send: sanitizePosthogCapture,
    loaded: (client) => {
      client.register({surface: 'docs'});
      client.startSessionRecording({
        sampling: true,
        linked_flag: true,
        url_trigger: true,
        event_trigger: true,
      });
    },
  });
}
