import { receiptLabels, type ReceiptLang } from '../../utils/receiptI18n';
import type { Receipt } from '../../services/pos';
import type { AppSettings } from '../../services/settings';

// ─── Barcode ──────────────────────────────────────────────────────────────────

function SimpleBarcodeBar({ value }: { value: string }) {
  const bars: { width: number; black: boolean }[] = [];
  // Start bar
  bars.push({ width: 2, black: true }, { width: 2, black: false }, { width: 2, black: true });
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const w1 = (code % 3) + 1;
    const w2 = ((code >> 2) % 3) + 1;
    const w3 = ((code >> 4) % 2) + 1;
    bars.push(
      { width: w1, black: true  },
      { width: w2, black: false },
      { width: w3, black: true  },
      { width: 1,  black: false },
    );
  }
  // Stop bar
  bars.push({ width: 2, black: true }, { width: 2, black: false }, { width: 2, black: true });

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 36, justifyContent: 'center' }}>
      {bars.map((b, i) => (
        <div key={i} style={{
          width: b.width,
          height: 32,
          background: b.black ? '#000' : 'transparent',
          flexShrink: 0,
        }} />
      ))}
    </div>
  );
}

// ─── Money formatter ─────────────────────────────────────────────────────────

function money(cents: number, sym: string, pos: string): string {
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pos === 'before' ? `${sym} ${n}` : `${n} ${sym}`;
}

// ─── Divider ─────────────────────────────────────────────────────────────────

const Divider = ({ dashed = true }: { dashed?: boolean }) => (
  <div style={{
    borderTop: dashed ? '1px dashed #aaa' : '2px solid #000',
    margin: '5px 0',
  }} />
);

// ─── Row ─────────────────────────────────────────────────────────────────────

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    fontWeight: bold ? 700 : 400,
    marginBottom: 1,
  }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

// ─── ThermalReceipt ──────────────────────────────────────────────────────────

export interface ThermalReceiptProps {
  receipt:     Receipt;
  settings:    AppSettings;
  changeCents?: number;
  className?:  string;
}

