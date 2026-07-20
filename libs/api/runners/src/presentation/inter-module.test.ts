import {runnersInterModuleContract} from '@shipfox/api-runners-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {EmptyRequiredLabelsError} from '#core/errors.js';
import {toEnqueueJobExecutionKnownError} from './inter-module.js';

describe('Runners inter-module presentation', () => {
  test('maps empty scheduling labels to the published contract error', () => {
    const result = toEnqueueJobExecutionKnownError(new EmptyRequiredLabelsError());

    expect(
      isInterModuleKnownError(runnersInterModuleContract.methods.enqueueJobExecution, result) &&
        result.code,
    ).toBe('empty-required-labels');
  });
});
