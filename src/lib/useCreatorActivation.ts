import type { Me, Earnings, MissionMatch, MyMission } from "./queries/kocmax";
import {
  useEarnings,
  useMe,
  useMissionMatch,
  useMyMissions,
  useOnboardingStatus,
  useSocialAccounts,
} from "./queries/kocmax";
import {
  deriveCreatorActivation,
  type ActivationMilestone,
  type CreatorActivationSnapshot,
} from "./creatorActivation";

type Refetch = () => Promise<unknown>;

export type CreatorActivationQuerySection<T> = {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: Refetch;
};

export type CreatorReadiness = {
  readinessPercent: number;
  completedReadinessWeight: number;
  totalReadinessWeight: 100;
  milestones: ActivationMilestone[];
};

export type UseCreatorActivationResult = {
  snapshot: CreatorActivationSnapshot;
  me: CreatorActivationQuerySection<Me>;
  activeMissions: CreatorActivationQuerySection<MyMission[]>;
  recommendations: CreatorActivationQuerySection<MissionMatch[]>;
  earnings: CreatorActivationQuerySection<Earnings>;
  readiness: CreatorActivationQuerySection<CreatorReadiness>;
};

type QueryShape<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: Refetch;
};

function section<T>(query: QueryShape<T>, data: T | undefined = query.data): CreatorActivationQuerySection<T> {
  return {
    data,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreatorActivation(): UseCreatorActivationResult {
  const meQuery = useMe();
  const onboardingQuery = useOnboardingStatus();
  const socialQuery = useSocialAccounts();
  const missionsQuery = useMyMissions();
  const recommendationsQuery = useMissionMatch();
  const earningsQuery = useEarnings();

  const snapshot = deriveCreatorActivation({
    me: meQuery.data,
    onboarding: onboardingQuery.data,
    socialAccounts: socialQuery.data,
    myMissions: missionsQuery.data,
    missionMatches: recommendationsQuery.data,
  });
  const readiness: CreatorReadiness = {
    readinessPercent: snapshot.readinessPercent,
    completedReadinessWeight: snapshot.completedReadinessWeight,
    totalReadinessWeight: snapshot.totalReadinessWeight,
    milestones: snapshot.milestones,
  };

  return {
    snapshot,
    me: section(meQuery),
    activeMissions: section(missionsQuery),
    recommendations: section(recommendationsQuery, snapshot.suitableMissions),
    earnings: section(earningsQuery),
    readiness: {
      data: readiness,
      loading: meQuery.isLoading || onboardingQuery.isLoading || socialQuery.isLoading,
      error: meQuery.error ?? onboardingQuery.error ?? socialQuery.error,
      refetch: async () => {
        await Promise.all([meQuery.refetch(), onboardingQuery.refetch(), socialQuery.refetch()]);
      },
    },
  };
}
