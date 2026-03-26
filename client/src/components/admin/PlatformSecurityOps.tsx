import { useMemo, useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';

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
    onSuccess: async () => {
      setSetupSecret(null);
      setVerificationCode('');
      await utils.platformSecurity.getStatus.invalidate();
      await utils.platform.getAuditLog.invalidate();
    },
  });

  const verifyStepUp = trpc.platformSecurity.verify.useMutation({
    onSuccess: async () => {
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
        <h2 className="text-2xl font-bold uppercase tracking-tight">{t('security_tab')}</h2>
        <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)] mt-1 tracking-wide">
          Centralized controls for incident response and privileged session containment.
        </p>
      </div>

      <section className="surface-card p-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold uppercase tracking-wide">Platform Step-Up</h3>
          <p className="text-[10px] uppercase text-[var(--color-text-secondary)] mt-1">
            Platform admin actions now require a recent TOTP verification. Complete setup once, then verify to unlock the rest of this view.
          </p>
        </div>

        {statusLoading ? (
          <div className="font-mono text-[9px] font-bold uppercase text-[var(--color-text-muted)]">{t('loading_log')}</div>
        ) : !status?.mfaEnabled ? (
          <div className="space-y-4">
            <div className="text-[10px] uppercase text-[var(--color-text-secondary)]">
              {setupSecret
                ? 'Add this manual key to your authenticator app, then enter a 6-digit code to enable step-up.'
                : 'Start platform MFA setup to protect cross-tenant admin access.'}
            </div>

            {setupSecret && (
              <div className="border border-[var(--color-border)] p-4 space-y-2">
                <div>
                  <div className="mono-label">Manual Entry Key</div>
                  <div className="font-mono text-sm tracking-widest break-all">{setupSecret.manualEntryKey}</div>
                </div>
                <div>
                  <div className="mono-label">OTPAuth URL</div>
                  <div className="font-mono text-[10px] break-all text-[var(--color-text-secondary)]">{setupSecret.otpauthUrl}</div>
                </div>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-4 md:items-end">
              <button
                onClick={() => beginSetup.mutate()}
                disabled={stepUpFormBusy}
                className="btn-secondary disabled:opacity-30"
              >
                {beginSetup.isPending ? 'Starting...' : setupSecret ? 'Reset Setup Key' : 'Start Setup'}
              </button>

              <div className="flex-1">
                <label className="mono-label mb-1 block">Verification Code</label>
                <input
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="123456"
                  className="input-field w-full"
                />
              </div>

              <button
                onClick={() => enableMfa.mutate({ code: verificationCode })}
                disabled={!setupSecret || verificationCode.trim().length < 6 || stepUpFormBusy}
                className="btn-primary disabled:opacity-30"
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
                <div className="mono-label">Step-Up Status</div>
                <div className="text-sm font-bold uppercase">
                  {status.stepUpSatisfied
                    ? `Verified until ${status.stepUpExpiresAt ? new Date(status.stepUpExpiresAt).toLocaleTimeString() : '-'}`
                    : 'Verification required'}
                </div>
              </div>

              <div className="flex-1">
                <label className="mono-label mb-1 block">Verification Code</label>
                <input
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  placeholder="123456"
                  className="input-field w-full"
                />
              </div>

              <button
                onClick={() => verifyStepUp.mutate({ code: verificationCode })}
                disabled={verificationCode.trim().length < 6 || stepUpFormBusy}
                className="btn-primary disabled:opacity-30"
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

      <section className={`surface-card p-6 space-y-4 ${status?.stepUpSatisfied ? '' : 'opacity-40'}`}>
        <div>
          <h3 className="text-lg font-bold uppercase tracking-wide">Session Containment</h3>
          <p className="text-[10px] uppercase text-[var(--color-text-secondary)] mt-1">
            Force sign-out all active sessions for a selected user. Use this for compromise response, break-glass cleanup, or access containment.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <label className="mono-label mb-1 block">User</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="input-field w-full"
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
            className="btn-primary disabled:opacity-30"
          >
            {revokeSessions.isPending ? 'Revoking...' : 'Revoke Sessions'}
          </button>
        </div>

        <div className="border-t border-[var(--color-border)] pt-4 text-[10px] uppercase text-[var(--color-text-secondary)] space-y-1">
          <p>Break-glass recovery should be followed by full session revocation and password rotation.</p>
          <p>See `docs/BREAK_GLASS_RUNBOOK.md` for the operating procedure.</p>
        </div>
      </section>

      <section className={`surface-card p-6 space-y-4 ${status?.stepUpSatisfied ? '' : 'opacity-40'}`}>
        <div>
          <h3 className="text-lg font-bold uppercase tracking-wide">Recent Security Events</h3>
          <p className="text-[10px] uppercase text-[var(--color-text-secondary)] mt-1">
            Latest privileged changes across tenant access, lifecycle actions, SSO mappings, and forced sign-outs.
          </p>
        </div>

        {!status?.stepUpSatisfied ? (
          <div className="py-6 text-center uppercase font-bold text-[var(--color-text-muted)]">Complete step-up to view privileged audit data.</div>
        ) : isLoading ? (
          <div className="py-6 text-center uppercase font-bold text-[var(--color-text-muted)]">{t('loading_log')}</div>
        ) : (
          <div className="border border-[var(--color-border)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-black/5 dark:bg-white/5">
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_time')}</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_action')}</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_actor')}</th>
                  <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{t('col_details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {securityEvents.map((event) => (
                  <tr key={event.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="p-3 text-[10px] font-mono whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="p-3 text-xs font-bold uppercase">{event.action}</td>
                    <td className="p-3 text-xs uppercase">{event.actorName || t('system')}</td>
                    <td className="p-3 text-[10px] text-[var(--color-text-secondary)]">{summarizeEvent(event.action, event.metadata, event.targetId)}</td>
                  </tr>
                ))}
                {securityEvents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
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
