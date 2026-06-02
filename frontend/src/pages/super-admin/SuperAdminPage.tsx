import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Check, AlertCircle, Layers, Building2, Plus, X, Power } from 'lucide-react';
import { configApi, type BusinessType } from '../../services/config';
import { tenantsApi, type Tenant, type TenantPlan, type RegisterTenantInput } from '../../services/tenants';
import type { ModuleFlags } from '../../store/appStore';

// ─── Module catalogue (order + descriptions shown in the UI) ──────────────────

const MODULE_META: { key: string; label: string; description: string }[] = [
  { key: 'pos',           label: 'Point of Sale',  description: 'Cashier checkout' },
  { key: 'inventory',     label: 'Inventory',      description: 'Stock management and tracking' },
  { key: 'purchasing',    label: 'Purchasing',     description: 'Purchase orders and GRN' },
  { key: 'customers',     label: 'Customers',      description: 'Customer management and credit' },
  { key: 'suppliers',     label: 'Suppliers',      description: 'Supplier management' },
  { key: 'expenses',      label: 'Expenses',       description: 'Expense recording and budgets' },
  { key: 'reports',       label: 'Reports',        description: 'Sales, inventory, P&L reports' },
  { key: 'warehouses',    label: 'Warehouses',     description: 'Multi-warehouse management' },
  { key: 'manufacturing', label: 'Manufacturing',  description: 'Production orders and BOM' },
  { key: 'hr',            label: 'HR',             description: 'Staff, attendance, payroll' },
  { key: 'multiLocation', label: 'Multi-Location', description: 'Multiple branch management' },
  { key: 'ecommerce',     label: 'E-commerce',     description: 'Online store integration' },
  { key: 'repairs',       label: 'Repairs',        description: 'Repair job management' },
  { key: 'bakery',        label: 'Bakery',         description: 'Bakery production tools' },
  { key: 'crm',           label: 'CRM & Loyalty',  description: 'Loyalty points, price tiers, customer intelligence' },
];

const TEMPLATES: { key: BusinessType; label: string }[] = [
  { key: 'grocery',  label: 'Grocery' },
  { key: 'hardware', label: 'Hardware' },
  { key: 'bakery',   label: 'Bakery' },
  { key: 'repairs',  label: 'Repairs' },
  { key: 'clothing', label: 'Clothing' },
  { key: 'general',  label: 'General' },
];

// ─── Small UI helpers (local — mirrors SettingsPage style) ────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  );
}

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 transition bg-white';

function errMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? 'Something went wrong';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SuperAdminPage() {
  const qc = useQueryClient();

  const modulesQuery = useQuery({ queryKey: ['config', 'modules'], queryFn: configApi.getModules });
  const clientQuery  = useQuery({ queryKey: ['config', 'client'],  queryFn: configApi.getClient });

  const [flags, setFlags] = useState<ModuleFlags>({});
  const [clientName, setClientName] = useState('');
  const [businessType, setBusinessType] = useState('general');

  useEffect(() => { if (modulesQuery.data) setFlags(modulesQuery.data); }, [modulesQuery.data]);
  useEffect(() => {
    if (clientQuery.data) {
      setClientName(clientQuery.data.clientName);
      setBusinessType(clientQuery.data.businessType);
    }
  }, [clientQuery.data]);

  const saveModules = useMutation({
    mutationFn: () => configApi.updateModules(flags),
    onSuccess: (data) => { setFlags(data); qc.invalidateQueries({ queryKey: ['config'] }); },
  });

  const saveClient = useMutation({
    mutationFn: () => configApi.updateClient({ clientName, businessType }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config', 'client'] }); },
  });

  const applyTemplate = useMutation({
    mutationFn: (template: BusinessType) => configApi.applyTemplate(template),
    onSuccess: (data) => {
      setFlags(data.modules);
      setBusinessType(data.businessType);
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });

  function onApplyTemplate(t: BusinessType, label: string) {
    if (window.confirm(`Apply the "${label}" template? This overwrites all current module flags.`)) {
      applyTemplate.mutate(t);
    }
  }

  if (modulesQuery.isLoading || clientQuery.isLoading) {
    return <div className="p-8 text-slate-400 text-sm">Loading configuration…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Super Admin</h1>
          <p className="text-sm text-slate-500">BROcode Solutions — client configuration &amp; module flags</p>
        </div>
      </div>

      {/* Client info */}
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Client Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Client Name</label>
            <input className={inputCls} value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Business Type</label>
            <input className={inputCls} value={businessType} onChange={(e) => setBusinessType(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
          <div className="text-sm">
            {saveClient.isSuccess && <span className="text-emerald-600 flex items-center gap-1"><Check size={14} /> Saved</span>}
            {saveClient.isError && <span className="text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {errMessage(saveClient.error)}</span>}
          </div>
          <button
            type="button"
            onClick={() => saveClient.mutate()}
            disabled={saveClient.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {saveClient.isPending ? 'Saving…' : 'Save Client Info'}
          </button>
        </div>
      </section>

      {/* Template quick-apply */}
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2"><Layers size={16} /> Business Type Templates</h2>
        <p className="text-xs text-slate-500 mb-4">One-click preset that overwrites all module flags below.</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onApplyTemplate(t.key, t.label)}
              disabled={applyTemplate.isPending}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-indigo-100 hover:text-indigo-700 transition disabled:opacity-50"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-sm h-5">
          {applyTemplate.isSuccess && <span className="text-emerald-600 flex items-center gap-1"><Check size={14} /> Template applied</span>}
          {applyTemplate.isError && <span className="text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {errMessage(applyTemplate.error)}</span>}
        </div>
      </section>

      {/* Module flags */}
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Module Flags</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {MODULE_META.map((m) => (
            <div key={m.key} className="flex items-center justify-between py-3 border-b border-slate-100">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium text-slate-700">{m.label}</p>
                <p className="text-xs text-slate-400 truncate">{m.description}</p>
              </div>
              <Toggle
                checked={flags[m.key] === true}
                onChange={(v) => setFlags((prev) => ({ ...prev, [m.key]: v }))}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
          <div className="text-sm">
            {saveModules.isSuccess && <span className="text-emerald-600 flex items-center gap-1"><Check size={14} /> Modules saved</span>}
            {saveModules.isError && <span className="text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {errMessage(saveModules.error)}</span>}
          </div>
          <button
            type="button"
            onClick={() => saveModules.mutate()}
            disabled={saveModules.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {saveModules.isPending ? 'Saving…' : 'Save Modules'}
          </button>
        </div>
      </section>

      {/* Tenant management (cloud / multi-tenant) */}
      <TenantManagement />
    </div>
  );
}

// ─── Tenant management (cloud / SaaS) ─────────────────────────────────────────

const PLAN_OPTIONS: { key: TenantPlan; label: string }[] = [
  { key: 'starter',    label: 'Starter' },
  { key: 'standard',   label: 'Standard' },
  { key: 'business',   label: 'Business' },
  { key: 'enterprise', label: 'Enterprise' },
];

const emptyRegisterForm: RegisterTenantInput = {
  name: '',
  plan: 'starter',
  adminEmail: '',
  adminPassword: '',
  adminName: '',
};

function TenantManagement() {
  const qc = useQueryClient();

  const tenantsQuery = useQuery({ queryKey: ['tenants'], queryFn: tenantsApi.list });

  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState<RegisterTenantInput>(emptyRegisterForm);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['tenants', selectedId],
    queryFn: () => tenantsApi.get(selectedId as string),
    enabled: selectedId !== null,
  });

  const [detailFlags, setDetailFlags] = useState<ModuleFlags>({});
  useEffect(() => { if (detailQuery.data) setDetailFlags(detailQuery.data.modules ?? {}); }, [detailQuery.data]);

  const registerMutation = useMutation({
    mutationFn: () => tenantsApi.register(form),
    onSuccess: () => {
      setShowRegister(false);
      setForm(emptyRegisterForm);
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => tenantsApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  const saveModulesMutation = useMutation({
    mutationFn: (id: string) => tenantsApi.updateModules(id, detailFlags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  function onDeactivate(t: Tenant) {
    if (window.confirm(`Deactivate "${t.name}"? Its users will be locked out until reactivated.`)) {
      deactivateMutation.mutate(t.id);
    }
  }

  const tenants = tenantsQuery.data ?? [];

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Building2 size={16} /> Tenant Management
        </h2>
        <button
          type="button"
          onClick={() => { setForm(emptyRegisterForm); setShowRegister(true); }}
          className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition flex items-center gap-1.5"
        >
          <Plus size={14} /> Register Tenant
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">Hosted (cloud) clients on this instance. Single-client deployments do not use this.</p>

      {tenantsQuery.isLoading ? (
        <div className="text-sm text-slate-400 py-4">Loading tenants…</div>
      ) : tenantsQuery.isError ? (
        <div className="text-sm text-red-600 flex items-center gap-1 py-4"><AlertCircle size={14} /> {errMessage(tenantsQuery.error)}</div>
      ) : tenants.length === 0 ? (
        <div className="text-sm text-slate-400 py-4">No tenants yet. Register the first one.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Slug</th>
                <th className="py-2 pr-3 font-medium">Plan</th>
                <th className="py-2 pr-3 font-medium">Users</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{t.name}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{t.slug}</td>
                  <td className="py-2.5 pr-3 text-slate-600 capitalize">{t.plan}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{t.userCount ?? '—'} / {t.maxUsers}</td>
                  <td className="py-2.5 pr-3">
                    {t.isActive
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Active</span>
                      : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">Inactive</span>}
                  </td>
                  <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    >
                      Manage
                    </button>
                    {t.isActive && (
                      <button
                        type="button"
                        onClick={() => onDeactivate(t)}
                        disabled={deactivateMutation.isPending}
                        className="px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Power size={12} /> Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Register modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Register New Tenant</h3>
              <button type="button" onClick={() => setShowRegister(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">Business Name</label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Acme Hardware" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">Plan</label>
                <select className={inputCls} value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value as TenantPlan }))}>
                  {PLAN_OPTIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">Admin Name</label>
                <input className={inputCls} value={form.adminName} onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} placeholder="Owner name" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">Admin Email</label>
                <input className={inputCls} type="email" value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} placeholder="owner@acme.com" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-600">Admin Password</label>
                <input className={inputCls} type="password" value={form.adminPassword} onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))} placeholder="At least 8 characters" />
              </div>
            </div>
            {registerMutation.isError && (
              <div className="mt-3 text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {errMessage(registerMutation.error)}</div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowRegister(false)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition">Cancel</button>
              <button
                type="button"
                onClick={() => registerMutation.mutate()}
                disabled={registerMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {registerMutation.isPending ? 'Creating…' : 'Create Tenant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail / module toggles modal */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">
                {detailQuery.data ? detailQuery.data.name : 'Tenant'} — Modules
              </h3>
              <button type="button" onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            {detailQuery.isLoading ? (
              <div className="text-sm text-slate-400 py-4">Loading…</div>
            ) : detailQuery.isError ? (
              <div className="text-sm text-red-600 flex items-center gap-1 py-4"><AlertCircle size={14} /> {errMessage(detailQuery.error)}</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  {MODULE_META.map((m) => (
                    <div key={m.key} className="flex items-center justify-between py-2.5 border-b border-slate-100">
                      <div className="min-w-0 pr-3">
                        <p className="text-sm font-medium text-slate-700">{m.label}</p>
                        <p className="text-xs text-slate-400 truncate">{m.description}</p>
                      </div>
                      <Toggle
                        checked={detailFlags[m.key] === true}
                        onChange={(v) => setDetailFlags((prev) => ({ ...prev, [m.key]: v }))}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                  <div className="text-sm">
                    {saveModulesMutation.isSuccess && <span className="text-emerald-600 flex items-center gap-1"><Check size={14} /> Saved</span>}
                    {saveModulesMutation.isError && <span className="text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {errMessage(saveModulesMutation.error)}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => saveModulesMutation.mutate(selectedId)}
                    disabled={saveModulesMutation.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                  >
                    {saveModulesMutation.isPending ? 'Saving…' : 'Save Modules'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
