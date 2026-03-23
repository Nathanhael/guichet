import useStore from '../store/useStore';
import { PartnerManifest } from '../types';
import { isPlatformAdmin } from '../utils/roles';

export function usePartner() {
  const { user, memberships, activeMembershipId } = useStore();
  
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  
  const manifest: PartnerManifest = activeMembership?.manifest || {
    industry: 'general',
    departments: []
  };

  const partnerName = activeMembership?.partnerName || 'Platform';
  const role = activeMembership?.role || 'platform_operator';
  const dept = activeMembership?.dept;
  const platformAdmin = isPlatformAdmin(user);

  return {
    manifest,
    partnerName,
    partnerId: activeMembership?.partnerId,
    role,
    dept,
    isPlatformOperator: platformAdmin
  };
}
