import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Printer, Search, CheckSquare, Square, Tag,
  ChevronLeft, ChevronRight, Barcode as BarcodeIcon,
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { productsApi, formatCents, type Product } from '../../services/products';

// ─── Types ────────────────────────────────────────────────────────────────────

type Format = 'small' | 'medium' | 'large';

interface SelectedEntry {
  product: Product;
  copies: number;
}

interface LabelData {
  productId: string;
  name:      string;
  sku:       string;
  barcode:   string | null;
  priceCents:number;
  unitShort: string;
}

// ─── Format config ────────────────────────────────────────────────────────────

const FORMAT_CONFIG: Record<Format, { label: string; size: string; cols: number; widthMm: number; heightMm: number; fontSize: number; bcHeight: number }> = {
  small:  { label: 'Small',  size: '38×25 mm',  cols: 5, widthMm: 38, heightMm: 25, fontSize: 7,  bcHeight: 22 },
  medium: { label: 'Medium', size: '50×30 mm',  cols: 4, widthMm: 50, heightMm: 30, fontSize: 9,  bcHeight: 28 },
  large:  { label: 'Large',  size: '99×57 mm',  cols: 2, widthMm: 99, heightMm: 57, fontSize: 11, bcHeight: 40 },
};

// ─── Barcode SVG component ────────────────────────────────────────────────────

function BarcodeImage({ value, height, fontSize }: { value: string; height: number; fontSize: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format:       'CODE128',
        width:        1.2,
        height,
        displayValue: true,
        fontSize,
        margin:       2,
        background:   'transparent',
      });
    } catch {
      // Invalid chars — clear SVG
      if (svgRef.current) svgRef.current.innerHTML = '';
    }
  }, [value, height, fontSize]);

  return <svg ref={svgRef} style={{ maxWidth: '100%' }} />;
}

// ─── Single label ─────────────────────────────────────────────────────────────

