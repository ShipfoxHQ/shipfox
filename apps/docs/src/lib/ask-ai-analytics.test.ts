import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askAiAnswerProperties,
  askAiFailureReason,
  askAiQuestionProperties,
} from './ask-ai-analytics';
import type {AskAiMessage} from './ask-ai-core';

function answer(parts: AskAiMessage['parts']): AskAiMessage {
  return {id: 'answer', role: 'assistant', parts};
}

function searchPart(urls: string[]): AskAiMessage['parts'][number] {
  return {
    type: 'tool-search',
    toolCallId: `call-${urls.join('-')}`,
    state: 'output-available',
    input: {query: 'runner labels'},
    output: urls.map((url) => ({title: url, url, content: '# page'})),
  };
}

test('keeps a plain question and reports its real length', () => {
  const properties = askAiQuestionProperties('  How do I   choose a RUNNER? ');

  assert.deepEqual(properties, {
    question: 'how do i choose a runner?',
    question_length: 25,
    question_redacted: false,
  });
});

test('drops a question that carries a secret instead of truncating it', () => {
  const properties = askAiQuestionProperties('why does api_key=abc123 fail');

  assert.equal(properties.question, '[redacted]');
  assert.equal(properties.question_redacted, true);
});

test('truncates a long question but keeps far more than a catalog search', () => {
  const long = 'how do I choose a runner for this job and then group the logs '.repeat(8);
  const properties = askAiQuestionProperties(long);

  assert.equal(properties.question.length, 240);
  assert.equal(properties.question_redacted, false);
  assert.equal(properties.question_length > 240, true);
});

test('redacts an unbroken run long enough to be a credential', () => {
  assert.equal(askAiQuestionProperties('a'.repeat(400)).question, '[redacted]');
});

test('counts searches, pages, and the answer text across steps', () => {
  const properties = askAiAnswerProperties({
    question: 'how do I choose a runner',
    model: 'z-ai/glm-5.3-flash',
    answer: answer([
      searchPart(['/a', '/b']),
      {type: 'text', text: 'Set the top-level '},
      {type: 'text', text: '`runner` field.'},
    ]),
  });

  assert.equal(properties.search_count, 1);
  assert.equal(properties.pages_returned, 2);
  assert.equal(properties.zero_result_searches, 0);
  assert.equal(properties.answer_length, 33);
  assert.equal(properties.has_answer, true);
  assert.equal(properties.model, 'z-ai/glm-5.3-flash');
  assert.equal(properties.question, 'how do i choose a runner');
});

test('flags a search that found no page', () => {
  const properties = askAiAnswerProperties({
    question: 'unrelated',
    model: 'z-ai/glm-5.3-flash',
    answer: answer([searchPart([]), searchPart(['/a'])]),
  });

  assert.equal(properties.search_count, 2);
  assert.equal(properties.zero_result_searches, 1);
  assert.equal(properties.pages_returned, 1);
});

test('reports an answer that produced no text', () => {
  const properties = askAiAnswerProperties({
    question: 'anything',
    model: 'z-ai/glm-5.3-flash',
    answer: answer([searchPart(['/a'])]),
  });

  assert.equal(properties.has_answer, false);
  assert.equal(properties.answer_length, 0);
});

test('separates a missing key from a provider failure and an abort', () => {
  assert.equal(
    askAiFailureReason(new Error('Ask AI is not configured on this deployment.')),
    'not_configured',
  );
  assert.equal(askAiFailureReason(new Error('502 upstream')), 'provider_error');
  const aborted = new Error('cancelled');
  aborted.name = 'AbortError';
  assert.equal(askAiFailureReason(aborted), 'aborted');
});
