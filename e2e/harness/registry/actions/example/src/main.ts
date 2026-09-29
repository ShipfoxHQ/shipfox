import {defineAction} from '@shipfox/actions';

export default defineAction<{name: string}>(({inputs, log}) => {
  const greeting = `Hello, ${inputs.name}!`;
  log.info(greeting);
  return {greeting};
});
