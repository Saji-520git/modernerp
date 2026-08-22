import { api } from './api';

export interface AuditEntry {
  id:       string;
  at:       string;
  userId:   string | null;
  /** Copied at write time, so a rename or deletion never rewrites history. */
  userName: string;
  userRole: string;
  action:   string;
  entity:   string;
  entityId: string | null;
  summary:  string;
  method:   string;
  path:     string;
  status:   number;
  ip:       string | null;
  meta:     unknown;
}

export interface AuditPage {
  total:    number;
  page:     number;
  pageSize: number;
  data:     AuditEntry[];
}

export interface AuditFacets {
  entities: string[];
  actions:  string[];
  users:    { id: string; name: string }[];
}

export interface AuditQuery {
  search?:   string;
  entity?:   string;
  action?:   string;
  userId?:   string;
  entityId?: string;
  from?:     string;
  to?:       string;
  page?:     number;
  pageSize?: number;
}

// Read-only on purpose — the API exposes no write, and neither does this.
export const auditApi = {
  list: (q: AuditQuery = {}): Promise<AuditPage> =>
    api.get<AuditPage>('/audit', { params: q }).then((r) => r.data),

  facets: (): Promise<AuditFacets> =>
    api.get<AuditFacets>('/audit/facets').then((r) => r.data),

  forEntity: (entity: string, entityId: string): Promise<AuditEntry[]> =>
    api.get<AuditEntry[]>(`/audit/${entity}/${entityId}`).then((r) => r.data),
};

/** Colour per action, so a page of entries can be scanned rather than read. */
export function actionTone(action: string): string {
  if (action === 'DELETE' || action === 'CANCEL' || action === 'WRITE_OFF') return 'bg-red-100 text-red-700';
  if (action === 'CREATE' || action === 'CONFIRM') return 'bg-emerald-100 text-emerald-700';
  if (action === 'LOGIN'  || action === 'LOGOUT')  return 'bg-slate-100 text-slate-600';
  if (action === 'PERMISSIONS' || action === 'RESTORE') return 'bg-amber-100 text-amber-700';
  return 'bg-indigo-100 text-indigo-700';
}
