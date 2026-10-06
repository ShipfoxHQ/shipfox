import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EmailTemplateError} from '#errors.js';
import {createEmailRenderer} from '#renderer.js';

const brokenWord = /Key[\r\n]+board/;
const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'emails');

interface Templates {
  'order-shipped': {customerName: string; items: {name: string}[]; urgent: boolean};
  'unknown-partial': Record<string, never>;
  'bare-helper': {urgent: boolean};
}

const render = createEmailRenderer<Templates>({
  templatesDir,
  templates: {
    'order-shipped': {
      subject: 'Order for {{customerName}}',
      text: ({customerName, items}) =>
        `${customerName}: ${items.map((item) => item.name).join(', ')}`,
    },
    'unknown-partial': {subject: 'Unknown partial', text: () => ''},
    'bare-helper': {subject: 'Bare helper', text: () => ''},
  },
});

const data: Templates['order-shipped'] = {
  customerName: 'Alice',
  items: [{name: 'Keyboard'}, {name: 'Mouse'}],
  urgent: false,
};

describe('createEmailRenderer', () => {
  test('renders a template from a directory outside the package with the shared chrome', async () => {
    const email = await render('order-shipped', data);

    expect(email.subject).toBe('Order for Alice');
    expect(email.html).toContain('alt="Shipfox"');
    expect(email.html).toContain('/email-logo.png');
    expect(email.html).toContain('IBM Plex Sans');
    expect(email.html).toContain('Hello Alice');
    expect(email.html).toContain('Keyboard');
    expect(email.html).toContain('Mouse');
    expect(email.text).toBe('Alice: Keyboard, Mouse');
  });

  test('keeps a block helper wrapped in mj-raw working', async () => {
    const calm = await render('order-shipped', {...data, urgent: false});
    const urgent = await render('order-shipped', {...data, urgent: true});

    expect(calm.html).toContain('CALM-BRANCH');
    expect(calm.html).not.toContain('URGENT-BRANCH');
    expect(urgent.html).toContain('URGENT-BRANCH');
    expect(urgent.html).not.toContain('CALM-BRANCH');
  });

  test('throws EmailTemplateError naming an unknown shared partial', async () => {
    const error = await render('unknown-partial', {}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(EmailTemplateError);
    expect((error as Error).message).toContain('partials/nope.mjml');
  });

  test('throws EmailTemplateError for a bare block helper between MJML components', async () => {
    const error = await render('bare-helper', {urgent: true}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(EmailTemplateError);
    expect((error as Error).message).toContain('<mj-raw>');
  });

  test('strips control characters from values nested in arrays and objects', async () => {
    const email = await render('order-shipped', {
      ...data,
      items: [{name: 'Key\r\nboard'}, {name: '<b>Mouse</b>'}],
    });

    expect(email.text).toBe('Alice: Key board, <b>Mouse</b>');
    expect(email.html).toContain('Key board');
    expect(email.html).not.toMatch(brokenWord);
  });

  test('HTML-escapes values nested in arrays', async () => {
    const email = await render('order-shipped', {...data, items: [{name: '<script>x</script>'}]});

    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  test('throws EmailTemplateError for a template name that is not registered', async () => {
    await expect(
      // @ts-expect-error exercising the missing-definition guard with an invalid name
      render('does-not-exist', {}),
    ).rejects.toBeInstanceOf(EmailTemplateError);
  });

  test('throws EmailTemplateError when a registered template has no mjml file', async () => {
    const missing = createEmailRenderer<{ghost: object}>({
      templatesDir,
      templates: {ghost: {subject: 'Ghost', text: () => ''}},
    });

    await expect(missing('ghost', {})).rejects.toBeInstanceOf(EmailTemplateError);
  });
});
