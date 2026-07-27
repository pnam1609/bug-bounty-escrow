'use client';

import { useState } from 'react';

import { OwnerWorkspace } from '@/components/owner/owner-workspace';
import { createEmptyDraft } from '@/components/owner/program-draft';
import { ProgramWizard } from '@/components/owner/program-wizard';
import { RoleGuard } from '@/components/role-guard';

/**
 * CP-01 … CP-08 — the seven-step Create Program wizard.
 *
 * Nothing here talks to the API before the Review step: `ProgramWizard` holds the whole nested
 * draft in client state so Back/Next never loses a field and a failed save can retry the exact
 * same payload.
 */
export default function NewProgramPage() {
  const [initialDraft] = useState(createEmptyDraft);

  return (
    <RoleGuard allow={['owner']}>
      <OwnerWorkspace>
        <ProgramWizard initialDraft={initialDraft} />
      </OwnerWorkspace>
    </RoleGuard>
  );
}
