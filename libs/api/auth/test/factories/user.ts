import {Factory} from 'fishery';
import type {User} from '#core/entities/user.js';
import {hashPassword} from '#core/password.js';
import {createUser, markEmailVerified} from '#db/users.js';

export const userFactory = Factory.define<User & {plainPassword: string}>(
  ({sequence, onCreate, params}) => {
    const plainPassword = params.plainPassword ?? 'correct horse battery staple';

    onCreate(async (user) => {
      const hashedPassword = await hashPassword({password: plainPassword});
      const created = await createUser({
        email: user.email,
        hashedPassword,
        name: user.name,
        givenName: user.givenName,
        familyName: user.familyName,
      });
      if (user.emailVerifiedAt) {
        const verified = await markEmailVerified({userId: created.id});
        return {...(verified ?? created), plainPassword};
      }
      return {...created, plainPassword};
    });

    return {
      id: crypto.randomUUID(),
      email: `user-${sequence}-${crypto.randomUUID()}@example.com`,
      hashedPassword: 'placeholder',
      name: `User ${sequence}`,
      givenName: null,
      familyName: null,
      emailVerifiedAt: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      plainPassword,
    };
  },
);
