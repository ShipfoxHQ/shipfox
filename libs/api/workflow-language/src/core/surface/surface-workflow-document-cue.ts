export type SurfaceCueBoundaryReference = Readonly<{
  capability: string;
  pr1Status: 'included' | 'deferred';
  behavior: string;
  nextRequiredWork: string;
}>;

export const surfaceWorkflowDocumentCueBoundaryReference: readonly SurfaceCueBoundaryReference[] = [
  {
    capability: 'CUE formalization artifact',
    pr1Status: 'included',
    behavior: 'The committed CUE string formalizes the object shape produced by YAML parsing.',
    nextRequiredWork: 'Keep the artifact and the generated Zod-to-CUE field map aligned.',
  },
  {
    capability: 'CUE authoring input',
    pr1Status: 'deferred',
    behavior: 'Workflow definitions are still authored through the current YAML ingestion path.',
    nextRequiredWork:
      'Add a dedicated parser, validation path, DTO tests, and UI/API acceptance rules.',
  },
  {
    capability: 'CUE CLI validation',
    pr1Status: 'deferred',
    behavior: 'CI does not execute the `cue` CLI for PR1.',
    nextRequiredWork:
      'Add the toolchain deliberately before treating CUE execution as a required check.',
  },
];

export const surfaceWorkflowDocumentCueSchema = `// SurfaceWorkflowDocument formalizes the object produced by YAML parsing.
// This is a PR1 formalization artifact, not an accepted authoring input.

#StringOrStringList: string | [...string]

#RunStep: {
	run:  string
	name?: string
}

#Job: {
	needs?:  #StringOrStringList
	runner?: #StringOrStringList
	steps: [#RunStep, ...#RunStep]
}

#Trigger: {
	source: string
	event?: string
	on?:    #StringOrStringList
	with?:  {...}
	filter?: string
}

#SurfaceWorkflowDocument: {
	name: string & != ""
	triggers?: [string]: #Trigger
	runner?: #StringOrStringList
	jobs: [string]: #Job
}
`;
