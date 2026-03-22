import { useEffect } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import { BusinessHoursSchedule, BusinessHoursStatus } from '../types';
import { createDefaultBusinessHoursSchedule } from '../utils/businessHours';

export function useBusinessHours() {
  const activeMembershipId = useStore((state) => state.activeMembershipId);
  const setBusinessHoursStatus = useStore((state) => state.setBusinessHoursStatus);
  const storeStatus = useStore((state) => state.businessHoursStatus);

  const query = trpc.partner.getBusinessHours.useQuery(undefined, {
    enabled: !!activeMembershipId,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (query.data?.status) {
      setBusinessHoursStatus(query.data.status as BusinessHoursStatus);
    }
  }, [query.data, setBusinessHoursStatus]);

  return {
    schedule: (query.data?.schedule as BusinessHoursSchedule | null) ?? createDefaultBusinessHoursSchedule(),
    status: (query.data?.status as BusinessHoursStatus | null) ?? storeStatus,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
