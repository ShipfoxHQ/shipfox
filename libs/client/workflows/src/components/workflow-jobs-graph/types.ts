import type {RunDetailResponseDto} from '@shipfox/api-workflows-dto';

export interface WorkflowJobsGraphProps {
  run: RunDetailResponseDto;
  className?: string | undefined;
}
