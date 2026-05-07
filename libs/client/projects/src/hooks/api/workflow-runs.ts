import type {CreateRunBodyDto, RunResponseDto} from '@shipfox/api-workflows-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';

export async function createWorkflowRun(body: CreateRunBodyDto) {
  return await apiRequest<RunResponseDto>('/workflows/runs', {method: 'POST', body});
}

export function useCreateWorkflowRunMutation() {
  return useMutation({mutationFn: createWorkflowRun});
}
