-- Ledger API schema
-- The chain is the source of truth for money movement and status; Postgres holds only what the chain
-- cannot: encrypted invoice terms, session state, and a fast read cache reconciled from indexed events.

create table if not exists merchants (
    address         text primary key,          -- lowercase 0x wallet address (issuer)
    display_name    text,
    email           text,
    telegram_handle text,
    created_at      timestamptz not null default now()
);

-- Encrypted invoice terms. `id` mirrors the on-chain invoiceId once known; a row may exist briefly
-- before the on-chain tx confirms (client-generated draft id), then gets reconciled.
create table if not exists invoice_blobs (
    invoice_id      bigint primary key,
    issuer          text not null references merchants(address),
    payer_hint      text,                       -- display-only email/wallet hint, never authoritative
    ciphertext      text not null,              -- AES-GCM ciphertext, base64
    iv              text not null,              -- base64
    commitment      text not null,              -- 0x-hex keccak256(ciphertext || salt), must match chain
    -- The decryption key itself is NEVER stored server-side; it lives only in the pay-link URL fragment.
    created_at      timestamptz not null default now()
);

-- Fast read cache of on-chain invoice state, kept in sync by the indexer/keeper. The API always treats
-- this as a cache: any state-changing decision re-reads the chain, this table only powers listings.
create table if not exists invoice_cache (
    invoice_id      bigint primary key,
    issuer          text not null,
    payer           text,
    amount          numeric(38,0) not null,
    paid            numeric(38,0) not null default 0,
    due_date        timestamptz not null,
    status          smallint not null,          -- mirrors InvoiceStatus enum ordinal
    financed        boolean not null default false,
    tx_hash         text,
    updated_at      timestamptz not null default now()
);
create index if not exists idx_invoice_cache_issuer on invoice_cache(issuer);
create index if not exists idx_invoice_cache_payer on invoice_cache(payer);
create index if not exists idx_invoice_cache_status on invoice_cache(status);

create table if not exists splits (
    split_id        text primary key,           -- SplitterFactory.salt(recipients, bps), 0x-hex
    owner           text not null references merchants(address),
    label           text,
    recipients      jsonb not null,              -- [{address, bps}]
    splitter_addr   text,                        -- filled once deployed via getOrCreate
    created_at      timestamptz not null default now()
);

-- Wallet-signature auth (see docs/SYSTEM_DESIGN.md §16 "Wallet connection").
create table if not exists auth_challenges (
    id              text primary key,           -- nanoid
    address         text not null,
    origin          text not null,
    nonce           text not null,
    issued_at       timestamptz not null default now(),
    expires_at      timestamptz not null,
    consumed        boolean not null default false
);

create table if not exists sessions (
    token_hash      text primary key,           -- sha256 of the opaque session token; never store the raw token
    address         text not null,
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null
);

-- Checkout sessions (hosted pay page state; the chain remains the settlement authority).
create table if not exists checkout_sessions (
    id              text primary key,
    invoice_id      bigint not null,
    return_url      text,
    status          text not null default 'pending', -- pending | paid | expired
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null
);

-- Webhook subscriptions (merchant integrations).
create table if not exists webhooks (
    id              text primary key,
    owner           text not null references merchants(address),
    url             text not null,
    secret_hash     text not null,
    events          jsonb not null default '[]',
    created_at      timestamptz not null default now()
);
