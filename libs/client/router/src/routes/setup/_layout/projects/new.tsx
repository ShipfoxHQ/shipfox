import {CreateProjectPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';
import {z} from 'zod';

const searchSchema = z.object({
  wid: z.string().uuid().optional(),
});

export const Route = createFileRoute('/setup/_layout/projects/new')({
  validateSearch: searchSchema,
  component: CreateProjectPageRoute,
});

function CreateProjectPageRoute() {
  const {wid} = Route.useSearch();
  return <CreateProjectPage workspaceIdFromUrl={wid} />;
}
