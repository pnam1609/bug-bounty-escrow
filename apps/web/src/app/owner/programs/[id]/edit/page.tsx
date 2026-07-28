'use client';

import { programResponseSchema } from '@bug-bounty-escrow/shared';
import { Button, Callout } from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { OwnerWorkspace } from '@/components/owner/owner-workspace';
import { draftFromProgram, type ProgramDraft } from '@/components/owner/program-draft';
import { ProgramLifecycle } from '@/components/owner/program-lifecycle';
import { ProgramWizard } from '@/components/owner/program-wizard';
import { RoleGuard } from '@/components/role-guard';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/**
 * CP-06 · Draft created / edit landing, plus CP-10 – CP-13.
 *
 * The route lands here from `router.replace` once `POST /api/programs` has returned a program, so
 * the id that deploy and fund both require always exists by the time those actions are offered.
 * `Edit program` reopens the same wizard against the saved draft and submits a PATCH.
 */
function EditProgramWorkspace({
  onBlockingPendingChange,
}: {
  readonly onBlockingPendingChange: (pending: boolean) => void;
}) {
  const id = String(useParams<{ id: string }>().id);
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const [editDraft, setEditDraft] = useState<ProgramDraft | null>(null);

  const query = useQuery({
    queryKey: queryKeys.ownerProgram(session?.user.id ?? 'no-session', id),
    enabled: session !== null,
    queryFn: () =>
      apiRequest(`/api/owner/programs/${id}`, programResponseSchema, {
        token: session?.access_token,
      }),
  });

  if (query.isLoading || query.data === undefined) {
    if (query.isError) {
      return (
        <Callout title="Program could not be loaded" variant="danger">
          <Button className="mt-md" onClick={() => void query.refetch()} variant="secondary">
            Try again
          </Button>
        </Callout>
      );
    }

    return (
      <p aria-live="polite" className="text-body-sm text-text-muted">
        Loading program…
      </p>
    );
  }

  const program = query.data.data;

  if (editDraft !== null) {
    return (
      <ProgramWizard
        initialDraft={editDraft}
        onClose={() => setEditDraft(null)}
        program={program}
      />
    );
  }

  return (
    <ProgramLifecycle
      logoFailed={searchParams.get('logo') === 'failed'}
      onBlockingPendingChange={onBlockingPendingChange}
      onEditProgram={() => setEditDraft(draftFromProgram(program))}
      program={program}
      showCreatedBanner={searchParams.get('created') === '1'}
    />
  );
}

function EditProgramContent() {
  const [navigationLocked, setNavigationLocked] = useState(false);

  return (
    <OwnerWorkspace navigationLocked={navigationLocked}>
      <Suspense
        fallback={
          <p aria-live="polite" className="text-body-sm text-text-muted">
            Loading program…
          </p>
        }
      >
        <EditProgramWorkspace onBlockingPendingChange={setNavigationLocked} />
      </Suspense>
    </OwnerWorkspace>
  );
}

export default function EditProgramPage() {
  return (
    <RoleGuard allow={['owner']}>
      <EditProgramContent />
    </RoleGuard>
  );
}
