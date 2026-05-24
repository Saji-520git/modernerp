# Module: POS Shifts

## Purpose

A POS shift represents a cashier's work session at a warehouse terminal.
It tracks the opening float, every sale made during the session, and the
physical cash count at close, producing an end-of-shift reconciliation
report that shows expected vs actual cash and flags any variance.

---

## User Stories

- As a CASHIER, I can open a shift by recording my opening cash float so
  that all subsequent sales are attributed to my session.
- As a CASHIER, I can see my current shift status (start time, running
  total) in the POS header so that I always know the session is active.
- As a CASHIER, I can close my shift by entering the counted cash so that
  management can reconcile the till.
- As a MANAGER/ADMIN, I can view any closed shift's full breakdown — sales
  by payment method, expected cash, actual cash, and variance — so that I
  can detect discrepancies.
- As a MANAGER/ADMIN, I can list all shifts filtered by date, warehouse,
  or cashier so that I can review daily reconciliation at a glance.
- As an ADMIN, I can force-close an open shift (e.g. if a cashier forgot)
  with a note explaining the reason.

---

## Business Rules

1. **One open shift per user per warehouse at a time.** Attempting to open
   a second shift at the same warehouse while one is already open returns
   HTTP 409.
2. **Every POS sale is linked to the active shift.** At checkout,
   `pos.service.ts` resolves the caller's open shift and writes `shiftId`
   on the new `Sale` row. If no shift is open, checkout is rejected with
   HTTP 400 "No open shift — please open a shift before selling."
3. **Variance is calculated at close, not stored as live data.**
   - `expectedCashCents = openingCashCents + cashSalesCents`
   - `varianceCents     = closingCashCents − expectedCashCents`
   - Positive variance = overage (more cash than expected).
   - Negative variance = shortage (less cash than expected).
4. **Sales breakdown stored on close, not recomputed later.** When a shift
   is closed, `confirmClose` aggregates the linked sales by payment method
   and writes the totals to the shift row. This snapshot is immutable.
5. **Only DRAFT/CONFIRMED sales count toward a shift.** CANCELLED sales
   are excluded from all totals.
6. **A closed shift cannot be reopened.** Status transitions: OPEN → CLOSED
   only. No CANCELLED state.
7. **Permissions:**
   - `manage_shifts` — open and close own shift (CASHIER, MANAGER, ADMIN).
   - `view_all_shifts` — list and view shifts of other users (MANAGER, ADMIN).
   - Force-close requires ADMIN role.

---

## Schema Changes

### Extend `PosShift` (existing model)

The model at `@@map("pos_shifts")` currently has:
`id, userId, openedAt, closedAt, openingCashCents, closingCashCents,
totalSalesCents, status, createdAt, updatedAt`

**Add the following fields:**

```prisma
model PosShift {
  id               String      @id @default(cuid())
  userId           String
  user             User        @relation(fields: [userId], references: [id])
  warehouseId      String                          // ← NEW
  warehouse        Warehouse   @relation(...)      // ← NEW

  status           ShiftStatus @default(OPEN)
  openedAt         DateTime    @default(now())
  closedAt         DateTime?

  // Opening float entered by cashier
  openingCashCents Int         @default(0)

  // Filled in at close by the service (snapshot, never recomputed)
  closingCashCents    Int?     // cashier's physical count
  cashSalesCents      Int      @default(0)   // ← NEW  (CASH payment total)
  cardSalesCents      Int      @default(0)   // ← NEW  (CARD payment total)
  bankTransferCents   Int      @default(0)   // ← NEW
  qrPayCents          Int      @default(0)   // ← NEW
  creditSalesCents    Int      @default(0)   // ← NEW
  totalSalesCents     Int      @default(0)   // all methods combined
  saleCount           Int      @default(0)   // ← NEW  number of sales
  expectedCashCents   Int?                   // ← NEW  opening + cashSales
  varianceCents       Int?                   // ← NEW  closing − expected
  note                String?                // ← NEW  optional manager note

  // Force-close audit
  forceClosedById  String?                   // ← NEW
  forceClosedBy    User?   @relation("ShiftForceClose", ...)  // ← NEW

  sales     Sale[]     // ← NEW reverse relation
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@map("pos_shifts")
}
```

