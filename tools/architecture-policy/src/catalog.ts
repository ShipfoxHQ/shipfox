import {
  type ArchitectureClassConfiguration,
  architectureClasses,
  architecturePolicySchemaVersion,
  type ClassRelationship,
  type RepositoryConfiguration,
  type RuleCatalog,
} from './types.js';

export const guidanceLocations = {
  composition: 'docs/guides/architecture-validation.md#executable-contract-tests',
  exceptions: 'docs/guides/architecture-validation.md#exceptions',
  facts: 'docs/guides/architecture-validation.md#repository-architecture-policy',
  imports: 'docs/guides/architecture-validation.md#dependency-cruiser-rules',
  manifests: 'docs/guides/architecture-validation.md#repository-architecture-policy',
  realms: 'docs/guides/architecture-validation.md#cross-repository-rules',
} as const;

export const RULE_IDS = {
  classRelationship: 'architecture/class-relationship',
  compositionOwner: 'architecture/composition-owner',
  exceptionValidity: 'architecture/exception-validity',
  exportIntent: 'architecture/export-intent',
  factReference: 'architecture/fact-reference',
  manifestEdge: 'architecture/manifest-edge',
  metadataRequired: 'architecture/metadata-required',
  realmConfiguration: 'architecture/realm-configuration',
  realmDirection: 'architecture/realm-direction',
  unknownClass: 'architecture/unknown-class',

  // These IDs predate the shared evaluator and remain stable during migration.
  foreignImplementation: 'api-no-foreign-implementation-imports',
  foreignSameContextSpi: 'api-no-foreign-same-context-spi-imports',
  dtoImplementation: 'api-no-dto-implementation-imports',
  dtoSpi: 'api-no-dto-spi-imports',
  sharedSemanticImplementation: 'api-no-shared-semantic-implementation-imports',
  sharedSemanticSpi: 'api-no-shared-semantic-spi-imports',
  foreignSpiImplementation: 'api-no-foreign-spi-implementation-imports',
  foreignSpi: 'api-no-foreign-spi-imports',
} as const;

export const ruleCatalog: RuleCatalog = {
  schemaVersion: architecturePolicySchemaVersion,
  rules: [
    {
      id: RULE_IDS.realmDirection,
      title: 'Realm dependency direction',
      description:
        'A participating package may depend only on realms declared by its source realm.',
      guidanceLocation: guidanceLocations.realms,
      blocking: true,
    },
    {
      id: RULE_IDS.metadataRequired,
      title: 'Participating package metadata',
      description:
        'A participating package must declare its realm, architecture class, and required bounded context.',
      guidanceLocation: guidanceLocations.facts,
      blocking: true,
    },
    {
      id: RULE_IDS.unknownClass,
      title: 'Known architecture class',
      description:
        'Architecture classes fail closed until the repository configuration declares them.',
      guidanceLocation: guidanceLocations.facts,
      blocking: true,
    },
    {
      id: RULE_IDS.classRelationship,
      title: 'Architecture class relationship',
      description:
        'Every participating class pair needs an explicit allow, same-context, or never decision.',
      guidanceLocation: guidanceLocations.imports,
      blocking: true,
    },
    {
      id: RULE_IDS.manifestEdge,
      title: 'Manifest dependency edge',
      description:
        'Declared dependency groups must use the same class and realm boundary as resolved imports.',
      guidanceLocation: guidanceLocations.manifests,
      blocking: true,
    },
    {
      id: RULE_IDS.exportIntent,
      title: 'Public export intent',
      description:
        'Public exports must identify a valid subpath and a resolved source or declaration target.',
      guidanceLocation: guidanceLocations.facts,
      blocking: true,
    },
    {
      id: RULE_IDS.compositionOwner,
      title: 'Explicit composition ownership',
      description: 'Composition facts must name all owners and an explicit coordinator.',
      guidanceLocation: guidanceLocations.composition,
      blocking: true,
    },
    {
      id: RULE_IDS.exceptionValidity,
      title: 'Exact temporary exceptions',
      description:
        'Exceptions must identify one finding, its owner, tracking issue, and removal data.',
      guidanceLocation: guidanceLocations.exceptions,
      blocking: true,
    },
    {
      id: RULE_IDS.realmConfiguration,
      title: 'Realm configuration',
      description:
        'Realm relationships must reference declared realms and remain repository-local.',
      guidanceLocation: guidanceLocations.realms,
      blocking: true,
    },
    {
      id: RULE_IDS.factReference,
      title: 'Fact references',
      description:
        'Edges and composition facts must reference packages present in the normalized document.',
      guidanceLocation: guidanceLocations.facts,
      blocking: true,
    },
    ...[
      {id: RULE_IDS.foreignImplementation, title: 'Foreign implementation import'},
      {id: RULE_IDS.foreignSameContextSpi, title: 'Foreign same-context SPI import'},
      {id: RULE_IDS.dtoImplementation, title: 'DTO implementation import'},
      {id: RULE_IDS.dtoSpi, title: 'DTO SPI import'},
      {id: RULE_IDS.sharedSemanticImplementation, title: 'Shared semantic implementation import'},
      {id: RULE_IDS.sharedSemanticSpi, title: 'Shared semantic SPI import'},
      {id: RULE_IDS.foreignSpiImplementation, title: 'Foreign SPI implementation import'},
      {id: RULE_IDS.foreignSpi, title: 'Foreign SPI import'},
    ].map(({id, title}) => ({
      id,
      title,
      description: 'Preserved API package boundary rule identity for shared policy migration.',
      guidanceLocation: guidanceLocations.imports,
      blocking: true as const,
    })),
  ],
};

