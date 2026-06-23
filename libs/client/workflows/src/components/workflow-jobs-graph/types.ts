import type {RunDetailResponseDto} from '@shipfox/api-workflows-dto';

export interface WorkflowJobsGraphProps {
  run: RunDetailResponseDto;
  selectedJobId?: string | undefined;
  defaultSelectedJobId?: string | undefined;
  onSelectedJobChange?: ((jobId: string | undefined) => void) | undefined;
  className?: string | undefined;
}
