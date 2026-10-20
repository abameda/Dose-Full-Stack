-- 0004: webhook receipts and the outbox. Rule 8: a provider event changes state once, however
-- often or in whatever order it arrives; the unique (provider, event_id) pair is what makes a
-- redelivery a no-op. Rule 11: a message to a provider is saved in the same transaction as the
-- change that causes it, then delivered by a worker that claims it under a lease and, on a retry,
-- asks the provider whether the earlier attempt already got through.

-- One row per provider event applied. Inserted in the same transaction as the event's effects,
-- so an event whose effects roll back leaves no receipt and is applied by the next delivery.
create table webhook_receipts (
  id bigserial primary key,
  provider text not null check (provider <> ''),
  event_id text not null check (event_id <> ''),
  received_at timestamptz not null default now(),
  payload jsonb not null,
  unique (provider, event_id)
);

create table outbox (
  id bigserial primary key,
  -- Which handler delivers it (e.g. 'shipment' once Bosta arrives in M3).
  kind text not null check (kind <> ''),
  -- Enqueueing the same key again keeps the first message. The provider is asked by this key
  -- whether an earlier attempt got through, so it is also the provider-side idempotency key.
  dedupe_key text not null unique check (dedupe_key <> ''),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done')),
  -- Claims so far, including the current one.
  attempts int not null default 0 check (attempts >= 0),
  -- Set while claimed: until then no other worker may take it; after, it may be reclaimed.
  claimed_until timestamptz,
  provider_ref text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint outbox_claim_has_lease check (status <> 'claimed' or claimed_until is not null),
  constraint outbox_done_has_time check ((status = 'done') = (done_at is not null))
);
-- Workers look only at messages not yet delivered.
create index outbox_open_idx on outbox (id) where status <> 'done';

-- Application role: the default grant of decision 0003, never DELETE. Webhook receipts are an
-- append-only record of what each provider sent (rule 8), so the app role may only read and add to them.
grant select, insert, update on outbox to dose_app;
grant select, insert on webhook_receipts to dose_app;
grant usage on sequence webhook_receipts_id_seq, outbox_id_seq to dose_app;
