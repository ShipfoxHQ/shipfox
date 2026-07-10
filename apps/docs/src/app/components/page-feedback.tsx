'use client';

import posthog from 'posthog-js';
import {useState} from 'react';

const GITHUB_EDIT_BASE = 'https://github.com/ShipfoxHQ/shipfox/edit/main/apps/docs/content/docs/';

export function PageFeedback({pageUrl, filePath}: {pageUrl: string; filePath: string}) {
  const [voted, setVoted] = useState(false);

  const vote = (helpful: boolean) => {
    setVoted(true);
    posthog.capture('docs_page_feedback', {page: pageUrl, helpful});
  };

  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-sm text-fd-muted-foreground">
      {voted ? (
        <span>Thanks for the feedback!</span>
      ) : (
        <div className="flex items-center gap-3">
          <span>Was this page helpful?</span>
          <button
            type="button"
            onClick={() => vote(true)}
            className="rounded-md border px-3 py-1 transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => vote(false)}
            className="rounded-md border px-3 py-1 transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            No
          </button>
        </div>
      )}
      <a
        href={`${GITHUB_EDIT_BASE}${filePath}`}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 transition-colors hover:text-fd-foreground"
      >
        Edit this page on GitHub
      </a>
    </div>
  );
}
