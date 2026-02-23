alter table purchases
  add column if not exists sale_date date,
  add column if not exists installment_plan text;
