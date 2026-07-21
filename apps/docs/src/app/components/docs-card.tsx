'use client';

import {Card, type CardProps} from 'fumadocs-ui/components/card';
import {captureDocsEvent} from '@/lib/docs-analytics';
import {destinationFromHref} from '@/lib/docs-analytics-core';

export function DocsCard({href, onClick, title, ...props}: CardProps) {
  return (
    <Card
      {...props}
      title={title}
      href={href}
      data-docs-analytics-cta=""
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !href) return;

        const destination = destinationFromHref(href, window.location.href);
        if (!destination) return;
        captureDocsEvent('docs_cta_clicked', {
          destination_path: destination.pathname,
          ...(typeof title === 'string' ? {label: title} : {}),
        });
      }}
    />
  );
}
