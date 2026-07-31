import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AiReviewWorker } from '@bug-bounty-escrow/ai';

import { AI_REVIEW_WORKER } from './ai-review.tokens.js';

/**
 * Best-effort in-process queue pump. Claims remain durable and lease-protected, so running more
 * than one API replica is safe; deployments can disable this runner and use a dedicated worker.
 */
@Injectable()
export class AiReviewWorkerRunner implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  public constructor(@Inject(AI_REVIEW_WORKER) private readonly worker: AiReviewWorker) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.worker.drain(10).catch(() => undefined);
    }, 5_000);
    this.timer.unref();
    void this.worker.drain(10).catch(() => undefined);
  }

  public onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }
}
