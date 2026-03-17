import useStore from '../store/useStore';
import { PartnerManifest } from '../types';

export function usePartner() {
  const { memberships, activeMembershipId } = useStore();
  
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  
  const manifest: PartnerManifest = activeMembership?.manifest || {
    industry: 'general',
    ref1Label: 'Reference 1',
    ref2Label: 'Reference 2',
    departments: []
  };

  const partnerName = activeMembership?.partnerName || 'Platform';
  const role = activeMembership?.role || 'platform_operator';
  const dept = activeMembership?.dept;

  return {
    manifest,
    partnerName,
    partnerId: activeMembership?.partnerId,
    role,
    dept,
    isPlatformOperator: role === 'platform_operator'
  };
}
