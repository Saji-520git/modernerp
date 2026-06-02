// WhatsApp module shared types. Dates are ISO strings.

export type WhatsAppMode = 'WEB' | 'API';
export type WhatsAppProvider = 'NONE' | 'META' | 'TWILIO';
export type WhatsAppStatus = 'PENDING' | 'SENT' | 'FAILED';
export type TemplateLanguage = 'en' | 'si';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface WhatsAppConfig {
  id: string;
  isEnabled: boolean;
  mode: WhatsAppMode;
  provider: WhatsAppProvider;
  apiKey: string | null;        // masked on read (•••• when set)
  apiSecret: string | null;     // masked on read
  phoneNumberId: string | null;
  businessId: string | null;
  twilioSid: string | null;
  twilioToken: string | null;   // masked on read
  twilioFrom: string | null;
  ownerPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateWhatsAppConfigDto {
  isEnabled?: boolean;
  mode?: WhatsAppMode;
  provider?: WhatsAppProvider;
  apiKey?: string | null;
  apiSecret?: string | null;
  phoneNumberId?: string | null;
  businessId?: string | null;
  twilioSid?: string | null;
  twilioToken?: string | null;
  twilioFrom?: string | null;
  ownerPhone?: string | null;
}

// ─── Templates ──────────────────────────────────────────────────────────────────

export interface WhatsAppTemplate {
  id: string;
  name: string;
  type: string;
  language: TemplateLanguage;
  subject: string | null;
  bodyEn: string;
  bodySi: string | null;
  isActive: boolean;
  isEditable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateTemplateDto {
  bodyEn?: string;
  bodySi?: string | null;
  subject?: string | null;
  isActive?: boolean;
}

// ─── Log ──────────────────────────────────────────────────────────────────────

export interface WhatsAppLog {
  id: string;
  to: string;
  customerId: string | null;
  templateId: string | null;
  message: string;
  mode: WhatsAppMode;
  status: WhatsAppStatus;
  provider: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

// ─── Send results ──────────────────────────────────────────────────────────────

export interface SendResult {
  mode: WhatsAppMode;
  to: string;
  message: string;
  waLink?: string;   // WEB mode
  success?: boolean; // API mode
  messageId?: string;
  error?: string;
}

export interface BroadcastResult {
  outcomes: SendResult[];
  links: string[];
  sent: number;
  failed: number;
  skipped: string[];
}
