import {
  ASTVisitor,
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLError,
  OperationDefinitionNode,
  SelectionSetNode,
  ValidationContext,
  ValidationRule,
} from 'graphql';

export interface GraphqlQueryLimits {
  maxDepth: number;
  maxAliases: number;
  maxRootFields: number;
  maxComplexity: number;
}

interface QueryMetrics {
  depth: number;
  aliases: number;
  rootFields: number;
  complexity: number;
}

const FIELD_COST: Readonly<Record<string, number>> = {
  // Both root operations may cause geocoding, cache refresh and three providers.
  activityForecast: 20,
  activityRecommendations: 20,
  // Lists and evidence carry more response amplification than scalar fields.
  activities: 5,
  days: 5,
  recommendations: 5,
  evidence: 2,
  checksBeforeBooking: 2,
  location: 2,
  dataFreshness: 2,
};

/** Static, deterministic demand control evaluated before a resolver is called. */
export function createQueryLimitsRule(
  limits: GraphqlQueryLimits,
): ValidationRule {
  return (context: ValidationContext): ASTVisitor => ({
    Document: {
      enter(document: DocumentNode) {
        const fragments = new Map<string, FragmentDefinitionNode>();
        for (const definition of document.definitions) {
          if (definition.kind === 'FragmentDefinition') {
            fragments.set(definition.name.value, definition);
          }
        }

        for (const definition of document.definitions) {
          if (definition.kind !== 'OperationDefinition') continue;
          const metrics = measureOperation(definition, fragments);
          reportLimit(
            context,
            definition,
            'depth',
            metrics.depth,
            limits.maxDepth,
          );
          reportLimit(
            context,
            definition,
            'aliases',
            metrics.aliases,
            limits.maxAliases,
          );
          reportLimit(
            context,
            definition,
            'root fields',
            metrics.rootFields,
            limits.maxRootFields,
          );
          reportLimit(
            context,
            definition,
            'complexity',
            metrics.complexity,
            limits.maxComplexity,
          );
        }
      },
    },
  });
}

function measureOperation(
  operation: OperationDefinitionNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
): QueryMetrics {
  const metrics: QueryMetrics = {
    depth: 0,
    aliases: 0,
    rootFields: 0,
    complexity: 0,
  };
  measureSelectionSet(
    operation.selectionSet,
    1,
    true,
    fragments,
    new Set(),
    metrics,
  );
  return metrics;
}

function measureSelectionSet(
  selectionSet: SelectionSetNode,
  depth: number,
  atRoot: boolean,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  fragmentPath: ReadonlySet<string>,
  metrics: QueryMetrics,
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      measureField(selection, depth, atRoot, fragments, fragmentPath, metrics);
      continue;
    }
    if (selection.kind === 'InlineFragment') {
      measureSelectionSet(
        selection.selectionSet,
        depth,
        atRoot,
        fragments,
        fragmentPath,
        metrics,
      );
      continue;
    }

    const fragmentName = selection.name.value;
    const fragment = fragments.get(fragmentName);
    // GraphQL's standard validation reports unknown/cyclic fragments. The path
    // set also guarantees this cost walk cannot recurse forever.
    if (!fragment || fragmentPath.has(fragmentName)) continue;
    measureSelectionSet(
      fragment.selectionSet,
      depth,
      atRoot,
      fragments,
      new Set([...fragmentPath, fragmentName]),
      metrics,
    );
  }
}

function measureField(
  field: FieldNode,
  depth: number,
  atRoot: boolean,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  fragmentPath: ReadonlySet<string>,
  metrics: QueryMetrics,
): void {
  const name = field.name.value;
  // Local GraphiQL needs an introspection query. Production separately disables
  // introspection, so meta-fields do not need to consume the product budget.
  if (name.startsWith('__')) return;

  metrics.depth = Math.max(metrics.depth, depth);
  metrics.complexity += FIELD_COST[name] ?? 1;
  if (field.alias) metrics.aliases += 1;
  if (atRoot) metrics.rootFields += 1;
  if (field.selectionSet) {
    measureSelectionSet(
      field.selectionSet,
      depth + 1,
      false,
      fragments,
      fragmentPath,
      metrics,
    );
  }
}

function reportLimit(
  context: ValidationContext,
  operation: OperationDefinitionNode,
  name: string,
  actual: number,
  limit: number,
): void {
  if (actual <= limit) return;
  context.reportError(
    new GraphQLError(
      `GraphQL ${name} ${actual} exceeds the configured maximum of ${limit}`,
      {
        nodes: operation,
        extensions: {
          code: 'QUERY_LIMIT_EXCEEDED',
          limitType: name.replace(' ', '_').toUpperCase(),
          limit,
          actual,
        },
      },
    ),
  );
}
