import { OwnerProgramList } from '@/components/owner/owner-program-list';
import { OwnerWorkspace } from '@/components/owner/owner-workspace';
import { RoleGuard } from '@/components/role-guard';

/**
 * OWNER-01 · Programs landing (Figma 82:234) and CP-00 in the create-program flow: the entry
 * point whose primary CTA opens `/owner/programs/new`.
 *
 * `RoleGuard` stays outside the workspace chrome so a researcher deep link lands on the safe
 * forbidden screen without the owner rail ever rendering behind it (CP-09).
 */
export default function OwnerProgramsPage() {
  return (
    <RoleGuard allow={['owner']}>
      <OwnerWorkspace>
        <OwnerProgramList />
      </OwnerWorkspace>
    </RoleGuard>
  );
}
