import { useState } from 'react';
import { trpc } from '../utils/trpc';
import { Shield, X, Copy, Check, KeyRound } from 'lucide-react';

type Step = 'status' | 'setup' | 'verify' | 'recovery' | 'disable' | 'regenerate' | 'password';

export default function UserSecurityModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('status');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const utils = trpc.useUtils();

  const { data: status, isLoading } = trpc.mfa.getStatus.useQuery();

  const beginSetup = trpc.mfa.beginSetup.useMutation({
    onSuccess: () => {
      setStep('setup');
      setCode('');
    },
  });

  const enable = trpc.mfa.enable.useMutation({
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setStep('recovery');
      setCode('');
      utils.mfa.getStatus.invalidate();
    },
  });

  const disable = trpc.mfa.disable.useMutation({
    onSuccess: () => {
      setStep('status');
      setCode('');
      utils.mfa.getStatus.invalidate();
    },
  });

  const regenerate = trpc.mfa.regenerateRecoveryCodes.useMutation({
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setStep('recovery');
      setCode('');
    },
  });

  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
  });

  const busy = beginSetup.isPending || enable.isPending || disable.isPending || regenerate.isPending || changePassword.isPending;
  const error = beginSetup.error || enable.error || disable.error || regenerate.error || changePassword.error;

  function handleCopyRecoveryCodes() {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 dark:bg-white/10">
      <div className="bg-white dark:bg-black border-2 border-black dark:border-white w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b-2 border-black dark:border-white">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5" />
            <h2 className="text-lg font-black uppercase tracking-tighter">Account Security</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:opacity-60">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {isLoading ? (
            <div className="text-[10px] font-black uppercase opacity-50 text-center py-8">Loading...</div>
          ) : step === 'status' ? (
            <>
              {/* MFA Status */}
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Two-Factor Authentication</div>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 ${status?.enabled ? 'bg-green-600' : 'bg-black/20 dark:bg-white/20'}`} />
                  <span className="text-sm font-bold uppercase">
                    {status?.enabled ? 'Enabled' : 'Not Enabled'}
                  </span>
                </div>
                {status?.enabled && status.enabledAt && (
                  <div className="text-[10px] opacity-50">
                    Since {new Date(status.enabledAt).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="border-t border-black/10 dark:border-white/10 pt-4 space-y-3">
                {!status?.enabled ? (
                  <>
                    <p className="text-[10px] uppercase opacity-60 leading-relaxed">
                      Protect your account with a time-based one-time password (TOTP) from an authenticator app like Google Authenticator or Authy.
                    </p>
                    <button
                      onClick={() => beginSetup.mutate()}
                      disabled={busy}
                      className="w-full p-4 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
                    >
                      {beginSetup.isPending ? 'Starting...' : 'Enable Two-Factor Authentication'}
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <button
                      onClick={() => { setStep('regenerate'); setCode(''); }}
                      className="w-full p-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                    >
                      Regenerate Recovery Codes
                    </button>
                    <button
                      onClick={() => { setStep('disable'); setCode(''); }}
                      className="w-full p-3 border-2 border-black/30 dark:border-white/30 font-black uppercase text-[10px] tracking-widest opacity-60 hover:opacity-100 hover:border-red-600 hover:text-red-600"
                    >
                      Disable Two-Factor Authentication
                    </button>
                  </div>
                )}
              </div>

              {/* Password Change */}
              <div className="border-t border-black/10 dark:border-white/10 pt-4 space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Password</div>
                <button
                  onClick={() => { setStep('password'); setPwSuccess(false); changePassword.reset(); }}
                  className="w-full p-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black flex items-center justify-center gap-2"
                >
                  <KeyRound className="h-3 w-3" /> Change Password
                </button>
              </div>
            </>
          ) : step === 'password' ? (
            <>
              {/* Password Change Form */}
              <div className="space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Change Password</div>
                {pwSuccess ? (
                  <div className="space-y-4 text-center py-4">
                    <div className="w-12 h-12 border-4 border-black dark:border-white flex items-center justify-center mx-auto text-xl font-black">✓</div>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Password updated. You will be signed out shortly.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-[10px] uppercase opacity-60 leading-relaxed">
                      Min 10 characters with uppercase, lowercase, digit, and special character. All sessions will be revoked.
                    </p>
                    <div>
                      <label className="block text-[8px] uppercase opacity-50 mb-1">Current Password</label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-3 text-sm outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] uppercase opacity-50 mb-1">New Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-3 text-sm outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] uppercase opacity-50 mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-3 text-sm outline-none"
                        placeholder="••••••••"
                      />
                      {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-[9px] text-red-600 mt-1 uppercase">Passwords do not match</p>
                      )}
                    </div>
                    <button
                      onClick={() => changePassword.mutate({ currentPassword, newPassword })}
                      disabled={busy || !currentPassword || newPassword.length < 10 || newPassword !== confirmPassword}
                      className="w-full p-4 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
                    >
                      {changePassword.isPending ? 'Updating...' : 'Update Password'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setStep('status'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPwSuccess(false); changePassword.reset(); }}
                  className="w-full text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100"
                >
                  {pwSuccess ? 'Close' : 'Cancel'}
                </button>
              </div>
            </>
          ) : step === 'setup' ? (
            <>
              {/* Setup: show manual key + verify */}
              <div className="space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Step 1: Add to Authenticator</div>
                <p className="text-[10px] uppercase opacity-60 leading-relaxed">
                  Open your authenticator app and add a new account using this manual entry key:
                </p>

                {beginSetup.data && (
                  <>
                    <div className="border-2 border-black dark:border-white p-4 space-y-3">
                      <div>
                        <div className="text-[8px] uppercase opacity-50 mb-1">Manual Entry Key</div>
                        <div className="font-mono text-sm tracking-widest break-all select-all">{beginSetup.data.manualEntryKey}</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase opacity-50 mb-1">OTPAuth URI</div>
                        <div className="font-mono text-[9px] break-all opacity-60 select-all">{beginSetup.data.uri}</div>
                      </div>
                    </div>

                    <div className="text-[10px] font-black uppercase tracking-widest opacity-60 pt-2">Step 2: Verify</div>
                    <p className="text-[10px] uppercase opacity-60">Enter the 6-digit code from your authenticator app to activate MFA.</p>

                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="w-full border-2 border-black dark:border-white bg-transparent p-3 text-center text-lg font-mono tracking-[0.3em] outline-none"
                      autoFocus
                    />

                    <button
                      onClick={() => enable.mutate({ code })}
                      disabled={code.length !== 6 || busy}
                      className="w-full p-4 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
                    >
                      {enable.isPending ? 'Verifying...' : 'Activate MFA'}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setStep('status')}
                  className="w-full text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 pt-2"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : step === 'recovery' ? (
            <>
              {/* Recovery Codes Display */}
              <div className="space-y-4">
                <div className="border-2 border-black dark:border-white p-4 bg-black/5 dark:bg-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="h-4 w-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Recovery Codes</span>
                  </div>
                  <p className="text-[10px] uppercase opacity-60 leading-relaxed mb-4">
                    Save these codes in a secure location. Each code can only be used once. You will not be able to see them again.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {recoveryCodes.map((code, i) => (
                      <div key={i} className="font-mono text-sm tracking-widest p-2 border border-black/20 dark:border-white/20 text-center select-all">
                        {code}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleCopyRecoveryCodes}
                  className="w-full p-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black flex items-center justify-center gap-2"
                >
                  {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy All Codes</>}
                </button>

                <button
                  onClick={() => { setStep('status'); setRecoveryCodes([]); }}
                  className="w-full p-4 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest hover:invert"
                >
                  I've Saved My Codes
                </button>
              </div>
            </>
          ) : step === 'disable' ? (
            <>
              {/* Disable MFA */}
              <div className="space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Disable Two-Factor Authentication</div>
                <p className="text-[10px] uppercase opacity-60 leading-relaxed">
                  Enter your current 6-digit authenticator code to disable MFA. This will make your account less secure.
                </p>

                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full border-2 border-black dark:border-white bg-transparent p-3 text-center text-lg font-mono tracking-[0.3em] outline-none"
                  autoFocus
                />

                <button
                  onClick={() => disable.mutate({ code })}
                  disabled={code.length < 6 || busy}
                  className="w-full p-4 border-2 border-red-600 text-red-600 font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:bg-red-600 hover:text-white"
                >
                  {disable.isPending ? 'Disabling...' : 'Confirm Disable MFA'}
                </button>

                <button
                  onClick={() => setStep('status')}
                  className="w-full text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : step === 'regenerate' ? (
            <>
              {/* Regenerate Recovery Codes */}
              <div className="space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Regenerate Recovery Codes</div>
                <p className="text-[10px] uppercase opacity-60 leading-relaxed">
                  This will invalidate all existing recovery codes. Enter your current 6-digit authenticator code to proceed.
                </p>

                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full border-2 border-black dark:border-white bg-transparent p-3 text-center text-lg font-mono tracking-[0.3em] outline-none"
                  autoFocus
                />

                <button
                  onClick={() => regenerate.mutate({ code })}
                  disabled={code.length !== 6 || busy}
                  className="w-full p-4 border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black font-black uppercase text-[10px] tracking-widest disabled:opacity-30 hover:invert"
                >
                  {regenerate.isPending ? 'Regenerating...' : 'Generate New Codes'}
                </button>

                <button
                  onClick={() => setStep('status')}
                  className="w-full text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : null}

          {error && (
            <div className="border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black p-3 flex items-center gap-3">
              <span className="text-lg font-black">!</span>
              <p className="font-bold text-[10px] uppercase tracking-widest">{error.message}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
