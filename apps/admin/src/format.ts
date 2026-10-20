import type { AuditEntry, OrderDetail, TimelineEntry } from '@dose/contract';
import { formatEgp } from '@dose/contract/money';
import { ACTION_AS_EVENT, ACTION_VERB, CANCEL_REASON_LABEL, CONFIRM_METHOD_LABEL } from './i18n';

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const plural = (count: number, unit: string) => `${String(count)} ${unit}${count === 1 ? '' : 's'}`;

/** How long something has waited: "less than a minute", "2 hours 15 minutes", "1 day 3 hours". */
export function formatWaiting(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  const parts: string[] = [];
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (days > 0) {
    parts.push(plural(days, 'day'));
    if (hours > 0) parts.push(plural(hours, 'hour'));
  } else {
    if (hours > 0) parts.push(plural(hours, 'hour'));
    if (rest > 0) parts.push(plural(rest, 'minute'));
  }
  return parts.join(' ');
}

const dateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateTimeWithYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "20 Oct, 14:05" in the browser's time zone; the year is added for another year than this one. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return (at.getFullYear() === now.getFullYear() ? dateTime : dateTimeWithYear).format(at);
}

/** Who did it, inside a sentence: "customer +2010…", "Mona", "the system (expiry)". */
export function actorPhrase(actorType: TimelineEntry['actorType'], label: string): string {
  if (actorType === 'customer') return `customer ${label}`;
  if (actorType === 'system') return `the system (${label})`;
  return label;
}

/** Who did it, on its own: "Customer +2010…", "Mona", "System (expiry)". */
export function actorName(actorType: TimelineEntry['actorType'], label: string): string {
  if (actorType === 'customer') return `Customer ${label}`;
  if (actorType === 'system') return `System (${label})`;
  return label;
}

const CANCEL_REASON_NAMES: Readonly<Record<string, string>> = CANCEL_REASON_LABEL;
const CONFIRM_METHOD_NAMES: Readonly<Record<string, string>> = CONFIRM_METHOD_LABEL;
const ACTION_VERBS: Readonly<Record<string, string>> = ACTION_VERB;
const ACTION_EVENTS: Readonly<Record<string, string>> = ACTION_AS_EVENT;

/** The name of a cancel reason the API sent, or the raw text for one this build does not know. */
export function reasonLabel(reason: string): string {
  return CANCEL_REASON_NAMES[reason] ?? reason;
}

/** The name of a confirm method the API sent, or the raw text for one this build does not know. */
export function methodLabel(method: string): string {
  return CONFIRM_METHOD_NAMES[method] ?? method;
}

/**
 * One timeline line in words: "Placed by customer +2010…", "Confirmed by Mona · WhatsApp",
 * "Cancelled by the system (expiry) · Confirmation window expired". An action this build has no
 * word for is shown by its name, so nothing the API records is hidden.
 */
export function timelineSentence(entry: Omit<TimelineEntry, 'at'> & { at?: string }): string {
  const who = actorPhrase(entry.actorType, entry.actorLabel);
  const verb = ACTION_VERBS[entry.action] ?? entry.action;
  const detail = [entry.method === undefined ? null : methodLabel(entry.method), entry.reason === undefined ? null : reasonLabel(entry.reason)]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return `${verb} by ${who}${detail === '' ? '' : ` · ${detail}`}`;
}

// ── The WhatsApp confirmation ───────────────────────────────────────────────────────────────

/** The short message staff send to confirm an order, in the language the customer ordered in. */
export function confirmationMessage(order: OrderDetail): string {
  const total = formatEgp(order.total, order.lang);
  return order.lang === 'ar'
    ? `أهلاً ${order.customerName}، معاك DÖSE. وصلنا طلبك رقم ${order.number} بإجمالي ${total} والدفع كاش عند الاستلام. تأكدلنا إنك عايز الطلب؟ ابعت "تمام" ونجهزه لك.`
    : `Hello ${order.customerName}, this is DÖSE. We received your order ${order.number} for ${total}, paid in cash on delivery. Can you confirm you want it? Reply "yes" and we will prepare it.`;
}

/** A WhatsApp click-to-chat link to the customer with the confirmation message ready to send. */
export function whatsappLink(order: OrderDetail): string {
  const digits = order.customerPhone.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(confirmationMessage(order))}`;
}

/** "cairo" → "Cairo", "north_sinai" → "North sinai": the API sends the governorate's code. */
export function governorateName(code: string): string {
  const words = code.replace(/[-_]+/g, ' ').trim();
  return words === '' ? code : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One audit event in words: "Order confirmed · WhatsApp · “note”". An action this build has no
 * word for is shown by its name.
 */
export function eventSentence(event: AuditEntry): string {
  const { method, note } = event.data;
  const parts = [
    ACTION_EVENTS[event.action] ?? event.action,
    typeof method === 'string' ? methodLabel(method) : null,
    event.reason === null ? null : reasonLabel(event.reason),
    typeof note === 'string' && note !== '' ? `“${note}”` : null,
  ];
  return parts.filter((part): part is string => part !== null).join(' · ');
}
