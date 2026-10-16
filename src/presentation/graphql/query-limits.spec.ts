import { buildSchema, parse, specifiedRules, validate } from 'graphql';
import { createQueryLimitsRule, GraphqlQueryLimits } from './query-limits';

const schema = buildSchema(`
  type Item { value: Int, child: Item }
  type Query {
    ping: Int
    activityForecast: Item
    activityRecommendations: Item
  }
`);

const generous: GraphqlQueryLimits = {
  maxDepth: 8,
  maxAliases: 15,
  maxRootFields: 4,
  maxComplexity: 100,
};

function errors(query: string, limits: Partial<GraphqlQueryLimits>) {
  return validate(schema, parse(query), [
    ...specifiedRules,
    createQueryLimitsRule({ ...generous, ...limits }),
  ]);
}

describe('GraphQL query demand limits', () => {
  it('accepts a normal product query', () => {
    expect(
      errors('{ activityRecommendations { value child { value } } }', {}),
    ).toEqual([]);
  });

  it('rejects excessive depth', () => {
    const result = errors(
      '{ activityForecast { child { child { value } } } }',
      { maxDepth: 3 },
    );
    expect(result[0].extensions).toMatchObject({
      code: 'QUERY_LIMIT_EXCEEDED',
      limitType: 'DEPTH',
      actual: 4,
    });
  });

  it('rejects excessive aliases even when introduced by a fragment', () => {
    const result = errors(
      '{ ...Fields ...Fields } fragment Fields on Query { first: ping }',
      { maxAliases: 1 },
    );
    expect(result[0].extensions).toMatchObject({
      code: 'QUERY_LIMIT_EXCEEDED',
      limitType: 'ALIASES',
      actual: 2,
    });
  });

  it('rejects excessive root fields', () => {
    const result = errors('{ ping activityForecast { value } }', {
      maxRootFields: 1,
    });
    expect(result[0].extensions).toMatchObject({
      code: 'QUERY_LIMIT_EXCEEDED',
      limitType: 'ROOT_FIELDS',
      actual: 2,
    });
  });

  it('applies weighted complexity to provider-backed root fields', () => {
    const result = errors('{ activityForecast { value child { value } } }', {
      maxComplexity: 22,
    });
    expect(result[0].extensions).toMatchObject({
      code: 'QUERY_LIMIT_EXCEEDED',
      limitType: 'COMPLEXITY',
      actual: 23,
    });
  });
});
