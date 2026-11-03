import {useEffect, useRef, useState} from 'react';
import type {TranscriptEntry} from '#core/transcript.js';

// A screen reader reads the whole region, so a long reply is cut short here.
const MAX_ANNOUNCED_CHARS = 400;

/**
 * What the polite status region says. The reply's start, the finished message, and a failure.
 * Streamed text and a stream `reset` say nothing, because the transcript is silent.
 */
export function useAnnouncement(params: {
  replying: boolean;
  transcript: readonly TranscriptEntry[];
  failureTitle: string | undefined;
}): string {
  const {replying, transcript, failureTitle} = params;
  const [announcement, setAnnouncement] = useState('');
  const wasReplying = useRef(replying);
  const latest = useRef({transcript, failureTitle});
  latest.current = {transcript, failureTitle};

  useEffect(() => {
    if (replying === wasReplying.current) return;
    wasReplying.current = replying;
    if (replying) {
      setAnnouncement('Shippy is replying');
      return;
    }
    const {failureTitle: failed, transcript: entries} = latest.current;
    if (failed) {
      setAnnouncement(failed);
      return;
    }
    const reply = [...entries].reverse().find((entry) => entry.kind === 'agent');
    if (reply?.kind !== 'agent' || !reply.text.trim()) {
      setAnnouncement('Shippy stopped');
      return;
    }
    const text =
      reply.text.length > MAX_ANNOUNCED_CHARS
        ? `${reply.text.slice(0, MAX_ANNOUNCED_CHARS)}…`
        : reply.text;
    setAnnouncement(reply.stopped ? `Shippy stopped: ${text}` : `Shippy replied: ${text}`);
  }, [replying]);

  return announcement;
}
