import { describe, expect, it } from 'vitest';

import {
  getReportAccessFailure,
  REPORTS_ACCESS_DENIED_HREF,
  REPORTS_LOGIN_HREF,
  reportAccessDestination,
} from '@/components/reports/report-access';
import { ApiClientError } from '@/lib/api-client';

describe('MR-09 report authorization recovery', () => {
  it('routes anonymous and expired sessions to sign-in with the fixed safe My Reports return URL', () => {
    expect(REPORTS_LOGIN_HREF).toBe('/login?returnTo=%2Freports');
    expect(getReportAccessFailure(new ApiClientError(401, 'anything', 'server detail'))).toBe(
      'unauthorized',
    );
    expect(reportAccessDestination('unauthorized')).toBe(REPORTS_LOGIN_HREF);
  });

  it('routes forbidden list responses to the generic access-denied surface', () => {
    expect(REPORTS_ACCESS_DENIED_HREF).toBe('/access-denied?from=%2Freports');
    expect(getReportAccessFailure(new ApiClientError(403, 'policy_name', 'database detail'))).toBe(
      'forbidden',
    );
    expect(reportAccessDestination('forbidden')).toBe(REPORTS_ACCESS_DENIED_HREF);
  });

  it('ignores server error copy and leaves ordinary failures retryable inline', () => {
    expect(getReportAccessFailure(new ApiClientError(500, 'db_error', 'policy internals'))).toBeNull();
    expect(getReportAccessFailure(new Error('network unavailable'))).toBeNull();
  });
});
