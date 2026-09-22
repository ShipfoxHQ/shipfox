export type ToolReferenceKind = 'integration' | 'mcp';
export type ToolAccess = 'read' | 'write';
export type ToolFieldRequirement = 'required' | 'optional' | 'conditional';

export interface ToolReferenceField {
  name: string;
  /** Dotted path from the schema root, with `[]` for array items. */
  path: string;
  type: string;
  requirement: ToolFieldRequirement;
  description?: string;
  enumValues?: string[];
  constraints?: string;
  children?: ToolReferenceField[];
}

/** One input shape when a schema is a union of object shapes. */
export interface ToolReferenceVariant {
  title: string;
  fields: ToolReferenceField[];
}

export interface ToolReferenceRepository {
  classification: string;
  indirectTargetNote?: string;
}

export interface ToolReferenceMethod {
  id: string;
  anchor: string;
  description: string;
  access: ToolAccess;
  sensitive: boolean;
  permissions: string[];
  alternativePermissions?: string[][];
  repository?: ToolReferenceRepository;
  requiredInput: string[];
}

export interface ToolReferenceExample {
  title: string;
  language: 'yaml' | 'json';
  code: string;
}

export interface ToolReferenceTool {
  id: string;
  anchor: string;
  description: string;
  access: ToolAccess;
  sensitive: boolean;
  permissions: string[];
  alternativePermissions?: string[][];
  repository?: ToolReferenceRepository;
  selectors: string[];
  input: ToolReferenceField[];
  inputVariants?: ToolReferenceVariant[];
  inputAlternatives?: string[][];
  methods?: ToolReferenceMethod[];
  output?: ToolReferenceField[];
  examples: ToolReferenceExample[];
}

export interface ToolReferenceGroup {
  title: string;
  anchor: string;
  tools: ToolReferenceTool[];
}

export interface ToolReferenceDocument {
  /** Generated file id such as `integrations/jira/tools`. */
  id: string;
  kind: ToolReferenceKind;
  outputLabel: 'Output' | 'Result';
  groups: ToolReferenceGroup[];
  /** Machine-readable serialization used by the LLM text and link checks. */
  markdown: string;
}
