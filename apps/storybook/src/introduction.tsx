import {ButtonLink} from '@shipfox/react-ui/button';
import {Card, CardDescription, CardFooter, CardHeader, CardTitle} from '@shipfox/react-ui/card';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {storybookLinks} from '../preview-manifest.js';

export function IntroductionPage() {
  return (
    <main className="min-h-dvh bg-background-neutral-background px-24 py-48">
      <div className="mx-auto flex max-w-[960px] flex-col gap-32">
        <header className="max-w-[720px]">
          <Code variant="label" bold className="text-foreground-neutral-muted">
            Shipfox component library
          </Code>
          <Header variant="h1" className="mt-12">
            Browse the components behind Shipfox.
          </Header>
          <Text size="lg" className="mt-12 text-foreground-neutral-subtle">
            Choose a package to explore its components, states, and interaction patterns. Use the
            theme control above to review every surface in light or dark mode.
          </Text>
        </header>

        <section aria-labelledby="storybook-packages">
          <Header variant="h2" id="storybook-packages">
            Choose a package
          </Header>
          <div className="mt-16 grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-3">
            {storybookLinks.map((storybook) => (
              <Card className="h-full" key={storybook.id}>
                <CardHeader>
                  <CardTitle>{storybook.title}</CardTitle>
                  <CardDescription>
                    Explore {storybook.title} components, states, and interaction patterns.
                  </CardDescription>
                </CardHeader>
                <CardFooter className="mt-auto">
                  <ButtonLink href={storybook.url} variant="interactive" iconRight="chevronRight">
                    Browse stories
                  </ButtonLink>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