export default function ThermalReceipt({
  receipt,
  settings,
  changeCents = 0,
  className = '',
}: ThermalReceiptProps) {
  const lang   = (settings.receiptLanguage ?? 'en') as ReceiptLang;
  const L      = receiptLabels[lang];
  const width  = settings.receiptPaperWidth === '58mm' ? 200 : 260;
  const sym    = settings.currencySymbol ?? 'Rs.';
  const symPos = settings.currencyPosition ?? 'before';
  const fmt    = (c: number) => money(c, sym, symPos);
  const fontFamily = lang === 'si'
    ? "'Noto Sans Sinhala', 'Courier New', monospace"
    : "'Courier New', monospace";

  const dateStr = new Date(receipt.date).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <div
      className={className}
      style={{
        width,
        fontFamily,
        fontSize: 11,
        color: '#000',
        background: '#fff',
        padding: '8px 6px',
        lineHeight: 1.5,
        boxSizing: 'border-box',
      }}
    >
      {/* ── HEADER ── */}
      {settings.receiptShowLogo && settings.logoUrl && (
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <img
            src={settings.logoUrl}
            alt="logo"
            style={{ maxHeight: 48, maxWidth: '80%', objectFit: 'contain' }}
            onError={e => (e.currentTarget.style.display = 'none')}
          />
        </div>
      )}
      <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, margin: '0 0 1px' }}>
        {settings.businessName || 'My Business'}
      </p>
      {settings.businessAddress && (
        <p style={{ textAlign: 'center', fontSize: 9, margin: '0 0 1px' }}>{settings.businessAddress}</p>
      )}
      {(settings.businessPhone || settings.businessEmail) && (
        <p style={{ textAlign: 'center', fontSize: 9, margin: '0 0 1px' }}>
          {[settings.businessPhone, settings.businessEmail].filter(Boolean).join(' | ')}
        </p>
      )}
      {settings.receiptTagline && (
        <p style={{ textAlign: 'center', fontSize: 9, margin: '0 0 1px' }}>{settings.receiptTagline}</p>
      )}
      {settings.receiptHeaderLine1 && (
        <p style={{ textAlign: 'center', fontSize: 9, margin: '0 0 1px' }}>{settings.receiptHeaderLine1}</p>
      )}
      {settings.receiptHeaderLine2 && (
        <p style={{ textAlign: 'center', fontSize: 9, margin: '0 0 1px' }}>{settings.receiptHeaderLine2}</p>
      )}

      <Divider />

      {/* ── META ── */}
      <Row label={L.invoiceNo} value={receipt.number} />
      {settings.receiptShowCashier && <Row label={L.cashier} value={receipt.cashier} />}
      <Row label={L.customer} value={receipt.customer?.name ?? L.walkIn} />
      <Row label={L.date} value={dateStr} />
      {receipt.warehouseName && (
        <p style={{ fontSize: 9, color: '#555', margin: '1px 0' }}>{receipt.warehouseName}</p>
      )}

      <Divider />

      {/* ── ITEMS ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 700, marginBottom: 2 }}>
        <span style={{ flex: 1 }}>{L.product}</span>
        <span style={{ width: 44, textAlign: 'center' }}>{L.qty}</span>
        <span style={{ width: 56, textAlign: 'right' }}>{L.amount}</span>
      </div>
      {receipt.lines.map((line, i) => (
        <div key={i} style={{ marginBottom: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, alignItems: 'flex-start' }}>
            <span style={{ flex: 1, overflowWrap: 'break-word', wordBreak: 'break-word', paddingRight: 4 }}>
              {line.product.name}
            </span>
            <span style={{ width: 44, textAlign: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>{line.qty}{line.unitShortCode ? ` ${line.unitShortCode}` : ''}</span>
            <span style={{ width: 56, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmt(line.lineTotalCents)}</span>
          </div>
          {settings.receiptShowSku && (
            <p style={{ fontSize: 8, color: '#666', margin: 0, paddingLeft: 2 }}>{line.product.sku}</p>
          )}
        </div>
      ))}

      <Divider />

      {/* ── TOTALS ── */}
      {receipt.discountCents > 0 && (
        <Row label={L.discount} value={`-${fmt(receipt.discountCents)}`} />
      )}
      {settings.receiptShowTax && receipt.taxCents > 0 && (
        <Row label={`${settings.taxLabel || L.tax}`} value={fmt(receipt.taxCents)} />
      )}
      <Divider dashed={false} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14, margin: '3px 0' }}>
        <span>{L.total}</span>
        <span>{fmt(receipt.totalCents)}</span>
      </div>
      <Divider />

      {/* Tendered / Change / Balance */}
      {receipt.paymentMethod === 'CASH' && changeCents >= 0 && receipt.paidCents > 0 && (
        <>
          <Row label={L.tendered} value={fmt(receipt.paidCents)} />
          {changeCents > 0 && <Row label={L.change} value={fmt(changeCents)} bold />}
        </>
      )}
      {receipt.isCreditSale && (
        <>
          <Row label={L.balance} value={fmt(receipt.totalCents)} bold />
          <div style={{ textAlign: 'center', margin: '4px 0' }}>
            <span style={{
              display: 'inline-block', padding: '2px 10px',
              border: '1.5px solid #000', borderRadius: 3,
              fontSize: 11, fontWeight: 700, letterSpacing: 1,
            }}>
              {L.creditSale}
            </span>
          </div>
        </>
      )}
      {receipt.isStaffSale && (
        <div style={{
          textAlign: 'center', border: '1px solid #4c1d95',
          borderRadius: 3, padding: '3px 6px', margin: '4px 0',
          fontSize: 11, fontWeight: 700, color: '#4c1d95',
        }}>
          &#9733; STAFF PURCHASE &#8212; COST PRICE &#9733;
        </div>
      )}

      {/* ── FOOTER ── */}
      <Divider />
      <p style={{ fontSize: 9, margin: '1px 0' }}>
        {L.itemCount}: {receipt.lines.reduce((s, l) => s + l.qty, 0)}
      </p>

      {settings.receiptShowBarcode && (
        <div style={{ margin: '6px 0 2px', textAlign: 'center' }}>
          <SimpleBarcodeBar value={receipt.number} />
          <p style={{ fontSize: 8, textAlign: 'center', margin: '2px 0 0', letterSpacing: 1 }}>
            {receipt.number}
          </p>
        </div>
      )}

      {settings.posReceiptFooter && (
        <>
          <Divider />
          <p style={{ textAlign: 'center', fontSize: 10, margin: '2px 0' }}>
            {settings.posReceiptFooter}
          </p>
        </>
      )}

      <Divider />
      <p style={{ textAlign: 'center', fontSize: 10, fontWeight: 500, margin: '2px 0' }}>{L.thankYou}</p>
      <p style={{ textAlign: 'center', fontSize: 8, color: '#888', margin: '1px 0 4px' }}>{L.poweredBy}</p>
    </div>
  );
}
