import {CreateProjectPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/_layout/projects/new')({
  component: CreateProjectPage,
});
