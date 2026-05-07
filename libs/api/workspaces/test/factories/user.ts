import {Factory} from 'fishery';

export interface TestUser {
  userId: string;
  email: string;
  name: string | null;
}

export const userFactory = Factory.define<TestUser>(({sequence}) => {
  return {
    userId: crypto.randomUUID(),
    email: `user-${sequence}-${crypto.randomUUID()}@example.com`,
    name: `User ${sequence}`,
  };
});
