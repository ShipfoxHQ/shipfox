/** An action version a workflow pins with `uses: namespace/name@1.4.2`. */
export interface RegistryActionRef {
  kind: 'action';
  package: string;
  version: string;
  /** The steps that use it, as `<job key>.<step key or index>`. */
  steps: string[];
}

/** A template version, read from the `# shipfox-template:` header of the workflow file. */
export interface RegistryTemplateRef {
  kind: 'template';
  package: string;
  version: string;
  bindings: Record<string, string>;
  options: Record<string, string>;
}

/** A pre-registry header, `<id>@<revision>`, which has no base in the registry and gets no notice. */
export interface LegacyTemplateRef {
  kind: 'template';
  legacy: true;
  id: string;
  revision: number;
}

/** What a definition takes from the registry, recorded at sync. */
export type RegistryRef = RegistryActionRef | RegistryTemplateRef | LegacyTemplateRef;
