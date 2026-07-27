import type { Metadata } from 'next';

import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';

export const metadata: Metadata = {
  title: 'Set up your account · BountyEscrow',
  description: 'Choose the workspace that matches how you want to participate.',
};

/**
 * `/onboarding` — Figma section 79:150, frames ONB-00 to ONB-06.
 *
 * The route itself is a server component with nothing but the title on it; everything that depends
 * on the session or the profile lives in `OnboardingFlow`, which renders a skeleton until both are
 * known (§3: no protected content while the profile is loading).
 */
export default function OnboardingPage() {
  return <OnboardingFlow />;
}