export const RULE_CATALOG = ruleCatalog;

export function getRuleCatalog(): RuleCatalog {
  return JSON.parse(JSON.stringify(ruleCatalog)) as RuleCatalog;
}

export function serializeRuleCatalog(): string {
  return `${JSON.stringify(ruleCatalog, null, 2)}\n`;
}

const defaultArchitectureClasses: Record<string, ArchitectureClassConfiguration> = {
  [architectureClasses.compositionRoot]: {requiresBoundedContext: false},
  [architectureClasses.dto]: {requiresBoundedContext: true},
  [architectureClasses.implementation]: {requiresBoundedContext: true},
  [architectureClasses.sharedInfrastructure]: {requiresBoundedContext: false},
  [architectureClasses.sharedSemantic]: {requiresBoundedContext: false},
  [architectureClasses.spi]: {requiresBoundedContext: true},
};

const defaultClassRelationships: Record<string, Record<string, ClassRelationship>> = {
  [architectureClasses.implementation]: {
    [architectureClasses.compositionRoot]: {decision: 'allow'},
    [architectureClasses.dto]: {decision: 'allow'},
    [architectureClasses.implementation]: {
      decision: 'same-context',
      ruleId: RULE_IDS.foreignImplementation,
    },
    [architectureClasses.sharedInfrastructure]: {decision: 'allow'},
    [architectureClasses.sharedSemantic]: {decision: 'allow'},
    [architectureClasses.spi]: {
      decision: 'same-context',
      ruleId: RULE_IDS.foreignSameContextSpi,
    },
  },
  [architectureClasses.dto]: {
    [architectureClasses.compositionRoot]: {decision: 'allow'},
    [architectureClasses.dto]: {decision: 'allow'},
    [architectureClasses.implementation]: {
      decision: 'never',
      ruleId: RULE_IDS.dtoImplementation,
    },
    [architectureClasses.sharedInfrastructure]: {decision: 'allow'},
    [architectureClasses.sharedSemantic]: {decision: 'allow'},
    [architectureClasses.spi]: {decision: 'never', ruleId: RULE_IDS.dtoSpi},
  },
  [architectureClasses.sharedSemantic]: {
    [architectureClasses.compositionRoot]: {decision: 'allow'},
    [architectureClasses.dto]: {decision: 'allow'},
    [architectureClasses.implementation]: {
      decision: 'never',
      ruleId: RULE_IDS.sharedSemanticImplementation,
    },
    [architectureClasses.sharedInfrastructure]: {decision: 'allow'},
    [architectureClasses.sharedSemantic]: {decision: 'allow'},
    [architectureClasses.spi]: {decision: 'never', ruleId: RULE_IDS.sharedSemanticSpi},
  },
  [architectureClasses.sharedInfrastructure]: {
    [architectureClasses.compositionRoot]: {decision: 'allow'},
    [architectureClasses.dto]: {decision: 'allow'},
    [architectureClasses.implementation]: {decision: 'allow'},
    [architectureClasses.sharedInfrastructure]: {decision: 'allow'},
    [architectureClasses.sharedSemantic]: {decision: 'allow'},
    [architectureClasses.spi]: {decision: 'allow'},
  },
  [architectureClasses.spi]: {
    [architectureClasses.compositionRoot]: {decision: 'allow'},
    [architectureClasses.dto]: {decision: 'allow'},
    [architectureClasses.implementation]: {
      decision: 'same-context',
      ruleId: RULE_IDS.foreignSpiImplementation,
    },
    [architectureClasses.sharedInfrastructure]: {decision: 'allow'},
    [architectureClasses.sharedSemantic]: {decision: 'allow'},
    [architectureClasses.spi]: {decision: 'same-context', ruleId: RULE_IDS.foreignSpi},
  },
  [architectureClasses.compositionRoot]: {
    [architectureClasses.compositionRoot]: {decision: 'allow'},
    [architectureClasses.dto]: {decision: 'allow'},
    [architectureClasses.implementation]: {decision: 'allow'},
    [architectureClasses.sharedInfrastructure]: {decision: 'allow'},
    [architectureClasses.sharedSemantic]: {decision: 'allow'},
    [architectureClasses.spi]: {decision: 'allow'},
  },
};

export const DEFAULT_ARCHITECTURE_CLASSES = defaultArchitectureClasses;
export const DEFAULT_CLASS_RELATIONSHIPS = defaultClassRelationships;

export function createDefaultRepositoryConfiguration(): RepositoryConfiguration {
  return {
    schemaVersion: architecturePolicySchemaVersion,
    localPackages: [],
    compositionRoots: [],
    realms: {
      default: {mayDependOn: ['default']},
    },
    architectureClasses: JSON.parse(JSON.stringify(defaultArchitectureClasses)) as Record<
      string,
      ArchitectureClassConfiguration
    >,
    classRelationships: JSON.parse(JSON.stringify(defaultClassRelationships)) as Record<
      string,
      Record<string, ClassRelationship>
    >,
    exportIntent: {},
    extensions: {},
    exceptions: [],
  };
}