function Label({ label, format }: { label: LabelData; format: Format }) {
  const cfg        = FORMAT_CONFIG[format];
  const codeValue  = label.barcode || label.sku;
  const showAsSku  = !label.barcode;

  return (
    <div
      className="barcode-label-item"
      style={{
        width:          `${cfg.widthMm}mm`,
        height:         `${cfg.heightMm}mm`,
        border:         '0.3pt solid #ccc',
        boxSizing:      'border-box',
        padding:        '1mm 1.5mm',
        display:        'flex',
        flexDirection:  'column',
        justifyContent: 'space-between',
        overflow:       'hidden',
        background:     'white',
        breakInside:    'avoid',
      }}
    >
      {/* Business name */}
      <p style={{ fontSize: cfg.fontSize - 1, color: '#666', margin: 0, lineHeight: 1.1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        Brocode ERP
      </p>

      {/* Product name */}
      <p style={{ fontSize: cfg.fontSize + 1, fontWeight: 700, color: '#111', margin: '0.5mm 0 0', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {label.name}
      </p>

      {/* Barcode */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', margin: '0.5mm 0' }}>
        <BarcodeImage value={codeValue} height={cfg.bcHeight} fontSize={cfg.fontSize - 1} />
      </div>

      {/* SKU note if no barcode */}
      {showAsSku && (
        <p style={{ fontSize: cfg.fontSize - 1, color: '#888', margin: 0, textAlign: 'center' }}>
          SKU: {label.sku}
        </p>
      )}

      {/* Price + unit */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p style={{ fontSize: cfg.fontSize + 2, fontWeight: 900, color: '#1e293b', margin: 0 }}>
          {formatCents(label.priceCents)}
        </p>
        <p style={{ fontSize: cfg.fontSize - 1, color: '#64748b', margin: 0 }}>
          {label.unitShort}
        </p>
      </div>
    </div>
  );
}

// (PRINT_STYLE removed — printing done via window.open new-window approach)

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BarcodeLabelsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<Map<string, SelectedEntry>>(new Map());
  const [format,   setFormat]   = useState<Format>('medium');
  const [labels,   setLabels]   = useState<LabelData[]>([]);
  const [previewReady, setPreviewReady] = useState(false);
  const [page, setPage] = useState(1);

  // Fetch products
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products-for-labels', search, page],
    queryFn: () => productsApi.list({ search: search || undefined, page, pageSize: 30, isActive: 'true' }),
    staleTime: 60_000,
  });
  const products   = productsData?.data ?? [];
  const totalPages = productsData ? Math.ceil(productsData.total / 30) : 1;

  // Pre-select from ?sku= query param
  useEffect(() => {
    const sku = searchParams.get('sku');
    if (!sku || products.length === 0) return;
    const p = products.find((pr: Product) => pr.sku === sku);
    if (p && !selected.has(p.id)) {
      setSelected(prev => {
        const next = new Map(prev);
        next.set(p.id, { product: p, copies: 1 });
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, searchParams]);

  const toggleProduct = useCallback((p: Product) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(p.id)) { next.delete(p.id); }
      else                 { next.set(p.id, { product: p, copies: 1 }); }
      setPreviewReady(false);
      return next;
    });
  }, []);

  const setCopies = useCallback((id: string, copies: number) => {
    setSelected(prev => {
      const entry = prev.get(id);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(id, { ...entry, copies: Math.max(1, Math.min(100, copies)) });
      return next;
    });
  }, []);

  const selectAll = () => {
    const next = new Map(selected);
    products.forEach((p: Product) => { if (!next.has(p.id)) next.set(p.id, { product: p, copies: 1 }); });
    setSelected(next);
    setPreviewReady(false);
  };

  const clearAll = () => { setSelected(new Map()); setPreviewReady(false); setLabels([]); };

  const generatePreview = () => {
    const result: LabelData[] = [];
    for (const entry of selected.values()) {
      const p = entry.product;
      const ld: LabelData = {
        productId: p.id,
        name:      p.name,
        sku:       p.sku,
        barcode:   p.barcode ?? null,
        priceCents:p.priceCents,
        unitShort: p.unit?.shortCode ?? '',
      };
      for (let i = 0; i < entry.copies; i++) result.push(ld);
    }
    setLabels(result);
    setPreviewReady(true);
  };

  const handlePrint = () => {
    if (labels.length === 0) return;

    const cfg  = FORMAT_CONFIG[format];
    const xs   = new XMLSerializer();

    function esc(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const labelsHtml = labels.map(lbl => {
      const codeValue = lbl.barcode || lbl.sku;

      // Generate SVG in memory so XMLSerializer can emit correct XML namespaces
      let svgStr = '';
      try {
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        JsBarcode(svgEl, codeValue, {
          format:       'CODE128',
          width:        1.2,
          height:       cfg.bcHeight,
          displayValue: true,
          fontSize:     cfg.fontSize - 1,
          margin:       2,
          background:   'transparent',
        });
        // Ensure SVG fills its container
        svgEl.setAttribute('style', 'width:100%;height:auto;display:block;');
        svgStr = xs.serializeToString(svgEl);
      } catch { svgStr = ''; }

      const showSku = !lbl.barcode;
      const price   = esc(formatCents(lbl.priceCents));
      const name    = esc(lbl.name);
      const sku     = esc(lbl.sku);
      const unit    = esc(lbl.unitShort);

      return `<div style="width:${cfg.widthMm}mm;height:${cfg.heightMm}mm;border:0.3pt solid #ccc;box-sizing:border-box;padding:1mm 1.5mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;background:#fff;break-inside:avoid;page-break-inside:avoid;">
  <p style="font-size:${cfg.fontSize - 1}pt;color:#666;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Brocode ERP</p>
  <p style="font-size:${cfg.fontSize + 1}pt;font-weight:700;color:#111;margin:0.5mm 0 0;line-height:1.2;overflow:hidden;">${name}</p>
  <div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;margin:0.5mm 0;">${svgStr}</div>
  ${showSku ? `<p style="font-size:${cfg.fontSize - 1}pt;color:#888;margin:0;text-align:center;">SKU: ${sku}</p>` : ''}
  <div style="display:flex;justify-content:space-between;align-items:baseline;">
    <p style="font-size:${cfg.fontSize + 2}pt;font-weight:900;color:#1e293b;margin:0;">${price}</p>
    <p style="font-size:${cfg.fontSize - 1}pt;color:#64748b;margin:0;">${unit}</p>
  </div>
</div>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Barcode Labels</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
    @page { margin: 5mm; size: A4; }
    .label-grid {
      display: grid;
      grid-template-columns: repeat(${cfg.cols}, ${cfg.widthMm}mm);
      gap: 2mm;
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="label-grid">${labelsHtml}</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Please allow popups for this site to print labels.'); return; }

    // Guard against double-trigger (onload + fallback timeout)
    let triggered = false;
    const triggerPrint = () => {
      if (triggered) return;
      triggered = true;
      setTimeout(() => { win.print(); win.close(); }, 400);
    };

    win.document.write(html);
    win.document.close();
    win.onload = triggerPrint;
    // Fallback: onload may have fired before we attached the handler
    setTimeout(triggerPrint, 1400);
  };

  const cfg = FORMAT_CONFIG[format];

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <BarcodeIcon size={20} className="text-indigo-600" /> Barcode Labels
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Select products and generate print-ready labels</p>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── LEFT PANEL ── */}
        <div className="w-[42%] border-r border-slate-200 flex flex-col bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700 mb-2">Select Products</p>
            {/* Search */}
            <div className="relative mb-2">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by name or SKU…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {/* Select All / Clear */}
            <div className="flex gap-2">
              <button onClick={selectAll}
                className="text-xs text-indigo-600 hover:underline font-medium flex items-center gap-1">
                <CheckSquare size={12} /> Select All
              </button>
              <span className="text-slate-300">·</span>
              <button onClick={clearAll}
                className="text-xs text-slate-500 hover:underline font-medium flex items-center gap-1">
                <Square size={12} /> Clear All
              </button>
              {selected.size > 0 && (
                <span className="ml-auto text-xs text-slate-400">{selected.size} selected</span>
              )}
            </div>
          </div>

          {/* Product list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-slate-200 border-t-indigo-400 rounded-full animate-spin mr-2" />
                Loading…
              </div>
            )}
            {!isLoading && products.length === 0 && (
              <p className="text-center py-10 text-slate-400 text-sm">No products found</p>
            )}
            {products.map((p: Product) => {
              const isChecked = selected.has(p.id);
              const entry     = selected.get(p.id);
              return (
                <div key={p.id}
                  className={`px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition ${isChecked ? 'bg-indigo-50/60' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => toggleProduct(p)}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${isChecked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                      {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    </button>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleProduct(p)}>
                      <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{p.sku} · {formatCents(p.priceCents)}</p>
                    </div>
                    {isChecked && entry && (
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={entry.copies}
                          onChange={e => setCopies(p.id, parseInt(e.target.value) || 1)}
                          onClick={e => e.stopPropagation()}
                          className="w-12 border border-indigo-200 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                        <span className="text-xs text-slate-400">copies</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40">
                <ChevronLeft size={14} />
              </button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40">
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Format selector + Generate */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 space-y-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Label Format</p>
            <div className="space-y-1.5">
              {(Object.entries(FORMAT_CONFIG) as [Format, typeof FORMAT_CONFIG[Format]][]).map(([key, c]) => (
                <label key={key} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition ${format === key ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <input type="radio" name="format" value={key} checked={format === key}
                    onChange={() => { setFormat(key); setPreviewReady(false); }}
                    className="accent-indigo-600" />
                  <span className="text-sm font-medium text-slate-700">{c.label}</span>
                  <span className="text-xs text-slate-400 ml-auto">{c.size}</span>
                </label>
              ))}
            </div>

            <button
              onClick={generatePreview}
              disabled={selected.size === 0}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              <Tag size={15} /> Generate Preview
            </button>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
            <div>
              <p className="text-sm font-semibold text-slate-700">Label Preview</p>
              {previewReady && (
                <p className="text-xs text-slate-400">
                  {labels.length} labels · {cfg.label} ({cfg.size}) · {cfg.cols} per row
                </p>
              )}
            </div>
            {previewReady && labels.length > 0 && (
              <button onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition shadow-sm">
                <Printer size={14} /> Print Labels
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto p-5 bg-slate-100">
            {!previewReady && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <BarcodeIcon size={48} className="text-slate-200" />
                <p className="text-sm">Select products and click Generate Preview</p>
              </div>
            )}

            {previewReady && labels.length === 0 && (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                No labels to show — select at least 1 product with copies ≥ 1
              </div>
            )}

            {previewReady && labels.length > 0 && (
              /* Screen preview — mirrors the print area but inside the scroll panel */
              <div style={{
                display:             'grid',
                gridTemplateColumns: `repeat(${cfg.cols}, ${cfg.widthMm}mm)`,
                gap:                 '0',
                background:          'white',
                width:               'fit-content',
                margin:              '0 auto',
                boxShadow:           '0 2px 20px rgba(0,0,0,0.1)',
              }}>
                {labels.map((lbl, i) => (
                  <Label key={`${lbl.productId}-${i}`} label={lbl} format={format} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
