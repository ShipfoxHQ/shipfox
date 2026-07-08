'use client';

import {type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {basePath} from '@/url';

// Root-relative sources stay clean `/img/...` in the MDX; the app is served under
// /docs in production, so prefix the basePath here (empty in dev).
const withBase = (value?: string) =>
  typeof value === 'string' && value.startsWith('/') ? `${basePath}${value}` : value;

const FOCUSABLE = 'button, video, a[href], [tabindex]:not([tabindex="-1"])';

interface DocsVideoProps {
  src: string;
  poster?: string;
  label?: string;
  // Intrinsic pixel dimensions of the recording, so the browser reserves the
  // aspect-ratio box and the above-the-fold hero does not shift as it loads.
  width?: number;
  height?: number;
}

/**
 * Autoplaying, muted, looping product clip that sits inline like an image and
 * opens a larger lightbox on click (Escape or a backdrop click closes it),
 * mirroring the click-to-zoom behaviour of Fumadocs images. The docs render dark
 * only today, so a single (dark) source is enough; the matching light recording
 * is stored for the adaptive-theme follow-up.
 */
export function DocsVideo({src, poster, label, width, height}: DocsVideoProps) {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resolvedSrc = withBase(src);
  const resolvedPoster = withBase(poster);
  const dialogLabel = label ?? 'Enlarged video';

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    // Freeze the page behind the lightbox so scrolling does not leak through.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog so keyboard users are not left on the covered page.
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // Restore focus to the trigger when the lightbox closes.
      triggerRef.current?.focus();
    };
  }, [expanded]);

  // Keep Tab focus inside the open dialog (backdrop button + video controls).
  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setExpanded(true)}
        aria-label={label ? `${label} (click to enlarge)` : 'Enlarge the video'}
        className="group relative my-6 block w-full cursor-zoom-in appearance-none border-0 bg-transparent p-0"
      >
        <video
          className="h-auto w-full overflow-hidden rounded-xl border border-fd-border shadow-xl"
          src={resolvedSrc}
          poster={resolvedPoster}
          width={width}
          height={height}
          tabIndex={-1}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
        <span className="pointer-events-none absolute top-3 right-3 rounded-md border border-fd-border bg-fd-background/80 p-1.5 text-fd-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <ExpandIcon />
        </span>
      </button>
      {expanded &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={dialogLabel}
            tabIndex={-1}
            onKeyDown={trapFocus}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          >
            {/* Full-screen backdrop; a real button so Enter/Space close it too. */}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close the enlarged video"
              className="absolute inset-0 cursor-zoom-out appearance-none border-0 bg-black/80 p-0 backdrop-blur-sm"
            />
            <video
              className="relative max-h-[90vh] w-auto max-w-[95vw] rounded-lg border border-fd-border shadow-2xl"
              src={resolvedSrc}
              poster={resolvedPoster}
              autoPlay
              muted
              loop
              playsInline
              controls
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}
