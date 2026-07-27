import { z } from 'zod';

export type EnvironmentScope = 'web' | 'api';

export interface EnvironmentValidationIssue {
  readonly variable: string;
  readonly reason: 'Missing or invalid value' | 'Required for selected configuration';
}

type ZodIssue = z.ZodError['issues'][number];

function createRedactedIssue(issue: ZodIssue): EnvironmentValidationIssue {
  return {
    variable: issue.path.length > 0 ? issue.path.map(String).join('.') : '<environment>',
    reason:
      issue.code === 'custom' ? 'Required for selected configuration' : 'Missing or invalid value',
  };
}

export class EnvironmentValidationError extends Error {
  public readonly scope: EnvironmentScope;
  public readonly issues: readonly EnvironmentValidationIssue[];

  public constructor(scope: EnvironmentScope, issues: readonly EnvironmentValidationIssue[]) {
    const variables = [...new Set(issues.map((issue) => issue.variable))];

    super(`Invalid ${scope} environment variables: ${variables.join(', ')}`);

    this.name = 'EnvironmentValidationError';
    this.scope = scope;
    this.issues = issues;
  }
}

export function parseEnvironment<TSchema extends z.ZodType>(
  scope: EnvironmentScope,
  schema: TSchema,
  input: Readonly<Record<string, unknown>>,
): z.output<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new EnvironmentValidationError(scope, result.error.issues.map(createRedactedIssue));
  }

  return result.data;
}
