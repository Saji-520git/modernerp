import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Check, AlertCircle, Layers } from 'lucide-react';
import { configApi, type BusinessType } from '../../services/config';
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
    </div>
  );
}
