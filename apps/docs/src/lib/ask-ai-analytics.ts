import type {AskAiMessage} from '@/lib/ask-ai-core';
import {ASK_AI_QUESTION_MAX_LENGTH, normalizeTrackedQuery} from '@/lib/docs-analytics-core';

export interface AskAiQuestionProperties {
  question: string;
  question_length: number;
  question_redacted: boolean;
}

export interface AskAiAnswerProperties extends AskAiQuestionProperties {
  model: string;
  search_count: number;
  pages_returned: number;
  zero_result_searches: number;
  answer_length: number;
  has_answer: boolean;
}

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
 * Retrieval quality is the part of an answer worth watching: a search that
 * returns no page means the reader's wording missed the keyword index, which is
 * the failure this feature is most prone to.
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
  let searchCount = 0;
  let pagesReturned = 0;
  let zeroResultSearches = 0;
  let answerLength = 0;

  for (const part of answer.parts) {
    if (part.type === 'text') {
      answerLength += part.text.length;
      continue;
    }
    if (part.type !== 'tool-search') continue;
    searchCount += 1;
    if (part.state !== 'output-available') continue;
    pagesReturned += part.output.length;
    if (part.output.length === 0) zeroResultSearches += 1;
  }

  return {
    ...askAiQuestionProperties(question),
    model,
    search_count: searchCount,
    pages_returned: pagesReturned,
    zero_result_searches: zeroResultSearches,
    answer_length: answerLength,
    has_answer: answerLength > 0,
  };
}

export function askAiFailureReason(error: Error): 'not_configured' | 'aborted' | 'provider_error' {
  if (error.name === 'AbortError') return 'aborted';
  if (error.message.includes('not configured')) return 'not_configured';
  return 'provider_error';
}
