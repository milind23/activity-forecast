import { createHash, timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Request } from 'express';
import { GraphQLError } from 'graphql';
import { ApiKeyPolicy, AppConfig } from '../../config/configuration';
import { REQUIRED_SCOPES } from './required-scopes.decorator';

export interface ApiPrincipal {
  subject: string;
  scopes: string[];
}

type AuthenticatedRequest = Request & { apiPrincipal?: ApiPrincipal };

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly cfg: AppConfig;

  constructor(
    config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.cfg.authRequired) return true;

    const request = GqlExecutionContext.create(context).getContext<{
      req?: AuthenticatedRequest;
    }>().req;
    if (!request) throw unauthenticated();

    const presented = readCredential(request);
    if (!presented) throw unauthenticated();

    const policy = matchCredential(presented, this.cfg.apiKeys);
    if (!policy) throw unauthenticated();

    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = required.filter((scope) => !policy.scopes.includes(scope));
    if (missing.length > 0) {
      throw new GraphQLError('The API credential lacks the required scope', {
        extensions: { code: 'FORBIDDEN', requiredScopes: required },
      });
    }

    request.apiPrincipal = {
      subject: policy.subject,
      scopes: [...policy.scopes],
    };
    return true;
  }
}

function readCredential(request: Request): string | null {
  const authorization = request.header('authorization');
  const apiKey = request.header('x-api-key');
  // Ambiguous credentials are rejected rather than choosing one implicitly.
  if (authorization && apiKey) return null;
  if (apiKey) return apiKey.trim() || null;
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function matchCredential(
  presented: string,
  policies: ApiKeyPolicy[],
): ApiKeyPolicy | null {
  const candidateDigest = digest(presented);
  let match: ApiKeyPolicy | null = null;
  // Compare every configured key to avoid making the matching key's position observable.
  for (const policy of policies) {
    if (timingSafeEqual(candidateDigest, digest(policy.key))) match = policy;
  }
  return match;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function unauthenticated(): GraphQLError {
  return new GraphQLError('A valid API credential is required', {
    extensions: { code: 'UNAUTHENTICATED' },
  });
}
