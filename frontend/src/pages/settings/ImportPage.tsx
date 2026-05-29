import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Upload, FileText, Download, CheckCircle, AlertTriangle, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  importApi,
  downloadCsvTemplate,
  downloadErrorCsv,
  type ParsedRow,
  type RowError,
  type PreviewResult,
} from '../../services/import';

// ─── ImportPage ───────────────────────────────────────────────────────────────

export default function ImportPage() {
  const fileRef                   = useRef<HTMLInputElement>(null);
  const [file,        setFile]    = useState<File | null>(null);
  const [preview,     setPreview] = useState<PreviewResult | null>(null);
  const [validOpen,   setValidOpen]   = useState(true);
  const [errorsOpen,  setErrorsOpen]  = useState(true);
  const [successMsg,  setSuccessMsg]  = useState<string | null>(null);
  const [globalErr,   setGlobalErr]   = useState<string | null>(null);

  // ── Preview mutation ──────────────────────────────────────────────────────
  const previewMut = useMutation({
    mutationFn: (f: File) => importApi.preview(f),
    onSuccess:  (data) => { setPreview(data); setGlobalErr(null); setSuccessMsg(null); },
    onError:    (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setGlobalErr(msg ?? 'Preview failed — check your file and try again');
    },
  });

  // ── Confirm mutation ──────────────────────────────────────────────────────
  const confirmMut = useMutation({
    mutationFn: (f: File) => importApi.confirm(f),
    onSuccess:  (data) => {
      setSuccessMsg(`Imported ${data.imported} product(s). ${data.withStock} received opening stock.`);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setGlobalErr(msg ?? 'Import failed');
    },
  });

  // ── Drop-zone ─────────────────────────────────────────────────────────────
  const handleFile = (f: File) => {
    setFile(f);
    setPreview(null);
    setSuccessMsg(null);
    setGlobalErr(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const canConfirm = preview && preview.valid.length > 0;

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Import Products &amp; Stock</h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload an Excel (.xlsx) or CSV file to bulk-import products and opening stock.
          Max file size: 5 MB.
        </p>
      </div>

      {/* Step 1 — download template */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-700 text-sm">Step 1 — Download the template</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Fill in your product data using the correct column names.
            </p>
          </div>
          <button
            onClick={downloadCsvTemplate}
            className="flex items-center gap-1.5 px-4 py-2 border border-indigo-200 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 transition"
          >
            <Download size={14} /> Download Template (CSV)
          </button>
        </div>

        {/* Column reference */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {['name *', 'sku *', 'barcode', 'category', 'brand', 'unit',
            'costPrice', 'sellPrice', 'taxPercent', 'reorderLevel',
            'openingStock', 'warehouseName'].map((col) => (
            <span
              key={col}
              className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                col.endsWith('*') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {col}
            </span>
          ))}
          <span className="text-[10px] text-slate-400 self-center">* required</span>
        </div>
      </div>

      {/* Step 2 — upload */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <p className="font-semibold text-slate-700 text-sm mb-3">Step 2 — Upload your file</p>

        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
            file ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
          }`}
        >
          <Upload size={28} className={`mx-auto mb-2 ${file ? 'text-indigo-500' : 'text-slate-300'}`} />
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <FileText size={16} className="text-indigo-600" />
              <span className="text-sm font-medium text-indigo-700">{file.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="p-0.5 text-slate-400 hover:text-slate-600 rounded"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500">Drag &amp; drop your file here, or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">Accepts .xlsx and .csv</p>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {globalErr && (
          <p className="mt-3 text-sm text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={14} /> {globalErr}
          </p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => file && previewMut.mutate(file)}
            disabled={!file || previewMut.isPending}
            className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {previewMut.isPending ? 'Analysing…' : 'Preview Import'}
          </button>

          {canConfirm && preview.errors.length === 0 && (
            <button
              onClick={() => file && confirmMut.mutate(file)}
              disabled={confirmMut.isPending}
              className="flex items-center gap-1.5 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
            >
              <CheckCircle size={14} />
              {confirmMut.isPending ? 'Importing…' : `Confirm Import (${preview.valid.length} rows)`}
            </button>
          )}
        </div>
      </div>

      {/* Success banner */}
      {successMsg && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm">
          <CheckCircle size={16} />
          {successMsg}
        </div>
      )}

      {/* Preview results */}
      {preview && (
        <div className="space-y-4">
          {/* Errors panel */}
          {preview.errors.length > 0 && (
            <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
              <button
                onClick={() => setErrorsOpen((o) => !o)}
                className="w-full flex items-center justify-between px-5 py-3 bg-red-50 text-red-700 text-sm font-semibold"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle size={14} />
                  ❌ Errors ({preview.errors.length}) — fix these before importing
                </span>
                {errorsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {errorsOpen && (
                <>
                  <div className="px-4 py-2 flex justify-end">
                    <button
                      onClick={() => downloadErrorCsv(preview.errors)}
                      className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                    >
                      <Download size={12} /> Download error report
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold text-slate-500">Row</th>
                          <th className="px-4 py-2 text-left font-semibold text-slate-500">Field</th>
                          <th className="px-4 py-2 text-left font-semibold text-slate-500">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errors.map((e, i) => (
                          <tr key={i} className="border-b border-red-50 bg-red-50/40">
                            <td className="px-4 py-2 font-mono text-red-700">{e.row}</td>
                            <td className="px-4 py-2 text-slate-600">{e.field}</td>
                            <td className="px-4 py-2 text-red-700">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                ⚠️ Fix all errors before importing. Rows with errors are excluded from the import.
              </div>
            </div>
          )}

          {/* Valid rows panel */}
          {preview.valid.length > 0 && (
            <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
              <button
                onClick={() => setValidOpen((o) => !o)}
                className="w-full flex items-center justify-between px-5 py-3 bg-green-50 text-green-700 text-sm font-semibold"
              >
                <span>✅ Valid rows ({preview.valid.length}) — ready to import</span>
                {validOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {validOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        {['Row', 'Name', 'SKU', 'Category', 'Brand', 'Unit',
                          'Cost', 'Price', 'Opening Qty', 'Warehouse'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.valid.map((r) => (
                        <tr key={r.rowNum} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-3 py-1.5 font-mono text-slate-400">{r.rowNum}</td>
                          <td className="px-3 py-1.5 font-medium text-slate-800">{r.name}</td>
                          <td className="px-3 py-1.5 font-mono text-indigo-700">{r.sku}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.category ?? '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.brand ?? '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.unit ?? '—'}</td>
                          <td className="px-3 py-1.5">{r.costPrice.toFixed(2)}</td>
                          <td className="px-3 py-1.5">{r.sellPrice.toFixed(2)}</td>
                          <td className="px-3 py-1.5">{r.openingStock > 0 ? r.openingStock : '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.warehouseName ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Confirm button below results if there are also errors */}
          {canConfirm && preview.errors.length > 0 && (
            <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800 flex-1">
                {preview.errors.length} row(s) have errors and will be skipped.
                Only the {preview.valid.length} valid row(s) will be imported.
              </p>
              <button
                onClick={() => file && confirmMut.mutate(file)}
                disabled={confirmMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
              >
                <CheckCircle size={13} />
                {confirmMut.isPending ? 'Importing…' : `Import ${preview.valid.length} rows`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
