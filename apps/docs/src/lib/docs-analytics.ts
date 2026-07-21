'use client';

import posthog from 'posthog-js';
import {buildDocsEventProperties} from '@/lib/docs-analytics-core';
import type {CatalogCapability, CatalogCategory} from '@/lib/integration-catalog';
import {basePath} from '@/url';

interface CatalogContext {
  query: string;
  query_length: number;
  query_redacted: boolean;
  selected_capabilities: readonly CatalogCapability[];
  selected_categories: readonly CatalogCategory[];
}

interface DocsAnalyticsEvents {
  docs_page_feedback: {page: string; helpful: boolean};
  docs_catalog_searched: CatalogContext & {result_count: number; has_results: boolean};
  docs_catalog_filter_changed: CatalogContext & {
    facet: 'capability' | 'category' | 'all';
    value: string;
    action: 'selected' | 'removed' | 'cleared';
    result_count: number;
  };
  docs_catalog_result_clicked: CatalogContext & {
    provider: string;
    target: 'overview' | 'setup';
    result_rank: number;
    result_count: number;
  };
  docs_code_copy_clicked: {language: string; block_index: number};
  docs_cta_clicked: {destination_path: string; label?: string};
  docs_outbound_link_clicked: {destination_origin: string; destination_path: string};
  docs_edit_on_github_clicked: {page: string; file_path: string};
}

export function captureDocsEvent<Event extends keyof DocsAnalyticsEvents>(
  event: Event,
  properties: DocsAnalyticsEvents[Event],
): void {
  if (typeof window === 'undefined') return;

  posthog.capture(event, buildDocsEventProperties(window.location.pathname, basePath, properties));
}
