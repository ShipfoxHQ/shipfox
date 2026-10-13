import {defineAction} from '@shipfox/actions';

export default defineAction(() => {
  throw new Error('The post fails the job.');
});
