import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
  Key,
  MoreVertical,
  Eye,
  EyeOff,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import {
  usersApi,
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_AVATAR_BG,
  ROLE_DESCRIPTIONS,
  ROLE_DEFAULTS,
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  getInitials,
  getEffectivePermissions,
  hasCustomPermissions,
  checkPasswordStrength,
  type User,
  type UserRole,
  type Permission,
} from '../../services/users';

// ─── Small helpers ─────────────────────────────────────────────────────────────

function cls(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

// ─── Stats card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | undefined;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex items-center gap-4">
      <div className={cls('w-10 h-10 rounded-lg flex items-center justify-center', color)}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value ?? '—'}</p>
        <p className="text-xs text-slate-500 font-medium">{label}</p>
      </div>
    </div>
  );
}

// ─── Permission toggle ────────────────────────────────────────────────────────

function PermissionToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cls(
        'flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors',
        checked ? 'bg-indigo-50 hover:bg-indigo-100' : 'hover:bg-slate-50',
      )}
      onClick={() => onChange(!checked)}
    >
      <div className="mt-0.5 shrink-0">
        <div
          className={cls(
            'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
            checked ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300',
          )}
        >
          {checked && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path
                d="M1 4L3.5 6.5L9 1"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className={cls('text-sm font-medium', checked ? 'text-indigo-700' : 'text-slate-700')}>
          {label}
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>
    </label>
  );
}

// ─── Role picker card ─────────────────────────────────────────────────────────

function RoleCard({
  role,
  selected,
  onSelect,
}: {
  role: UserRole;
  selected: boolean;
  onSelect: () => void;
}) {
  const borderMap: Record<UserRole, string> = {
    SUPER_ADMIN: selected
      ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300'
      : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50',
    ADMIN: selected
      ? 'border-red-500 bg-red-50 ring-1 ring-red-300'
      : 'border-slate-200 hover:border-red-300 hover:bg-red-50/50',
    MANAGER: selected
      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300'
      : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50',
    CASHIER: selected
      ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-300'
      : 'border-slate-200 hover:border-purple-300 hover:bg-purple-50/50',
    STAFF: selected
      ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-300'
      : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50/50',
  };
  const dotColor: Record<UserRole, string> = {
    SUPER_ADMIN: 'bg-indigo-600',
    ADMIN: 'bg-red-500',
    MANAGER: 'bg-blue-500',
    CASHIER: 'bg-purple-500',
    STAFF: 'bg-slate-400',
  };
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cls(
        'flex-1 min-w-0 rounded-lg border-2 p-2.5 text-left transition-all cursor-pointer',
        borderMap[role],
      )}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className={cls('w-2 h-2 rounded-full shrink-0', dotColor[role])} />
        <span className="text-xs font-bold text-slate-800">{ROLE_LABELS[role]}</span>
      </div>
      <p className="text-xs text-slate-500 leading-snug line-clamp-2">{ROLE_DESCRIPTIONS[role]}</p>
    </button>
  );
}

// ─── Password strength bar ────────────────────────────────────────────────────

