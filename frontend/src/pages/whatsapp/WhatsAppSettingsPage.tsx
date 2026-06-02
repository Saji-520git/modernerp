import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, MessageCircle, Plug, X } from 'lucide-react';
import { whatsappService } from '../../services/whatsappService';
import type {
  UpdateWhatsAppConfigDto, WhatsAppMode, WhatsAppProvider,
  WhatsAppTemplate, UpdateTemplateDto, WhatsAppStatus,
} from '../../types/whatsapp';

const MASK = '••••••••';

function TextField({ label, value, onChange, placeholder, hint, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function statusBadge(status: WhatsAppStatus) {
  const map: Record<WhatsAppStatus, string> = {
    SENT: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-red-100 text-red-700',
    PENDING: 'bg-amber-100 text-amber-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status]}`}>{status}</span>;
}

// ─── Template edit modal ─────────────────────────────────────────────────────
function TemplateEditModal({ template, onClose }: { template: WhatsAppTemplate; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [bodyEn, setBodyEn] = useState(template.bodyEn);
  const [bodySi, setBodySi] = useState(template.bodySi ?? '');
  const [isActive, setIsActive] = useState(template.isActive);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (body: UpdateTemplateDto) => whatsappService.updateTemplate(template.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'templates'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to save template');
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{template.name}</h3>
            <p className="text-xs text-slate-400">{template.type} · {template.language}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {!template.isEditable && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              This template is locked and cannot be edited.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">English message</label>
            <textarea
              value={bodyEn}
              disabled={!template.isEditable}
              onChange={(e) => setBodyEn(e.target.value)}
              rows={5}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
            />
            <p className="text-xs text-slate-400 mt-1">{bodyEn.length} characters. Placeholders like {'{customerName}'} are filled automatically.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Sinhala message (optional)</label>
            <textarea
              value={bodySi}
              disabled={!template.isEditable}
              onChange={(e) => setBodySi(e.target.value)}
              rows={5}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
            />
          </div>

          {/* Preview */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-1">Preview</p>
            <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs whitespace-pre-wrap text-slate-600">
{bodyEn || '(empty)'}
            </pre>
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <p className="text-sm font-medium text-slate-700">Active</p>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              disabled={!template.isEditable}
              className={`relative w-11 h-6 rounded-full transition-colors ${isActive ? 'bg-emerald-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isActive ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={() => mutation.mutate({ bodyEn, bodySi: bodySi || null, isActive })}
            disabled={!template.isEditable || mutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <Save size={14} /> Save Template
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<WhatsAppTemplate | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: config, isLoading } = useQuery({ queryKey: ['whatsapp', 'config'], queryFn: whatsappService.getConfig });
  const { data: templates } = useQuery({ queryKey: ['whatsapp', 'templates'], queryFn: whatsappService.getTemplates });
  const { data: logs } = useQuery({ queryKey: ['whatsapp', 'log'], queryFn: () => whatsappService.getLog({ limit: 20 }) });

  // form state
  const [isEnabled, setIsEnabled]     = useState(false);
  const [mode, setMode]               = useState<WhatsAppMode>('WEB');
  const [provider, setProvider]       = useState<WhatsAppProvider>('META');
  const [ownerPhone, setOwnerPhone]   = useState('');
  const [apiKey, setApiKey]           = useState('');
  const [apiSecret, setApiSecret]     = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessId, setBusinessId]   = useState('');
  const [twilioSid, setTwilioSid]     = useState('');
  const [twilioToken, setTwilioToken] = useState('');
  const [twilioFrom, setTwilioFrom]   = useState('');

  useEffect(() => {
    if (config) {
      setIsEnabled(config.isEnabled);
      setMode(config.mode);
      setProvider(config.provider === 'NONE' ? 'META' : config.provider);
      setOwnerPhone(config.ownerPhone ?? '');
      setApiKey(config.apiKey ?? '');
      setApiSecret(config.apiSecret ?? '');
      setPhoneNumberId(config.phoneNumberId ?? '');
      setBusinessId(config.businessId ?? '');
      setTwilioSid(config.twilioSid ?? '');
      setTwilioToken(config.twilioToken ?? '');
      setTwilioFrom(config.twilioFrom ?? '');
    }
  }, [config]);

  const mutation = useMutation({
    mutationFn: (body: UpdateWhatsAppConfigDto) => whatsappService.updateConfig(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'config'] });
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to save settings');
    },
  });

  const testMutation = useMutation({
    mutationFn: () => whatsappService.testConnection(),
    onSuccess: (res) => {
      if (res.waLink) setTestResult({ ok: true, text: 'WEB mode active — wa.me link generated successfully.' });
      else if (res.success) setTestResult({ ok: true, text: 'Connected — test message sent.' });
      else setTestResult({ ok: false, text: res.error ?? 'Test failed.' });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setTestResult({ ok: false, text: msg ?? 'Connection test failed.' });
    },
  });

  const save = () => {
    // Send the API/secret fields only when changed from the masked placeholder, so a
    // real stored secret is never overwritten with bullet characters.
    const body: UpdateWhatsAppConfigDto = {
      isEnabled, mode,
      provider: mode === 'API' ? provider : 'NONE',
      ownerPhone: ownerPhone.trim() || null,
      phoneNumberId: phoneNumberId.trim() || null,
      businessId: businessId.trim() || null,
      twilioSid: twilioSid.trim() || null,
      twilioFrom: twilioFrom.trim() || null,
    };
    if (apiKey !== MASK) body.apiKey = apiKey.trim() || null;
    if (apiSecret !== MASK) body.apiSecret = apiSecret.trim() || null;
    if (twilioToken !== MASK) body.twilioToken = twilioToken.trim() || null;
    mutation.mutate(body);
  };

  if (isLoading) return <div className="text-center py-16 text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate('/dashboard')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
        <ArrowLeft size={14} /> Dashboard
      </button>

      <div className="flex items-center gap-2 mb-1">
        <MessageCircle size={22} className="text-emerald-600" />
        <h1 className="text-2xl font-bold text-slate-800">WhatsApp Settings</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Send receipts, reminders and broadcasts to your customers on WhatsApp.</p>

      {/* ── SECTION 1 — Mode ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5 mb-6">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="text-sm font-medium text-slate-700">Enable WhatsApp</p>
            <p className="text-xs text-slate-400">Turn on WhatsApp messaging features across the app.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${isEnabled ? 'bg-emerald-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        <div className="border-t border-slate-100" />

        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Mode</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('WEB')}
              className={`text-left rounded-lg border p-3 transition-colors ${mode === 'WEB' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <p className="text-sm font-medium text-slate-800">WhatsApp Web (Free)</p>
              <p className="text-xs text-slate-400 mt-0.5">Opens wa.me links — works with no API key.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('API')}
              className={`text-left rounded-lg border p-3 transition-colors ${mode === 'API' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <p className="text-sm font-medium text-slate-800">API Mode</p>
              <p className="text-xs text-slate-400 mt-0.5">Auto-send via Meta or Twilio (requires credentials).</p>
            </button>
          </div>
        </div>
      </div>

      {/* ── SECTION 2 — Owner Phone ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5 mb-6">
        <TextField
          label="Owner phone number"
          value={ownerPhone}
          onChange={setOwnerPhone}
          placeholder="077 123 4567"
          hint="Used as the destination for the Test Connection and daily report messages."
        />
      </div>

      {/* ── SECTION 3 — API Configuration ── */}
      {mode === 'API' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5 mb-6">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-slate-500" />
            <p className="text-sm font-semibold text-slate-700">API Configuration</p>
          </div>

          <div className="flex gap-2">
            {(['META', 'TWILIO'] as WhatsAppProvider[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${provider === p ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {p === 'META' ? 'Meta Cloud API' : 'Twilio'}
              </button>
            ))}
          </div>

          {provider === 'META' && (
            <>
              <TextField label="Access token" value={apiKey} onChange={setApiKey} type="password" hint="Meta WhatsApp Cloud API permanent access token." />
              <TextField label="Phone number ID" value={phoneNumberId} onChange={setPhoneNumberId} />
              <TextField label="Business account ID" value={businessId} onChange={setBusinessId} />
            </>
          )}

          {provider === 'TWILIO' && (
            <>
              <TextField label="Account SID" value={twilioSid} onChange={setTwilioSid} />
              <TextField label="Auth token" value={twilioToken} onChange={setTwilioToken} type="password" />
              <TextField label="From number" value={twilioFrom} onChange={setTwilioFrom} placeholder="whatsapp:+14155238886" />
            </>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setTestResult(null); testMutation.mutate(); }}
              disabled={testMutation.isPending}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 disabled:opacity-50 transition-colors"
            >
              {testMutation.isPending ? 'Testing…' : 'Test Connection'}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                {testResult.ok ? '✅ ' : '❌ '}{testResult.text}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">Save your settings before testing so the latest credentials are used.</p>
        </div>
      )}

      {/* ── SECTION 4 — Templates ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <p className="text-sm font-semibold text-slate-700 mb-3">Message Templates</p>
        {!templates || templates.length === 0 ? (
          <p className="text-sm text-slate-400">No templates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Language</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 text-slate-700 font-medium">{t.name}</td>
                    <td className="py-2.5 text-slate-500">{t.type}</td>
                    <td className="py-2.5 text-slate-500 uppercase">{t.language}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => setEditing(t)} className="text-emerald-600 hover:text-emerald-700 text-sm font-medium">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SECTION 5 — Message Log ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <p className="text-sm font-semibold text-slate-700 mb-3">Recent Messages</p>
        {!logs || logs.length === 0 ? (
          <p className="text-sm text-slate-400">No messages sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">To</th>
                  <th className="pb-2 font-medium">Mode</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 text-slate-500">{new Date(l.createdAt).toLocaleString('en-GB')}</td>
                    <td className="py-2.5 text-slate-700">{l.to}</td>
                    <td className="py-2.5 text-slate-500">{l.mode}</td>
                    <td className="py-2.5">{statusBadge(l.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Save (sticky) */}
      <div className="sticky bottom-0 bg-white/80 backdrop-blur border-t border-slate-200 py-3 px-1 flex items-center justify-end gap-3 -mx-1">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">Settings saved.</p>}
        <button
          onClick={save}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          <Save size={14} /> Save Settings
        </button>
      </div>

      {editing && <TemplateEditModal template={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
