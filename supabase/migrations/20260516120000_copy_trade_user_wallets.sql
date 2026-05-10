-- Per-user custodial deposit wallets for copy trade (opt-in). Secrets are stored encrypted server-side.

create table if not exists public.copy_trade_user_wallets (
  discord_user_id text primary key,
  public_key text not null,
  secret_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint copy_trade_user_wallets_pubkey_unique unique (public_key)
);

create index if not exists copy_trade_user_wallets_created_idx
  on public.copy_trade_user_wallets (created_at desc);

comment on table public.copy_trade_user_wallets is
  'One custodial Solana keypair per Discord user who opts into copy trade; fund via public_key. Buys/sells sign with decrypted secret on the server.';
comment on column public.copy_trade_user_wallets.secret_encrypted is
  'AES-256-GCM payload (base64): iv(12) + tag(16) + ciphertext — key from COPY_TRADE_WALLET_ENCRYPTION_KEY.';
