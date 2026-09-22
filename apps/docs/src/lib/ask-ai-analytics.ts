import type {AskAiMessage} from '@/lib/ask-ai-core';
import {ASK_AI_QUESTION_MAX_LENGTH, normalizeTrackedQuery} from '@/lib/docs-analytics-core';

export interface AskAiQuestionProperties {
  question: string;
  question_length: number;
  question_redacted: boolean;
}

export interface AskAiAnswerProperties extends AskAiQuestionProperties {
  model: string;
  pages_read: number;
  failed_reads: number;
  answer_length: number;
  has_answer: boolean;
  finish_reason: string;
  steps: number;
  provider: string;
}

const UNREPORTED = 'unknown';

export function askAiQuestionProperties(question: string): AskAiQuestionProperties {
  const tracked = normalizeTrackedQuery({
    value: question,
    maxLength: ASK_AI_QUESTION_MAX_LENGTH,
  });
  return {
    question: tracked.query,
    question_length: tracked.queryLength,
    question_redacted: tracked.queryRedacted,
  };
}

/**
 * Two things are worth watching about an answer. `has_answer` catches a turn
 * that produced only tool calls, which reads as a hang. `provider` and
 * `finish_reason` say which OpenRouter endpoint served it and whether it chose
 * to stop, so a run of bad answers can be traced to an endpoint rather than
 * guessed at.
 */
export function askAiAnswerProperties({
  question,
  answer,
  model,
}: {
  question: string;
  answer: AskAiMessage;
  model: string;
}): AskAiAnswerProperties {
  let pagesRead = 0;
  let failedReads = 0;
  let answerLength = 0;

  for (const part of answer.parts) {
    if (part.type === 'text') {
      answerLength += part.text.length;
      continue;
    }
    if (part.type !== 'tool-read_page') continue;
    if (part.state === 'output-available') pagesRead += 1;
    if (part.state === 'output-error') failedReads += 1;
  }

  return {
    ...askAiQuestionProperties(question),
    model,
    pages_read: pagesRead,
    failed_reads: failedReads,
    answer_length: answerLength,
    has_answer: answerLength > 0,
    finish_reason: answer.metadata?.finish_reason ?? UNREPORTED,
    steps: answer.metadata?.steps ?? 0,
    provider: answer.metadata?.provider ?? UNREPORTED,
  };
}

export function askAiFailureReason(error: Error): 'not_configured' | 'aborted' | 'provider_error' {
  if (error.name === 'AbortError') return 'aborted';
  if (error.message.includes('not configured')) return 'not_configured';
  return 'provider_error';
}
