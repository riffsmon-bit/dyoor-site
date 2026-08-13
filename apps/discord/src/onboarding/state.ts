export const onboardingStates = [
  "NEW",
  "SCREENING_COMPLETE",
  "VISITOR",
  "HOLDER",
  "FLAGGED",
] as const;

export type OnboardingState = (typeof onboardingStates)[number];

const allowedTransitions: Readonly<Record<OnboardingState, readonly OnboardingState[]>> = {
  NEW: ["SCREENING_COMPLETE", "FLAGGED"],
  SCREENING_COMPLETE: ["VISITOR", "FLAGGED"],
  VISITOR: ["HOLDER", "FLAGGED"],
  HOLDER: ["VISITOR", "FLAGGED"],
  FLAGGED: ["SCREENING_COMPLETE"],
};

export function canTransition(from: OnboardingState, to: OnboardingState): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

export function transitionOnboarding(from: OnboardingState, to: OnboardingState): OnboardingState {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid onboarding transition: ${from} → ${to}`);
  }
  return to;
}
