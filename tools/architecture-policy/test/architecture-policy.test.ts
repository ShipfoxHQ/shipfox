import assert from 'node:assert/strict';

import {
  type ArchitectureFacts,
  architecturePolicySchemaVersion,
  assertArchitectureFacts,
  assertRepositoryConfiguration,
  type ExactException,
  evaluateArchitecturePolicy,
  getRuleCatalog,
  guidanceLocations,
  isArchitectureFacts,
  isRepositoryConfiguration,
  RULE_CATALOG,
  RULE_IDS,
  serializeRuleCatalog,
  validateRepositoryConfiguration,
} from '../src/index.js';
import {acceptedConfiguration, acceptedFacts} from './fixtures/accepted.js';
import {invalidRealmConfiguration, rejectedFacts} from './fixtures/rejected.js';

const realmRulePattern = /"architecture\/realm-direction"/u;
const architectureFactsErrorPattern = /Architecture facts/u;
const repositoryConfigurationErrorPattern = /Repository configuration/u;

describe('@shipfox/architecture-policy', () => {
  test('accepts local and installed packages through the same class and context rule', () => {
    assert.deepEqual(evaluateArchitecturePolicy(acceptedFacts, acceptedConfiguration()), []);
  });

  test('does not classify third-party packages as policy participants', () => {
    const diagnostics = evaluateArchitecturePolicy(acceptedFacts, acceptedConfiguration());
    assert.equal(
      diagnostics.some(({source}) => source === 'third-party-library'),
      false,
    );
  });

  test('fails closed for unknown classes and missing context', () => {
    const missingContext = structuredClone(rejectedFacts);
    const packageFact = missingContext.packages[0];
    assert.ok(packageFact);
    packageFact.architectureClass = 'implementation';

    const missingContextDiagnostics = evaluateArchitecturePolicy(
      missingContext,
      acceptedConfiguration(),
    );
    assert.ok(missingContextDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.metadataRequired));

    const diagnostics = evaluateArchitecturePolicy(missingContext, invalidRealmConfiguration());
    assert.ok(diagnostics.some(({ruleId}) => ruleId === RULE_IDS.realmConfiguration));

    const configuration = acceptedConfiguration();
    const unknownDiagnostics = evaluateArchitecturePolicy(rejectedFacts, configuration);
    assert.ok(unknownDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.unknownClass));
    assert.ok(unknownDiagnostics.every(({blocking}) => blocking === true));
  });

  test('rejects forbidden class relationships and cross-realm edges', () => {
    const facts: ArchitectureFacts = {
      schemaVersion: architecturePolicySchemaVersion,
      packages: [
        {
          schemaVersion: architecturePolicySchemaVersion,
          name: 'dto',
          version: null,
          path: 'packages/dto',
          origin: 'local',
          policyParticipant: true,
          realm: 'downstream',
          architectureClass: 'dto',
          boundedContext: 'billing',
        },
        {
          schemaVersion: architecturePolicySchemaVersion,
          name: 'implementation',
          version: null,
          path: 'packages/implementation',
          origin: 'installed',
          policyParticipant: true,
          realm: 'unapproved',
          architectureClass: 'implementation',
          boundedContext: 'billing',
        },
      ],
      importEdges: [
        {
          schemaVersion: architecturePolicySchemaVersion,
          source: 'dto',
          target: 'implementation',
          sourceFile: 'src/index.ts',
          specifier: 'implementation',
          importKind: 'static',
        },
      ],
      manifestEdges: [
        {
          schemaVersion: architecturePolicySchemaVersion,
          source: 'dto',
          target: 'implementation',
          dependencyGroup: 'devDependencies',
        },
      ],
      publicExports: [],
      compositionFacts: [],
    };
    const diagnostics = evaluateArchitecturePolicy(facts, acceptedConfiguration());
    assert.ok(diagnostics.some(({ruleId}) => ruleId === RULE_IDS.realmDirection));
    assert.ok(diagnostics.some(({ruleId}) => ruleId === RULE_IDS.dtoImplementation));
    const manifestDiagnostic = diagnostics.find(({ruleId}) => ruleId === RULE_IDS.manifestEdge);
    assert.ok(manifestDiagnostic);
    assert.equal(manifestDiagnostic.guidanceLocation, guidanceLocations.manifests);
    assert.equal(
      diagnostics.every(
        ({guidanceLocation, expectedBoundary}) => guidanceLocation && expectedBoundary,
      ),
      true,
    );
  });

  test('degrades null evaluator inputs to blocking diagnostics', () => {
    const nullConfigurationDiagnostics = evaluateArchitecturePolicy(acceptedFacts, null);
    assert.ok(
      nullConfigurationDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.realmConfiguration),
    );

    const nullFactsDiagnostics = evaluateArchitecturePolicy(null, acceptedConfiguration());
    assert.ok(nullFactsDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.factReference));
  });

  test('attributes configuration validation errors to their specific rule IDs', () => {
    const invalidClassRelationship = acceptedConfiguration();
    const implementationRelationships = invalidClassRelationship.classRelationships.implementation;
    assert.ok(implementationRelationships);
    implementationRelationships.implementation = {
      decision: 'invalid',
    } as never;
    const classRelationshipDiagnostics = evaluateArchitecturePolicy(
      acceptedFacts,
      invalidClassRelationship,
    );
    assert.ok(
      classRelationshipDiagnostics.some(
        ({ruleId, guidanceLocation}) =>
          ruleId === RULE_IDS.classRelationship && guidanceLocation === guidanceLocations.imports,
      ),
    );

    const invalidClassRelationshipField = acceptedConfiguration();
    invalidClassRelationshipField.classRelationships = null as never;
    const classRelationshipFieldDiagnostics = evaluateArchitecturePolicy(
      acceptedFacts,
      invalidClassRelationshipField,
    );
    assert.ok(
      classRelationshipFieldDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.classRelationship),
    );

    const invalidExportIntent = acceptedConfiguration();
    invalidExportIntent.exportIntent = null as never;
    const exportIntentDiagnostics = evaluateArchitecturePolicy(acceptedFacts, invalidExportIntent);
    assert.ok(exportIntentDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.exportIntent));

    const invalidCompositionRoot = acceptedConfiguration();
    invalidCompositionRoot.compositionRoots = null as never;
    const compositionDiagnostics = evaluateArchitecturePolicy(
      acceptedFacts,
      invalidCompositionRoot,
    );
    assert.ok(compositionDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.compositionOwner));

    const invalidException = acceptedConfiguration();
    invalidException.exceptions = [null as never];
    const exceptionDiagnostics = evaluateArchitecturePolicy(acceptedFacts, invalidException);
    assert.ok(exceptionDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.exceptionValidity));
  });

  test('reports missing package facts and local classification drift', () => {
    const factsWithMissingEdge = structuredClone(acceptedFacts);
    factsWithMissingEdge.importEdges.push({
      schemaVersion: architecturePolicySchemaVersion,
      source: '@example/local-implementation',
      target: '@example/missing',
      sourceFile: 'src/missing.ts',
      specifier: '@example/missing',
      importKind: 'static',
    });
    const missingPackageDiagnostics = evaluateArchitecturePolicy(
      factsWithMissingEdge,
      acceptedConfiguration(),
    );
    const missingPackageDiagnostic = missingPackageDiagnostics.find(
      ({ruleId, message}) =>
        ruleId === RULE_IDS.factReference && message.includes('@example/missing'),
    );
    assert.ok(missingPackageDiagnostic);
    assert.equal(missingPackageDiagnostic.source, '@example/local-implementation');
    assert.equal(missingPackageDiagnostic.target, '@example/missing');

    const mismatchedClassification = acceptedConfiguration();
    const classification = mismatchedClassification.localPackages[0];
    assert.ok(classification);
    classification.boundedContext = 'shipping';
    const mismatchDiagnostics = evaluateArchitecturePolicy(acceptedFacts, mismatchedClassification);
    assert.ok(mismatchDiagnostics.some(({ruleId}) => ruleId === RULE_IDS.metadataRequired));

    const missingClassification = acceptedConfiguration();
    const missingClassificationEntry = missingClassification.localPackages[0];
    assert.ok(missingClassificationEntry);
    missingClassificationEntry.path = 'packages/missing';
    const missingClassificationDiagnostics = evaluateArchitecturePolicy(
      acceptedFacts,
      missingClassification,
    );
    assert.ok(
      missingClassificationDiagnostics.some(
        ({ruleId, message}) =>
          ruleId === RULE_IDS.factReference && message.includes('packages/missing'),
      ),
    );
  });

  test('requires composition facts to be declared by configured roots', () => {
    const configuration = acceptedConfiguration();
    configuration.compositionRoots = ['@example/another-root'];
    const diagnostics = evaluateArchitecturePolicy(acceptedFacts, configuration);
    assert.ok(
      diagnostics.some(
        ({ruleId, message}) =>
          ruleId === RULE_IDS.compositionOwner && message.includes('non-root package'),
      ),
    );
  });

  test('applies one exact exception to one composition-owner finding', () => {
    const facts = structuredClone(acceptedFacts);
    const compositionFact = facts.compositionFacts[0];
    assert.ok(compositionFact);
    compositionFact.contributionOwner = '@example/missing-contribution';
    compositionFact.explicitCoordinator = '@example/missing-coordinator';

    const configuration = acceptedConfiguration();
    const unsuppressed = evaluateArchitecturePolicy(facts, configuration);
    assert.equal(unsuppressed.filter(({ruleId}) => ruleId === RULE_IDS.compositionOwner).length, 2);

    configuration.exceptions = [
      {
        ruleId: RULE_IDS.compositionOwner,
        source: '@example/local-implementation',
        target: '@example/installed-implementation',
        owner: '@example/local-implementation',
        reason: 'The composition migration is tracked explicitly.',
        trackingIssue: 'ENG-1212',
        removalCondition: null,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    ];
    const partiallySuppressed = evaluateArchitecturePolicy(facts, configuration, {
      now: '2026-07-23T00:00:00.000Z',
    });
    const remainingCompositionDiagnostics = partiallySuppressed.filter(
      ({ruleId}) => ruleId === RULE_IDS.compositionOwner,
    );
    assert.equal(remainingCompositionDiagnostics.length, 1);
    assert.equal(remainingCompositionDiagnostics[0]?.facts.invalidField, 'explicitCoordinator');
  });

  test('requires complete exact exception metadata and rejects stale exceptions', () => {
    const configuration = acceptedConfiguration();
    const exception: ExactException = {
      ruleId: RULE_IDS.foreignImplementation,
      source: '@example/local-implementation',
      target: '@example/installed-implementation',
      owner: '@example/local-implementation',
      reason: 'Migration is tracked in the architecture issue.',
      trackingIssue: 'ENG-1212',
      removalCondition: null,
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    configuration.exceptions = [exception];
    const diagnostics = evaluateArchitecturePolicy(acceptedFacts, configuration, {
      now: '2026-07-23T00:00:00.000Z',
    });
    assert.ok(diagnostics.some(({ruleId}) => ruleId === RULE_IDS.exceptionValidity));

    const invalid = {...exception, source: '@example/*'};
    assert.ok(
      validateRepositoryConfiguration({...configuration, exceptions: [invalid]}).some((error) =>
        error.includes('exact facts'),
      ),
    );

    const validException = {...exception, expiresAt: '2099-01-01T00:00:00.000Z'};
    const exceptionConfiguration = {...acceptedConfiguration(), exceptions: [validException]};
    const forbiddenFacts = structuredClone(acceptedFacts);
    const installedPackage = forbiddenFacts.packages.find(
      ({name}) => name === '@example/installed-implementation',
    );
    assert.ok(installedPackage);
    installedPackage.boundedContext = 'different-context';
    const suppressed = evaluateArchitecturePolicy(forbiddenFacts, exceptionConfiguration, {
      now: '2026-07-23T00:00:00.000Z',
    });
    assert.equal(
      suppressed.some(({ruleId}) => ruleId === RULE_IDS.foreignImplementation),
      false,
    );
  });

  test('checks export intent and explicit composition ownership', () => {
    const facts = structuredClone(acceptedFacts);
    const publicExport = facts.publicExports[0];
    const compositionFact = facts.compositionFacts[0];
    assert.ok(publicExport);
    assert.ok(compositionFact);
    publicExport.resolvedTarget = null;
    compositionFact.explicitCoordinator = null;
    const diagnostics = evaluateArchitecturePolicy(facts, acceptedConfiguration());
    assert.ok(diagnostics.some(({ruleId}) => ruleId === RULE_IDS.exportIntent));
    assert.ok(diagnostics.some(({ruleId}) => ruleId === RULE_IDS.compositionOwner));
  });

  test('exposes a stable serializable rule catalog', () => {
    const catalog = getRuleCatalog();
    assert.deepEqual(catalog, RULE_CATALOG);
    assert.equal(catalog.schemaVersion, architecturePolicySchemaVersion);
    assert.match(serializeRuleCatalog(), realmRulePattern);
    assert.equal(new Set(catalog.rules.map(({id}) => id)).size, catalog.rules.length);
  });

  test('exports runtime validators and type guards for both contracts', () => {
    const configuration = acceptedConfiguration();
    assert.equal(isArchitectureFacts(acceptedFacts), true);
    assert.equal(isRepositoryConfiguration(configuration), true);
    assert.equal(isArchitectureFacts({}), false);
    assert.equal(isRepositoryConfiguration(null), false);
    assert.doesNotThrow(() => assertArchitectureFacts(acceptedFacts));
    assert.doesNotThrow(() => assertRepositoryConfiguration(configuration));
    assert.throws(() => assertArchitectureFacts({}), architectureFactsErrorPattern);
    assert.throws(() => assertRepositoryConfiguration(null), repositoryConfigurationErrorPattern);
  });
});
