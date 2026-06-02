import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Users } from 'lucide-react';
import { whatsappService } from '../../services/whatsappService';
import { crmService } from '../../services/crmService';
import { customersApi, type Customer } from '../../services/contacts';
import { openWhatsApp } from '../../utils/whatsappHelper';
import type { TemplateLanguage } from '../../types/whatsapp';

type Segment = 'all' | 'credit' | 'top' | 'custom';

const WEB_BATCH_LIMIT = 10; // browsers block opening more than a handful of tabs at once

export default function WhatsAppBroadcastPage() {
  const navigate = useNavigate();
  const [segment, setSegment] = useState<Segment>('all');
  const [customSel, setCustomSel] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState('');
  const [language, setLanguage] = useState<TemplateLanguage>('en');
  const [validUntil, setValidUntil] = useState('');

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: config } = useQuery({ queryKey: ['whatsapp', 'config'], queryFn: whatsappService.getConfig });
  const { data: templates } = useQuery({ queryKey: ['whatsapp', 'templates'], queryFn: whatsappService.getTemplates });
  const { data: customerList } = useQuery({
    queryKey: ['whatsapp', 'broadcast', 'customers'],
    queryFn: () => customersApi.list({ pageSize: 500 }),
  });
  const { data: topCustomers } = useQuery({
    queryKey: ['whatsapp', 'broadcast', 'top'],
    queryFn: () => crmService.getTopCustomers(20),
  });

  const customers: Customer[] = customerList?.data ?? [];
  const withPhone = useMemo(() => customers.filter((c) => c.isActive && c.phone && c.phone.trim()), [customers]);

  const recipients: Customer[] = useMemo(() => {
    if (segment === 'all') return withPhone;
    if (segment === 'credit') return withPhone.filter((c) => c.creditEnabled);
    if (segment === 'top') {
      const ids = new Set((topCustomers ?? []).map((t) => t.customerId));
      return withPhone.filter((c) => ids.has(c.id));
    }
    return withPhone.filter((c) => customSel.has(c.id));
  }, [segment, withPhone, topCustomers, customSel]);

  const mode = config?.mode ?? 'WEB';

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((tpl) => tpl.id === id);
    if (t) setMessage(language === 'si' ? (t.bodySi ?? t.bodyEn) : t.bodyEn);
  };

  const toggleCustom = (id: string) => {
    setCustomSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const send = async () => {
    setResult(null);
    if (!message.trim()) { setResult({ ok: false, text: 'Please enter a message.' }); return; }
    if (recipients.length === 0) { setResult({ ok: false, text: 'No recipients with a phone number in this segment.' }); return; }

    setSending(true);
    try {
      const ids = recipients.map((c) => c.id);

      if (mode === 'WEB') {
        // WEB mode: ask the backend to build wa.me links, then open them in batches.
        const capped = ids.slice(0, WEB_BATCH_LIMIT);
        const res = await whatsappService.sendOffer(capped, message.trim(), validUntil || undefined);
        const links = res.links ?? [];
        setProgress({ done: 0, total: links.length });
        for (let i = 0; i < links.length; i++) {
          openWhatsApp(links[i]);
          setProgress({ done: i + 1, total: links.length });
          await new Promise((r) => setTimeout(r, 600)); // stagger so the browser allows each tab
        }
        const extra = ids.length > WEB_BATCH_LIMIT ? ` (${ids.length - WEB_BATCH_LIMIT} more were skipped — WEB mode opens up to ${WEB_BATCH_LIMIT} at a time)` : '';
        setResult({ ok: true, text: `Opened ${links.length} WhatsApp chat${links.length === 1 ? '' : 's'}.${extra}` });
      } else {
        // API mode: backend sends to everyone and reports counts.
        setProgress({ done: 0, total: ids.length });
        const res = await whatsappService.sendOffer(ids, message.trim(), validUntil || undefined);
        setProgress({ done: res.sent, total: ids.length });
        const skipped = res.skipped?.length ? ` ${res.skipped.length} skipped.` : '';
        setResult({ ok: res.failed === 0, text: `Sent ${res.sent} message${res.sent === 1 ? '' : 's'}, ${res.failed} failed.${skipped}` });
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setResult({ ok: false, text: msg ?? 'Broadcast failed.' });
    } finally {
      setSending(false);
    }
  };

  const segments: { key: Segment; label: string; hint: string }[] = [
    { key: 'all', label: 'All customers', hint: 'Everyone with a phone number' },
    { key: 'credit', label: 'Credit customers', hint: 'Customers with credit enabled' },
    { key: 'top', label: 'Top customers', hint: 'Top 20 by spend' },
    { key: 'custom', label: 'Custom', hint: 'Pick individually' },
  ];

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate('/whatsapp/settings')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
        <ArrowLeft size={14} /> WhatsApp Settings
      </button>

      <div className="flex items-center gap-2 mb-1">
        <Users size={22} className="text-emerald-600" />
        <h1 className="text-2xl font-bold text-slate-800">Broadcast</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Send an offer or announcement to a group of customers.
        {' '}<span className="font-medium">{mode === 'WEB' ? 'WhatsApp Web mode' : 'API mode'}</span> is active.
      </p>

      {/* Recipients */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <p className="text-sm font-semibold text-slate-700 mb-3">Recipients</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegment(s.key)}
              className={`text-left rounded-lg border p-3 transition-colors ${segment === s.key ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <p className="text-sm font-medium text-slate-800">{s.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{s.hint}</p>
            </button>
          ))}
        </div>

        {segment === 'custom' && (
          <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
            {withPhone.length === 0 && <p className="text-sm text-slate-400 p-3">No customers with a phone number.</p>}
            {withPhone.map((c) => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={customSel.has(c.id)} onChange={() => toggleCustom(c.id)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-200" />
                <span className="text-sm text-slate-700">{c.name}</span>
                <span className="text-xs text-slate-400">{c.phone}</span>
              </label>
            ))}
          </div>
        )}

        <p className="text-sm text-slate-500 mt-3">
          <span className="font-semibold text-slate-700">{recipients.length}</span> recipient{recipients.length === 1 ? '' : 's'} selected.
        </p>
      </div>

      {/* Compose */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 mb-6">
        <p className="text-sm font-semibold text-slate-700">Message</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Template (optional)</label>
            <select
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">— Custom message —</option>
              {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as TemplateLanguage)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
            >
              <option value="en">English</option>
              <option value="si">Sinhala</option>
            </select>
          </div>
        </div>

        <div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="Type your offer or announcement…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <div className="flex justify-between mt-1">
            <p className="text-xs text-slate-400">Use *bold*, _italic_ or ~strike~ for WhatsApp formatting.</p>
            <p className="text-xs text-slate-400">{message.length} characters</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Valid until (optional)</label>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </div>
      </div>

      {/* Send */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        {sending && progress.total > 0 && (
          <div className="mb-4">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-1">{progress.done} / {progress.total}</p>
          </div>
        )}

        {result && (
          <p className={`text-sm mb-3 ${result.ok ? 'text-emerald-600' : 'text-red-600'}`}>{result.text}</p>
        )}

        <button
          onClick={send}
          disabled={sending || recipients.length === 0 || !message.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          <Send size={14} /> {mode === 'WEB' ? `Open chats (${Math.min(recipients.length, WEB_BATCH_LIMIT)})` : `Send to ${recipients.length}`}
        </button>
      </div>
    </div>
  );
}
