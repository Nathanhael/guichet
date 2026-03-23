import { useMemo, useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import useStore from '../../store/useStore';

const SECURITY_ACTIONS = new Set([
  'partner.created',
  'partner.deactivated',
  'partner.reactivated',
  'partner.deleted',
  'platform.enter_partner',
  'member.added',
  'member.invited',
  'member.removed',
  'member.updated',
  'user.sessions_revoked',
  'user.deleted',
  'sso.group_mapping_added',
  'sso.group_mapping_updated',
  'sso.group_mapping_removed',
]);

function summarizeEvent(action: string, metadata: unknown, targetId: string | null) {
  const meta = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};

  switch (action) {
    case 'user.sessions_revoked':
      return `Revoked all sessions for ${targetId || 'user'}`;
    case 'platform.enter_partner':
      return `Entered tenant ${targetId || '-'}`;
    case 'member.updated':
      return `Membership role ${String(meta.oldRole || '?')} -> ${String(meta.newRole || '?')}`;
    case 'member.removed':
      return `Removed membership ${String(meta.membershipId || targetId || '-')}`;
    case 'partner.deactivated':
      return 'Tenant deactivated';
    case 'partner.deleted':
      return 'Tenant deleted';
    case 'sso.group_mapping_added':
      return `Added Azure group ${String(meta.azureGroupId || '-')}`;
    default:
      return JSON.stringify(meta);
  }
}

