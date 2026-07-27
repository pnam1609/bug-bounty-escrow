import { DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

export const API_CONFIG = Symbol('API_CONFIG');

@Global()
@Module({})
export class ApiConfigModule {
  public static forRoot(config: ApiEnvironment): DynamicModule {
    const validatedConfig = Object.freeze({ ...config });

    return {
      module: ApiConfigModule,
      providers: [
        {
          provide: API_CONFIG,
          useValue: validatedConfig,
        },
      ],
      exports: [API_CONFIG],
    };
  }
}
