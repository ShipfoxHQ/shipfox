import type {
  CreateProjectBodyDto,
  ListProjectsQueryDto as ProjectsQuery,
} from '@shipfox/api-projects-dto';
import {createProjectBodySchema} from '@shipfox/api-projects-dto';

export const projectNameSchema = createProjectBodySchema.shape.name;
export type {CreateProjectBodyDto, ProjectsQuery};
