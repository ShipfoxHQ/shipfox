import Link from 'next/link';
import {packagePath} from '@/lib/urls';
import {Row, RowList, Section} from './section';

/** The exact registry actions a template or a composite action uses, each linked to its page. */
export function ActionsUsed({actions}: {actions: string[]}) {
  if (actions.length === 0) return null;
  return (
    <Section title="Actions used">
      <RowList>
        {actions.map((reference) => (
          <Row key={reference}>
            <Link
              href={packagePath(reference.slice(0, reference.lastIndexOf('@')))}
              className="font-code text-foreground-highlight-interactive underline underline-offset-2"
            >
              {reference}
            </Link>
          </Row>
        ))}
      </RowList>
    </Section>
  );
}