export default function PlatformSecurityOps() {
  const t = useT();
  const { setToken } = useStore();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [setupSecret, setSetupSecret] = useState<{ manualEntryKey: string; otpauthUrl: string } | null>(null);
  const utils = trpc.useUtils();

  const { data: status, isLoading: statusLoading } = trpc.platformSecurity.getStatus.useQuery();
  const { data: users } = trpc.platform.listGlobalUsers.useQuery(undefined, {
    enabled: !!status?.stepUpSatisfied,
  });
  const { data: auditData, isLoading } = trpc.platform.getAuditLog.useQuery({ limit: 20 }, {
    enabled: !!status?.stepUpSatisfied,
  });

  const beginSetup = trpc.platformSecurity.beginSetup.useMutation({
    onSuccess: (data) => {
      setSetupSecret(data);
      setVerificationCode('');
    },
  });

  const enableMfa = trpc.platformSecurity.enable.useMutation({
    onSuccess: async (data) => {
      setToken(data.token);
      setSetupSecret(null);
      setVerificationCode('');
      await utils.platformSecurity.getStatus.invalidate();
      await utils.platform.getAuditLog.invalidate();
    },
  });

  const verifyStepUp = trpc.platformSecurity.verify.useMutation({
    onSuccess: async (data) => {
      setToken(data.token);
      setVerificationCode('');
      await utils.platformSecurity.getStatus.invalidate();
      await utils.platform.getAuditLog.invalidate();
    },
  });

  const revokeSessions = trpc.user.revokeSessions.useMutation({
    onSuccess: async () => {
      await utils.platform.getAuditLog.invalidate();
      setConfirmOpen(false);
      setSelectedUserId('');
    },
  });

  const visibleUsers = useMemo(
    () => (users || []).filter((user) => !user.deletedAt),
    [users]
  );

  const selectedUser = visibleUsers.find((user) => user.id === selectedUserId) || null;
  const securityEvents = (auditData?.items || []).filter((event) => SECURITY_ACTIONS.has(event.action));
  const stepUpFormBusy = beginSetup.isPending || enableMfa.isPending || verifyStepUp.isPending;

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tighter">{t('security_tab')}</h2>
        <p className="text-xs uppercase font-bold opacity-60 mt-1 tracking-widest">
          Centralized controls for incident response and privileged session containment.
        </p>
      </div>

      <section className="border-2 border-black dark:border-white p-6 space-y-4">
        <div>
          <h3 className="text-lg font-black uppercase tracking-widest">Platform Step-Up</h3>
          <p className="text-[10px] uppercase opacity-60 mt-1">
            Platform admin actions now require a recent TOTP verification. Complete setup once, then verify to unlock the rest of this view.
          </p>
        </div>

        {statusLoading ? (
          <div className="text-[10px] font-black uppercase opacity-50">{t('loading_log')}</div>
        ) : !status?.mfaEnabled ? (
          <div className="space-y-4">
            <div className="text-[10px] uppercase opacity-70">
              {setupSecret
                ? 'Add this manual key to your authenticator app, then enter a 6-digit code to enable step-up.'
                : 'Start platform MFA setup to protect cross-tenant admin access.'}
            </div>

            {setupSecret && (
              <div className="border border-black dark:border-white p-4 space-y-2">
                <div>
                  <div className="text-[10px] uppercase opacity-50">Manual Entry Key</div>
                  <div className="font-mono text-sm tracking-widest break-all">{setupSecret.manualEntryKey}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase opacity-50">OTPAuth URL</div>
                  <div className="font-mono text-[10px] break-all opacity-80">{setupSecret.otpauthUrl}</div>
                </div>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-4 md:items-end">
              <button
                onClick={() => beginSetup.mutate()}
                disabled={stepUpFormBusy}
                className="px-6 py-3 border-2 border-black dark:border-white bg-white dark:bg-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
              >
                {beginSetup.isPending ? 'Starting...' : setupSecret ? 'Reset Setup Key' : 'Start Setup'}
              </button>

              <div className="flex-1">
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Verification Code</label>
                <input
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="123456"
                  className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-3 text-sm font-mono outline-none"
                />
              </div>

              <button
                onClick={() => enableMfa.mutate({ code: verificationCode })}
                disabled={!setupSecret || verificationCode.trim().length < 6 || stepUpFormBusy}
                className="px-6 py-3 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
              >
                {enableMfa.isPending ? 'Enabling...' : 'Enable Step-Up'}
              </button>
            </div>

            {(beginSetup.error || enableMfa.error) && (
              <div className="text-[10px] uppercase text-red-700 dark:text-red-300">
                {(beginSetup.error || enableMfa.error)?.message}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-end gap-4">
              <div className="flex-1">
                <div className="text-[10px] uppercase opacity-50">Step-Up Status</div>
                <div className="text-sm font-bold uppercase">
                  {status.stepUpSatisfied
                    ? `Verified until ${status.stepUpExpiresAt ? new Date(status.stepUpExpiresAt).toLocaleTimeString() : '-'}`
                    : 'Verification required'}
                </div>
              </div>

              <div className="flex-1">
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Verification Code</label>
                <input
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="123456"
                  className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-3 text-sm font-mono outline-none"
                />
              </div>

              <button
                onClick={() => verifyStepUp.mutate({ code: verificationCode })}
                disabled={verificationCode.trim().length < 6 || stepUpFormBusy}
                className="px-6 py-3 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
              >
                {verifyStepUp.isPending ? 'Verifying...' : status.stepUpSatisfied ? 'Refresh Step-Up' : 'Verify Step-Up'}
              </button>
            </div>

            {verifyStepUp.error && (
              <div className="text-[10px] uppercase text-red-700 dark:text-red-300">{verifyStepUp.error.message}</div>
            )}
          </div>
        )}
      </section>

      <section className={`border-2 border-black dark:border-white p-6 space-y-4 ${status?.stepUpSatisfied ? '' : 'opacity-40'}`}>
        <div>
          <h3 className="text-lg font-black uppercase tracking-widest">Session Containment</h3>
          <p className="text-[10px] uppercase opacity-60 mt-1">
            Force sign-out all active sessions for a selected user. Use this for compromise response, break-glass cleanup, or access containment.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">User</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-3 text-sm font-bold outline-none"
            >
              <option value="">Select user</option>
              {visibleUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email || user.id})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!status?.stepUpSatisfied || !selectedUserId || revokeSessions.isPending}
            className="px-6 py-3 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
          >
            {revokeSessions.isPending ? 'Revoking...' : 'Revoke Sessions'}
          </button>
        </div>

        <div className="border-t border-black/10 dark:border-white/10 pt-4 text-[10px] uppercase opacity-60 space-y-1">
          <p>Break-glass recovery should be followed by full session revocation and password rotation.</p>
          <p>See `docs/BREAK_GLASS_RUNBOOK.md` for the operating procedure.</p>
        </div>
      </section>

      <section className={`border-2 border-black dark:border-white p-6 space-y-4 ${status?.stepUpSatisfied ? '' : 'opacity-40'}`}>
        <div>
          <h3 className="text-lg font-black uppercase tracking-widest">Recent Security Events</h3>
          <p className="text-[10px] uppercase opacity-60 mt-1">
            Latest privileged changes across tenant access, lifecycle actions, SSO mappings, and forced sign-outs.
          </p>
        </div>

        {!status?.stepUpSatisfied ? (
          <div className="py-6 text-center uppercase font-black opacity-50">Complete step-up to view privileged audit data.</div>
        ) : isLoading ? (
          <div className="py-6 text-center uppercase font-black opacity-50">{t('loading_log')}</div>
        ) : (
          <div className="border border-black dark:border-white overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_time')}</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_action')}</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_actor')}</th>
                  <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 dark:divide-white/10">
                {securityEvents.map((event) => (
                  <tr key={event.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                    <td className="p-3 text-[10px] font-mono whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="p-3 text-xs font-bold uppercase">{event.action}</td>
                    <td className="p-3 text-xs uppercase">{event.actorName || t('system')}</td>
                    <td className="p-3 text-[10px] opacity-80">{summarizeEvent(event.action, event.metadata, event.targetId)}</td>
                  </tr>
                ))}
                {securityEvents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-[10px] font-black uppercase tracking-widest opacity-40">
                      No security events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmOpen && selectedUser && (
        <ConfirmDialog
          title="Revoke Sessions"
          message={`Force sign-out all active sessions for ${selectedUser.name}?`}
          confirmLabel="Revoke Sessions"
          onConfirm={() => revokeSessions.mutate({ userId: selectedUser.id })}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
