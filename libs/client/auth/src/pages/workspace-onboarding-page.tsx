import {createWorkspaceBodySchema} from '@shipfox/api-workspaces-dto';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  FormFieldInput,
  Icon,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useNavigate} from '@tanstack/react-router';
import {useSetAtom} from 'jotai';
import {useState} from 'react';
import {useCreateWorkspaceAuth} from '#hooks/api/workspace-auth.js';
import {lastWorkspaceIdAtom} from '#state/last-workspace.js';
import {workspaceOnboardingErrorToFormError} from './form-errors.js';
import {displayNameFieldError} from './form-utils.js';

const previewMetrics = [
  {label: 'Runs', value: '--'},
  {label: 'Passed', value: '--'},
  {label: 'Failed', value: '--'},
  {label: 'Duration', value: '--'},
];
const previewBars = [
  {id: 'runs-start', height: 32},
  {id: 'runs-mid-low', height: 48},
  {id: 'runs-dip', height: 28},
  {id: 'runs-mid-high', height: 66},
  {id: 'runs-mid', height: 54},
  {id: 'runs-peak', height: 82},
  {id: 'runs-late-low', height: 44},
  {id: 'runs-late-high', height: 74},
];

export function WorkspaceOnboardingPage() {
  const createWorkspace = useCreateWorkspaceAuth();
  const navigate = useNavigate();
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {name: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const body = createWorkspaceBodySchema.parse({name: value.name});
        const created = await createWorkspace.mutateAsync(body);
        toast.success('Workspace created.');
        // Pin the new workspace as the last-active one so a page refresh and
        // future visits to `/` land on it.
        try {
          setLastWorkspaceId(created.id);
        } catch {
          // localStorage may throw in private browsing or quota-exceeded.
        }
        await navigate({to: '/workspaces/$wid', params: {wid: created.id}});
      } catch (error) {
        const mapped = workspaceOnboardingErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1120px] flex-col gap-24">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-10">
            <div className="flex size-36 items-center justify-center rounded-8 border border-border-neutral-base bg-background-neutral-base shadow-button-neutral">
              <Icon name="shipfox" className="size-24 text-background-highlight-interactive" />
            </div>
            <Text size="md" bold>
              Shipfox
            </Text>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-32 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <form
            className="relative z-10 w-full"
            noValidate
            aria-labelledby="workspace-onboarding-title"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <Card className="gap-20 p-24 shadow-button-neutral">
              <CardHeader className="gap-8">
                <CardTitle id="workspace-onboarding-title" variant="h1">
                  Create your workspace
                </CardTitle>
                <CardDescription>Give your team a place to collaborate.</CardDescription>
              </CardHeader>

              {formError ? <Alert variant="error">{formError}</Alert> : null}

              <CardContent className="flex flex-col gap-8">
                <form.Field
                  name="name"
                  validators={{
                    onBlur: ({value}) =>
                      displayNameFieldError(
                        value,
                        'Workspace name',
                        createWorkspaceBodySchema.shape.name,
                      ),
                    onSubmit: ({value}) =>
                      displayNameFieldError(
                        value,
                        'Workspace name',
                        createWorkspaceBodySchema.shape.name,
                      ),
                  }}
                >
                  {(field) => (
                    <FormField label="Workspace name" id="workspace-name" error={fieldError(field)}>
                      <FormFieldInput
                        autoComplete="organization"
                        name="name"
                        placeholder="Acme"
                        type="text"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )}
                </form.Field>
              </CardContent>

              <Button
                className="w-full"
                iconRight="chevronRight"
                isLoading={createWorkspace.isPending}
                type="submit"
              >
                {createWorkspace.isPending ? 'Creating workspace...' : 'Create workspace'}
              </Button>
            </Card>
          </form>

          <div className="hidden flex-col gap-18 lg:flex" aria-hidden="true">
            <div className="grid grid-cols-4 gap-12">
              {previewMetrics.map((metric) => (
                <div
                  className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-14 shadow-button-neutral"
                  key={metric.label}
                >
                  <Text size="xs" className="text-foreground-neutral-muted">
                    {metric.label}
                  </Text>
                  <Text size="xl" bold>
                    {metric.value}
                  </Text>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-18">
              <PreviewPanel title="Performance over time" />
              <PreviewPanel title="Duration distribution" bars />
            </div>
            <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-16 shadow-button-neutral">
              <Text size="sm" bold>
                Jobs breakdown
              </Text>
              <div className="mt-14 flex flex-col gap-10">
                {[0, 1, 2, 3].map((row) => (
                  <div
                    className="grid grid-cols-[1fr_80px_80px] gap-12 border-t border-border-neutral-base pt-10"
                    key={row}
                  >
                    <div className="h-12 rounded-full bg-background-neutral-disabled" />
                    <div className="h-12 rounded-full bg-background-neutral-disabled" />
                    <div className="h-12 rounded-full bg-background-neutral-disabled" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PreviewPanel({title, bars = false}: {title: string; bars?: boolean}) {
  return (
    <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-16 shadow-button-neutral">
      <Text size="sm" bold>
        {title}
      </Text>
      <div className="mt-16 flex h-[220px] items-end gap-8 border-b border-l border-border-neutral-base px-12 pb-10">
        {previewBars.map((bar) => (
          <div
            className={
              bars
                ? 'w-full rounded-t-4 bg-background-neutral-disabled'
                : 'w-full rounded-full bg-background-neutral-disabled'
            }
            key={`${title}-${bar.id}`}
            style={{height: `${bar.height}%`}}
          />
        ))}
      </div>
    </div>
  );
}

interface FieldLike {
  state: {meta: {errors: Array<unknown>; isBlurred: boolean}};
}

function fieldError(field: FieldLike): string | undefined {
  if (!field.state.meta.isBlurred && field.state.meta.errors.length === 0) return undefined;
  const first = field.state.meta.errors[0];
  if (!first) return undefined;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return String((first as {message: unknown}).message);
  }
  return undefined;
}
