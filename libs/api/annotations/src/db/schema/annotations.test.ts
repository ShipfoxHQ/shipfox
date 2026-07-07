import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {annotationFactory} from '#test/index.js';
import {annotations, toAnnotation} from './annotations.js';

describe('annotations schema', () => {
  it('maps a persisted annotation row to the domain entity', async () => {
    const annotation = await annotationFactory.create({
      context: 'deploy',
      style: 'success',
      body: 'Deployed **v42** to staging',
      bodyBytes: Buffer.byteLength('Deployed **v42** to staging'),
      sequence: 2,
    });

    const [row] = await db().select().from(annotations).where(eq(annotations.id, annotation.id));

    expect(row).toBeDefined();
    expect(row ? toAnnotation(row) : undefined).toEqual(annotation);
  });
});
