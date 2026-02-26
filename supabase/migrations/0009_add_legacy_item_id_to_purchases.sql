alter table purchases
  add column if not exists legacy_item_id text;
