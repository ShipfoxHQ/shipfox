import {canonicalizeLabels} from '@shipfox/runner-labels';

export function canonicalizeRunnerLabels(labels: string[]): string[] {
  return [...canonicalizeLabels(labels)];
}