### Extend `Sale`

```prisma
model Sale {
  // ... existing fields ...
  shiftId  String?             // ← NEW  null for non-POS or pre-shift sales
  shift    PosShift? @relation(fields: [shiftId], references: [id])
}
```

### Extend `User`

```prisma
model User {
  // ... existing fields ...
  posShifts         PosShift[]  @relation("ShiftUser")
  forceClosedShifts PosShift[]  @relation("ShiftForceClose")
}
```

### Migration

```
migrations/20260520000001_pos_shift_fields/migration.sql
```

```sql
-- Extend pos_shifts
ALTER TABLE "pos_shifts"
  ADD COLUMN IF NOT EXISTS "warehouseId"        TEXT,
  ADD COLUMN IF NOT EXISTS "cashSalesCents"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cardSalesCents"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bankTransferCents"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "qrPayCents"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditSalesCents"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "saleCount"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expectedCashCents"  INTEGER,
  ADD COLUMN IF NOT EXISTS "varianceCents"      INTEGER,
  ADD COLUMN IF NOT EXISTS "note"               TEXT,
  ADD COLUMN IF NOT EXISTS "forceClosedById"    TEXT;

-- FK: pos_shifts → warehouses
ALTER TABLE "pos_shifts"
  ADD CONSTRAINT "pos_shifts_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: pos_shifts → users (force-close)
ALTER TABLE "pos_shifts"
  ADD CONSTRAINT "pos_shifts_forceClosedById_fkey"
  FOREIGN KEY ("forceClosedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend Sale with shiftId
ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "shiftId" TEXT;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

---

## API Endpoints

All routes mounted at `/api/v1/pos/shifts`. All require `requireAuth`.

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `POST` | `/open` | `manage_shifts` | Open a new shift |
| `GET` | `/current` | `manage_shifts` | Get caller's open shift (null if none) |
| `POST` | `/:id/close` | `manage_shifts` | Close a shift (own only, unless ADMIN) |
| `POST` | `/:id/force-close` | ADMIN role | Force-close any open shift |
| `GET` | `/` | `view_all_shifts` | List shifts (paginated, filterable) |
| `GET` | `/:id` | `view_all_shifts` | Get single shift with sales detail |

### `POST /pos/shifts/open`

**Request body:**
```json
{
  "openingCashCents": 5000,
  "warehouseId": "clx..."
}
```

**Behaviour:**
1. Check no open shift already exists for `(userId, warehouseId)` → 409 if found.
2. Insert `PosShift` with `status: OPEN`.
3. Return the new shift.

**Response:** `201 PosShift`

---

### `GET /pos/shifts/current`

Returns the caller's currently OPEN shift at any warehouse, or `null`.
Used by the POS page on load to decide whether to prompt "Open Shift".

**Response:** `200 PosShift | null`

---

### `POST /pos/shifts/:id/close`

**Request body:**
```json
{
  "closingCashCents": 23500,
  "note": "Short by Rs. 150 — checked drawer twice"
}
```

**Behaviour:**
1. Verify shift exists, belongs to caller (or caller is ADMIN), status is OPEN.
2. Aggregate linked `Sale` rows (`isPos: true`, status `CONFIRMED` or `DRAFT`,
   `shiftId = id`) grouped by `paymentMethod`.
3. Compute:
   - `cashSalesCents`, `cardSalesCents`, `bankTransferCents`, `qrPayCents`,
     `creditSalesCents`, `totalSalesCents`, `saleCount`
   - `expectedCashCents = openingCashCents + cashSalesCents`
   - `varianceCents = closingCashCents − expectedCashCents`
4. Update shift: set all computed fields, `status: CLOSED`, `closedAt: now()`.
5. Return the closed shift.

**Response:** `200 PosShift`

---

### `POST /pos/shifts/:id/force-close`

ADMIN only. Same as `/close` but sets `forceClosedById` to the admin's `userId`
and accepts an optional `note` explaining why.

---

### `GET /pos/shifts`

Query params: `page`, `pageSize`, `warehouseId`, `userId`, `status` (OPEN/CLOSED),
`from` (date), `to` (date).

Returns paginated list with: `id, user.fullName, warehouse.name, openedAt,
closedAt, totalSalesCents, saleCount, varianceCents, status`.

---

### `GET /pos/shifts/:id`

Returns full shift detail including:
- Shift header fields
- Payment method breakdown
- `sales[]` — all linked sales (id, number, totalCents, paymentMethod, createdAt, customer.name)

---

## Checkout Integration

In `pos.service.ts` `checkout()`, add before the transaction:

```typescript
// Resolve active shift for this user+warehouse
const shift = await prisma.posShift.findFirst({
  where: { userId, warehouseId, status: 'OPEN' },
});
if (!shift) throw new HttpError(400, 'No open shift — please open a shift before selling');
```

Inside the transaction, set `shiftId: shift.id` on the created `Sale`:

```typescript
const created = await tx.sale.create({
  data: {
    ...saleData,
    shiftId: shift.id,   // ← link sale to shift
  },
});
```

---

## Permissions

Add to `backend/src/config/permissions.ts`:

```typescript
'manage_shifts',    // open / close own shift
'view_all_shifts',  // view shifts for all users
```

Default role assignments:

| Permission | ADMIN | MANAGER | CASHIER | STAFF |
|---|---|---|---|---|
| `manage_shifts` | ✓ | ✓ | ✓ | — |
| `view_all_shifts` | ✓ | ✓ | — | — |

---

## Frontend

### New files

```
frontend/src/
  services/
    shifts.ts              — ShiftApi types + API calls
  pages/
    shifts/
      ShiftsPage.tsx        — shift history table + detail drawer
  components/
    pos/
      ShiftBanner.tsx       — compact status bar inside POS page
      OpenShiftModal.tsx    — enter opening cash + warehouse selector
      CloseShiftModal.tsx   — cash count form + reconciliation preview
