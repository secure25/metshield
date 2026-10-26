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

export interface Observation {
  id: string;
  externalRef: string;
  source: ObservationSource;
  observedAt: string;
  surface: Surface;
  eventKind: EventKind;
  actorRef: string;
  subjectRef: string | null;
  threadRef: string | null;
  indicators: Indicator[];
  claimCodes: string[];
  consent: 'none';
  synthetic: boolean;
}
