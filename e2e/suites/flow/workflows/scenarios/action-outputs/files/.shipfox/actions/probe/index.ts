import {defineAction} from '@shipfox/actions';

export default defineAction(({setOutput}) => {
  setOutput('partial', 'set before return');
  return {
    as_true: 'true',
    as_number: '123',
    as_null: 'null',
    as_array: '[1]',
    structured: {items: [2, true, null]},
  };
});