```

### `services/shifts.ts`

```typescript
export interface PosShift {
  id: string;
  userId: string;
  user: { fullName: string };
  warehouseId: string;
  warehouse: { name: string; code: string };
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingCashCents: number;
  closingCashCents: number | null;
  cashSalesCents: number;
  cardSalesCents: number;
  bankTransferCents: number;
  qrPayCents: number;
  creditSalesCents: number;
  totalSalesCents: number;
  saleCount: number;
  expectedCashCents: number | null;
  varianceCents: number | null;
  note: string | null;
}

export interface OpenShiftPayload {
  openingCashCents: number;
  warehouseId: string;
}

export interface CloseShiftPayload {
  closingCashCents: number;
  note?: string;
}

export const shiftsApi = {
  open:         (p: OpenShiftPayload)             => api.post('/pos/shifts/open', p).then(r => r.data),
  current:      ()                                 => api.get('/pos/shifts/current').then(r => r.data),
  close:        (id: string, p: CloseShiftPayload) => api.post(`/pos/shifts/${id}/close`, p).then(r => r.data),
  forceClose:   (id: string, p: CloseShiftPayload) => api.post(`/pos/shifts/${id}/force-close`, p).then(r => r.data),
  list:         (params?: object)                  => api.get('/pos/shifts', { params }).then(r => r.data),
  getOne:       (id: string)                       => api.get(`/pos/shifts/${id}`).then(r => r.data),
};
```

---

### `ShiftBanner` (inside POS page)

Rendered at the top of `POSPage.tsx` when a shift is open:

```
┌─────────────────────────────────────────────────────────────┐
│  🟢  Shift open since 09:14 AM    │  23 sales  │  Rs 48,500  │  [Close Shift]  │
└─────────────────────────────────────────────────────────────┘
```

If no shift is open, POS renders a full-screen `OpenShiftModal` and blocks
all cart interaction until a shift is opened.

---

### `OpenShiftModal`

```
┌─────────────────────────────────────┐
│  Open New Shift                     │
│                                     │
│  Warehouse  [ Main Store     ▼ ]    │
│                                     │
│  Opening Cash Float (Rs.)           │
│  [ 5,000.00                  ]      │
│                                     │
│  [ Cancel ]    [ Open Shift → ]     │
└─────────────────────────────────────┘
```

On submit: calls `shiftsApi.open()`, invalidates `['shift-current']` query,
closes modal, renders `ShiftBanner`.

---

### `CloseShiftModal`

```
┌───────────────────────────────────────────────────┐
│  Close Shift                                      │
│  Started: 09:14 AM · 23 sales                    │
│                                                   │
│  Sales Breakdown                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Cash            Rs. 18,500               │    │
│  │ Card            Rs. 24,000               │    │
│  │ QR Pay          Rs.  6,000               │    │
│  │ Bank Transfer   Rs.      0               │    │
│  │ Credit          Rs.      0               │    │
│  │ ─────────────────────────────────────    │    │
│  │ Total Sales     Rs. 48,500               │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  Expected Cash in Drawer                          │
│  Opening Float  Rs.  5,000                       │
│  + Cash Sales   Rs. 18,500                       │
│  ─────────────────────────────────────────       │
│  Expected       Rs. 23,500                       │
│                                                   │
│  Actual Cash Counted (Rs.)                        │
│  [ 23,200.00                        ]            │
│                                                   │
│  Variance  Rs. -300  ← shown live, red/green     │
│                                                   │
│  Note (optional)                                  │
│  [ Short Rs. 300 — recount done    ]             │
│                                                   │
│  [ Cancel ]    [ Close Shift ]                    │
└───────────────────────────────────────────────────┘
```

Variance is computed live in the browser as the cashier types the counted
amount. Positive = green, negative = red, zero = green.

On submit: calls `shiftsApi.close()`, navigates away from POS or shows
a receipt-style "Shift Closed" summary.

---

### `ShiftsPage`

Route: `/shifts`  
Nav: shown for `view_all_shifts` permission (ADMIN, MANAGER).

**List view** — table columns:
`#`, `Cashier`, `Warehouse`, `Opened At`, `Closed At`, `Sales`, `Total`,
`Cash Variance`, `Status`