function PasswordStrengthBar({ password }: { password: string }) {
  if (!password) return null;
  const { score, label, color, tips } = checkPasswordStrength(password);
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cls(
              'h-1 flex-1 rounded-full transition-all',
              i < score ? color : 'bg-slate-200',
            )}
          />
        ))}
      </div>
      <p
        className={cls(
          'text-xs font-medium',
          score <= 1 ? 'text-red-600' : score === 2 ? 'text-yellow-600' : 'text-green-600',
        )}
      >
        {label}
      </p>
      {tips.length > 0 && (
        <ul className="text-xs text-slate-400 space-y-0.5">
          {tips.map((tip) => (
            <li key={tip} className="flex items-center gap-1">
              <span className="text-slate-300">•</span> {tip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── User modal (create / edit) ───────────────────────────────────────────────

interface UserModalProps {
  user?: User | null;
  onClose: () => void;
  onSaved: () => void;
}

function UserModal({ user, onClose, onSaved }: UserModalProps) {
  const isEdit = !!user;

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>(user?.role ?? 'STAFF');

  // null = using role defaults, Permission[] = custom overrides
  const [customPerms, setCustomPerms] = useState<Permission[] | null>(
    user?.permissions ?? null,
  );

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(PERMISSION_GROUPS.map((g) => g.label)),
  );

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Effective permissions shown in toggles
  const effective: Permission[] = customPerms !== null ? customPerms : ROLE_DEFAULTS[role];
  const isCustomized = customPerms !== null;

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    // When role changes, clear custom perms so new role defaults apply
    if (isCustomized) setCustomPerms(null);
  };

  const togglePermission = (perm: Permission) => {
    const base = customPerms !== null ? customPerms : ROLE_DEFAULTS[role];
    if (base.includes(perm)) {
      setCustomPerms(base.filter((p) => p !== perm));
    } else {
      setCustomPerms([...base, perm]);
    }
  };

  const resetToDefaults = () => setCustomPerms(null);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const permsDifferFromDefaults = () => {
    if (customPerms === null) return false;
    const sorted = [...customPerms].sort();
    const defSorted = [...ROLE_DEFAULTS[role]].sort();
    return JSON.stringify(sorted) !== JSON.stringify(defSorted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) return setError('Full name is required');
    if (!email.trim()) return setError('Email is required');
    if (!isEdit) {
      if (!password) return setError('Password is required');
      if (password.length < 8) return setError('Password must be at least 8 characters');
      if (!/[a-zA-Z]/.test(password)) return setError('Must contain at least one letter');
      if (!/[0-9]/.test(password)) return setError('Must contain at least one number');
    }

    setSaving(true);
    try {
      const permissionsToSend = permsDifferFromDefaults() ? customPerms : null;

      if (isEdit) {
        await usersApi.update(user.id, {
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          role,
          permissions: permissionsToSend,
        });
      } else {
        await usersApi.create({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
          permissions: permissionsToSend,
        });
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <UserPlus size={18} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                {isEdit ? `Edit ${user.fullName}` : 'Add New User'}
              </h2>
              <p className="text-xs text-slate-400">
                {isEdit ? 'Update profile and permissions' : 'Create a new team member account'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body — two columns */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left — Basic info */}
            <div className="w-64 shrink-0 p-6 border-r border-slate-100 overflow-y-auto space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Basic Info
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="john@company.com"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  {!isEdit && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Min 8 chars"
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      <PasswordStrengthBar password={password} />
                    </div>
                  )}
                </div>
              </div>

              {/* Avatar preview */}
              {fullName && (
                <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                  <div
                    className={cls(
                      'w-12 h-12 rounded-xl mx-auto mb-2 flex items-center justify-center text-white font-bold text-lg',
                      ROLE_AVATAR_BG[role],
                    )}
                  >
                    {getInitials(fullName)}
                  </div>
                  <p className="text-sm font-semibold text-slate-700 truncate">{fullName}</p>
                  <p className="text-xs text-slate-400 truncate">{email || 'email@company.com'}</p>
                  <span
                    className={cls(
                      'mt-1.5 inline-block px-2 py-0.5 rounded-full text-xs font-semibold',
                      ROLE_COLORS[role],
                    )}
                  >
                    {ROLE_LABELS[role]}
                  </span>
                </div>
              )}
            </div>

            {/* Right — Role + Permissions */}
            <div className="flex-1 min-w-0 p-6 overflow-y-auto space-y-5">
              {/* Role picker */}
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Role
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {(['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] as UserRole[]).map((r) => (
                    <RoleCard
                      key={r}
                      role={r}
                      selected={role === r}
                      onSelect={() => handleRoleChange(r)}
                    />
                  ))}
                </div>
              </div>

              {/* Permissions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Permissions
                    </h3>
                    <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 rounded-full">
                      {effective.length}/{ALL_PERMISSIONS.length}
                    </span>
                    {isCustomized && permsDifferFromDefaults() && (
                      <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">
                        <Sparkles size={10} />
                        Custom
                      </span>
                    )}
                  </div>
                  {isCustomized && permsDifferFromDefaults() && (
                    <button
                      type="button"
                      onClick={resetToDefaults}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
                    >
                      <RotateCcw size={11} />
                      Reset to {ROLE_LABELS[role]} defaults
                    </button>
                  )}
                </div>

                {!permsDifferFromDefaults() && (
                  <div className="flex items-center gap-1.5 mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                    <p className="text-xs text-emerald-700">
                      Using{' '}
                      <span className="font-semibold">{ROLE_LABELS[role]}</span> default permissions
                      — toggle any to customize
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  {PERMISSION_GROUPS.map((group) => {
                    const groupActive = group.permissions.filter((p) =>
                      effective.includes(p.key),
                    ).length;
                    const expanded = expandedGroups.has(group.label);
                    return (
                      <div
                        key={group.label}
                        className="border border-slate-200 rounded-xl overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.label)}
                          className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">{group.icon}</span>
                            <span className="text-sm font-semibold text-slate-700">
                              {group.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">
                              {groupActive}/{group.permissions.length}
                            </span>
                            {expanded ? (
                              <ChevronUp size={14} className="text-slate-400" />
                            ) : (
                              <ChevronDown size={14} className="text-slate-400" />
                            )}
                          </div>
                        </button>
                        {expanded && (
                          <div className="p-2 space-y-1">
                            {group.permissions.map((p) => (
                              <PermissionToggle
                                key={p.key}
                                label={p.label}
                                description={p.description}
                                checked={effective.includes(p.key)}
                                onChange={() => togglePermission(p.key)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
            {error ? (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertTriangle size={14} />
                {error}
              </div>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-2"
              >
                {saving && (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Change password modal ────────────────────────────────────────────────────

function ChangePasswordModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (!/[a-zA-Z]/.test(password)) return setError('Must contain at least one letter');
    if (!/[0-9]/.test(password)) return setError('Must contain at least one number');

    setSaving(true);
    try {
      await usersApi.changePassword(user.id, password);
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <Key size={16} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">Change Password</h2>
              <p className="text-xs text-slate-400">{user.fullName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <PasswordStrengthBar password={password} />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {saving && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Deactivate / reactivate modal ────────────────────────────────────────────

function ToggleActiveModal({
  user,
  onClose,
  onConfirm,
}: {
  user: User;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const isActive = user.isActive;

  const handle = async () => {
    setSaving(true);
    await onConfirm();
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div
            className={cls(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              isActive ? 'bg-red-100' : 'bg-green-100',
            )}
          >
            {isActive ? (
              <UserX size={18} className="text-red-600" />
            ) : (
              <UserCheck size={18} className="text-green-600" />
            )}
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {isActive ? 'Deactivate User?' : 'Reactivate User?'}
            </h2>
            <p className="text-xs text-slate-400">{user.fullName}</p>
          </div>
        </div>

        <p className="text-sm text-slate-600">
          {isActive
            ? 'This user will no longer be able to log in. Their data is preserved and you can reactivate them at any time.'
            : 'This user will be able to log in again and access the system based on their role and permissions.'}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={saving}
            className={cls(
              'flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60',
              isActive ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700',
            )}
          >
            {saving && (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {isActive ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Row action menu ──────────────────────────────────────────────────────────

function ActionMenu({
  user,
  isSelf,
  onEdit,
  onChangePassword,
  onToggleActive,
}: {
  user: User;
  isSelf: boolean;
  onEdit: () => void;
  onChangePassword: () => void;
  onToggleActive: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Fixed position coords so the menu escapes overflow:hidden containers
  const [pos, setPos] = useState({ top: 0, right: 0, openUp: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Menu height: 3 items ≈ 120px, 2 items (self row) ≈ 80px
      const menuH = isSelf ? 80 : 130;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < menuH + 8;
      setPos({
        top: openUp ? rect.top - menuH - 4 : rect.bottom + 4,
        right: window.innerWidth - rect.right,
        openUp,
      });
    }
    setOpen((v) => !v);
  };

  // Close when clicking outside both button and dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        /* Render via fixed positioning — completely escapes overflow:hidden parents */
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-[9999] bg-white rounded-xl shadow-xl border border-slate-200 py-1 w-44"
        >
          <button
            onClick={() => { setOpen(false); onEdit(); }}
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Users size={14} className="text-slate-400" />
            Edit User
          </button>
          <button
            onClick={() => { setOpen(false); onChangePassword(); }}
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Key size={14} className="text-slate-400" />
            Change Password
          </button>
          {!isSelf && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <button
                onClick={() => { setOpen(false); onToggleActive(); }}
                className={cls(
                  'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2',
                  user.isActive ? 'text-red-600' : 'text-green-600',
                )}
              >
                {user.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                {user.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal state union ────────────────────────────────────────────────────────

type ModalState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; user: User }
  | { type: 'password'; user: User }
  | { type: 'toggleActive'; user: User };

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { user: me } = useAuthStore();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, activeFilter]);

  const params = {
    ...(search && { search }),
    ...(roleFilter && { role: roleFilter as UserRole }),
    ...(activeFilter !== 'all' && { isActive: activeFilter === 'active' }),
    page,
    pageSize: 12,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params),
  });

  const { data: stats } = useQuery({
    queryKey: ['users-stats'],
    queryFn: usersApi.stats,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (id: string) => usersApi.toggleActive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-stats'] });
      setModal({ type: 'none' });
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users-stats'] });
    setModal({ type: 'none' });
  };

  const totalPages = data ? Math.ceil(data.total / 12) : 1;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">User Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage team members, roles, and permissions
          </p>
        </div>
        <button
          onClick={() => setModal({ type: 'create' })}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <UserPlus size={16} />
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={stats?.total} icon={Users} color="bg-indigo-500" />
        <StatCard label="Active" value={stats?.active} icon={UserCheck} color="bg-green-500" />
        <StatCard label="Inactive" value={stats?.inactive} icon={UserX} color="bg-slate-400" />
        <StatCard label="Admins" value={stats?.byRole?.ADMIN} icon={ShieldCheck} color="bg-red-500" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-700"
        >
          <option value="">All Roles</option>
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="CASHIER">Cashier</option>
          <option value="STAFF">Staff</option>
        </select>

        <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
          {(['all', 'active', 'inactive'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cls(
                'px-3 py-2 text-sm font-medium capitalize transition-colors',
                activeFilter === f ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-600 rounded-full animate-spin mr-3" />
            Loading users…
          </div>
        ) : !data?.data.length ? (
          <div className="text-center py-16 text-slate-400">
            <Users size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No users found</p>
            {(search || roleFilter || activeFilter !== 'all') && (
              <p className="text-xs mt-1">Try adjusting your filters</p>
            )}
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">
                    Permissions
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((user) => {
                  const isSelf = user.id === me?.id;
                  const isCustom = hasCustomPermissions(user);
                  const effectivePerms = getEffectivePermissions(user);

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div
                            className={cls(
                              'w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0',
                              ROLE_AVATAR_BG[user.role],
                            )}
                          >
                            {getInitials(user.fullName)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-slate-800 truncate">
                                {user.fullName}
                              </p>
                              {isSelf && (
                                <span className="shrink-0 text-xs bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 rounded-full">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={cls(
                            'text-xs font-semibold px-2.5 py-1 rounded-full',
                            ROLE_COLORS[user.role],
                          )}
                        >
                          {ROLE_LABELS[user.role]}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">
                            {effectivePerms.length}/{ALL_PERMISSIONS.length}
                          </span>
                          {isCustom ? (
                            <span className="flex items-center gap-0.5 text-xs bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5 rounded-full">
                              <Sparkles size={9} />
                              Custom
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">defaults</span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={cls(
                            'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
                            user.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-500',
                          )}
                        >
                          <span
                            className={cls(
                              'w-1.5 h-1.5 rounded-full',
                              user.isActive ? 'bg-green-500' : 'bg-slate-400',
                            )}
                          />
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <ActionMenu
                          user={user}
                          isSelf={isSelf}
                          onEdit={() => setModal({ type: 'edit', user })}
                          onChangePassword={() => setModal({ type: 'password', user })}
                          onToggleActive={() => setModal({ type: 'toggleActive', user })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                <p className="text-xs text-slate-500">
                  {data.total} users · Page {page} of {totalPages}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white border border-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {modal.type === 'create' && (
        <UserModal onClose={() => setModal({ type: 'none' })} onSaved={invalidate} />
      )}
      {modal.type === 'edit' && (
        <UserModal
          user={modal.user}
          onClose={() => setModal({ type: 'none' })}
          onSaved={invalidate}
        />
      )}
      {modal.type === 'password' && (
        <ChangePasswordModal
          user={modal.user}
          onClose={() => setModal({ type: 'none' })}
          onSaved={() => setModal({ type: 'none' })}
        />
      )}
      {modal.type === 'toggleActive' && (
        <ToggleActiveModal
          user={modal.user}
          onClose={() => setModal({ type: 'none' })}
          onConfirm={async () => { await toggleActiveMutation.mutateAsync(modal.user.id); }}
        />
      )}
    </div>
  );
}
