import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

const [, , scenario, action] = process.argv;
const scale = Number.parseFloat(process.env.DEMO_TIME_SCALE ?? '1');
const stateDir = join('.shipfox', 'demo-state');
const feedbackPath = join('.shipfox', 'demo-feedback.md');

if (scenario !== 'repair') {
  await failUsage();
}

switch (action) {
  case 'inspect':
    await inspectRepair();
    break;
  case 'test-gate':
    await runTestGate();
    break;
  case 'package':
    await packageRepair();
    break;
  default:
    await failUsage();
}

async function failUsage() {
  console.error('Usage: node scripts/demo-step.mjs repair <inspect|test-gate|package>');
  process.exit(2);
}

async function inspectRepair() {
  await line('::group::Read failure summary');
  await line('Pull request: checkout-pricing-discounts');
  await line('Changed files: src/checkout.js, fixtures/cart.json');
  await line('Customer report: discounted taxable items are overcharged by 6-8%.');
  await line('::endgroup::');
  await line('::group::Replay failing regression');
  await line('node --test fixtures/checkout-regression.test.js');
  await line('not ok 1 - applies item-level discounts before tax', 'stderr');
  await line('  Expected values to be strictly equal:', 'stderr');
  await line('  0 !== 500', 'stderr');
  await line('not ok 2 - rounds tax after removing discounts from taxable items only', 'stderr');
  await line('  Expected values to be strictly equal:', 'stderr');
  await line('  512 !== 448', 'stderr');
  await line('::endgroup::');
  await line('Seeded repair context for the agent.');
  await writeFeedback(`\
# Checkout pricing repair context

The regression suite is failing because item-level discounts are ignored.

Expected behavior:

- Sum every line item into subtotal_cents before discounts.
- Sum item.discount_cents into discount_cents.
- For taxable items, apply the discount before calculating tax.
- Round tax with Math.round after multiplying by tax_rate_bps / 10000.
- total_cents is subtotal_cents - discount_cents + tax_cents.

The contract example lives in fixtures/checkout-regression.test.js.fixture.
`);
}

async function runTestGate() {
  await mkdir(stateDir, {recursive: true});
  const attemptPath = join(stateDir, 'repair-test-gate-attempt');
  const attempt = (await readAttempt(attemptPath)) + 1;
  await writeFile(attemptPath, `${attempt}\n`);

  await line(`::group::Checkout regression gate attempt ${attempt}`);
  await line('node --test fixtures/checkout-regression.test.js');

  if (attempt === 1) {
    await line('TAP version 13');
    await line('# Subtest: applies item-level discounts before tax', 'stderr');
    await line('not ok 1 - applies item-level discounts before tax', 'stderr');
    await line('  failureType: testCodeFailure', 'stderr');
    await line('  expected: 500', 'stderr');
    await line('  actual: 0', 'stderr');
    await line('# Subtest: rounds tax after removing discounts from taxable items only', 'stderr');
    await line('not ok 2 - rounds tax after removing discounts from taxable items only', 'stderr');
    await line('  expected: 448', 'stderr');
    await line('  actual: 512', 'stderr');
    await line('1..2');
    await line('# tests 2');
    await line('# fail 2', 'stderr');
    await line('::endgroup::');
    await writeFeedback(`\
# Checkout pricing repair feedback

Attempt 1 failed.

The implementation still ignores item.discount_cents. Update src/checkout.js so
discount_cents is the sum of all line-item discounts.

The tax calculation must also use the taxable amount after discounts, not the
original taxable subtotal.
`);
    process.exit(1);
  }

  if (attempt === 2) {
    await line('TAP version 13');
    await line('# Subtest: applies item-level discounts before tax');
    await line('ok 1 - applies item-level discounts before tax');
    await line('# Subtest: rounds tax after removing discounts from taxable items only', 'stderr');
    await line('not ok 2 - rounds tax after removing discounts from taxable items only', 'stderr');
    await line('  failureType: testCodeFailure', 'stderr');
    await line('  expected: 448', 'stderr');
    await line('  actual: 512', 'stderr');
    await line('1..2');
    await line('# tests 2');
    await line('# pass 1');
    await line('# fail 1', 'stderr');
    await line('::endgroup::');
    await writeFeedback(`\
# Checkout pricing repair feedback

Attempt 2 fixed discount_cents, but tax is still calculated before taxable
discounts are removed.

For taxable items, subtract the item's discount from that item's extended price
before summing the taxable base. Do not subtract discounts from non-taxable items
when calculating tax.
`);
    process.exit(1);
  }

  await line('TAP version 13');
  await line('# Subtest: applies item-level discounts before tax');
  await line('ok 1 - applies item-level discounts before tax');
  await line('# Subtest: rounds tax after removing discounts from taxable items only');
  await line('ok 2 - rounds tax after removing discounts from taxable items only');
  await line('1..2');
  await line('# tests 2');
  await line('# pass 2');
  await line('# fail 0');
  await line('::endgroup::');
  await line('Checkout pricing contract verified after agent repair loop.');
}

async function packageRepair() {
  await line('::group::Prepare verified change');
  await line('Writing repair summary');
  await line('Collecting changed files');
  await line('src/checkout.js');
  await line('.shipfox/demo-feedback.md');
  await line('::endgroup::');
  await line('Ready for review: checkout pricing repair passed all gates.');
}

async function readAttempt(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

async function writeFeedback(content) {
  await mkdir(dirname(feedbackPath), {recursive: true});
  await writeFile(feedbackPath, content);
}

async function line(text, stream = 'stdout', delayMs = 350) {
  await sleep(delayMs);
  const target = stream === 'stderr' ? process.stderr : process.stdout;
  target.write(`${text}\n`);
}

function sleep(delayMs) {
  const scaled = Math.max(0, Math.round(delayMs * scale));
  return new Promise((resolve) => setTimeout(resolve, scaled));
}