Variance cell: green chip for ≥ 0, red chip for < 0, `—` if shift still open.

**Detail drawer** (click any row):
- Shift metadata (cashier, warehouse, times)
- Payment method breakdown table
- Variance row highlighted
- List of all sales in this shift (number, time, amount, method, customer)
- Force-close button (ADMIN only, visible when status = OPEN)

---

## File Checklist (when building)

```
backend/
  src/
    modules/
      pos/
        shift.service.ts      — open, close, forceClose, current, list, getOne
        shift.controller.ts
        shift.routes.ts       — merged into existing pos.routes.ts
        shift.schema.ts       — Zod: openShiftSchema, closeShiftSchema, listShiftsSchema
    config/
      permissions.ts          — add manage_shifts, view_all_shifts
    prisma/
      schema.prisma           — extend PosShift + Sale.shiftId
      migrations/
        20260520000001_pos_shift_fields/migration.sql

frontend/
  src/
    services/
      shifts.ts
    pages/
      shifts/
        ShiftsPage.tsx
    components/
      pos/
        ShiftBanner.tsx
        OpenShiftModal.tsx
        CloseShiftModal.tsx
    pages/pos/POSPage.tsx     — integrate ShiftBanner, OpenShiftModal, shiftId on checkout
    components/layout/AppShell.tsx  — add Shifts nav item (MANAGER/ADMIN only)
    App.tsx                         — add /shifts route
```

---

## Open Questions (resolve before building)

1. **Multi-terminal shifts** — should one cashier be allowed to have one open
   shift per warehouse, or exactly one open shift system-wide? Current spec:
   one per `(userId, warehouseId)`.
2. **Shift-less sales** — should the system hard-block POS checkout when no
   shift is open, or allow it with a warning? Current spec: hard-block.
3. **Running total update** — `totalSalesCents` and `saleCount` on the shift
   row: update in real-time on each checkout, or only compute at close?
   Real-time is simpler for the `ShiftBanner` display but adds one extra
   `UPDATE` per checkout. Current spec: update in real-time inside the
   checkout transaction.
4. **Partial-day shifts** — a shift that spans midnight: use `openedAt` date
   or `closedAt` date for reporting? Recommend `openedAt`.
5. **Delete shifts** — should closed shifts be deletable (soft or hard)?
   Current spec: no delete endpoint; shifts are permanent audit records.
