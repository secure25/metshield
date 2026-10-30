// Shared types, owned by the product side.
// This is the only module shared between the world fixture and MetShield.
// Privacy boundary: observable refs and indicators only.
export type ObservationSource = 'world' | 'public_feed' | 'submission';

export type Surface = 'facebook' | 'messenger' | 'whatsapp';

export type EventKind = 'message' | 'post' | 'ad' | 'group_invite' | 'link';

export type IndicatorKind =
  | 'payment_handle'
  | 'offplatform_link'
  | 'urgency_phrase'
  | 'credential_request'
  | 'impersonated_brand'
  | 'unsolicited_contact'
  | 'prize_claim';

export type Indicator =
  | { kind: 'payment_handle'; value: string }
  | { kind: 'offplatform_link'; value: string }
  | { kind: 'urgency_phrase'; value: string }
  | { kind: 'credential_request'; value: string }
  | { kind: 'impersonated_brand'; value: string }
  | { kind: 'unsolicited_contact'; value: string }
  | { kind: 'prize_claim'; value: string };

// Product-side vocabulary (P0). The world emits the three Surfaces and seven
// narrative IndicatorKinds above; these cover what the product adds. The
// world never uses them.
export type ObservationSurface = Surface | 'public_feed' | 'user_submission';

export type IndicatorFamily =
  | 'domain'
  | 'payment_handle'
  | 'phone'
  | 'qr_payload'
  | 'brand_mark'
  | 'page_ref'
  | 'ad_ref'
  | 'account_ref'
  | 'file_hash';

export interface Observation {
  id: string;
  // Verbatim upstream id, when a source needs one echoed back. Optional:
  // public and submission sources may have nothing to echo.
  externalRef?: string;
  source: ObservationSource;
  observedAt: string;
  surface: ObservationSurface;
  eventKind: EventKind;
  actorRef: string;
  subjectRef: string | null;
  threadRef: string | null;
  indicators: Indicator[];
  claimCodes: string[];
  consent: 'none' | 'user_submitted' | 'public_source';
  synthetic: boolean;
  // Conversation text can never be stored: assigning this field is a
  // compile error. See AGENTS.md rule 2.
  raw?: never;
}
