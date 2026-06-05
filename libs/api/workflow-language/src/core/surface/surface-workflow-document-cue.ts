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
