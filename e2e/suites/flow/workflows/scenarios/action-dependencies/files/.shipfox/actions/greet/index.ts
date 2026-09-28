import {defineAction} from '@shipfox/actions';
import {greet} from 'greeting';

export default defineAction<{name: string}>(({inputs, log}) => {
  const greeting = greet(inputs.name);
  log.info(greeting);
  return {greeting};
});
