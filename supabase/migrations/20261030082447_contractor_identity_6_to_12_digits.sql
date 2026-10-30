alter table public.contractors drop constraint contractors_identity_reference_check;
alter table public.contractors add constraint contractors_identity_reference_check check (identity_reference ~ '^[0-9]{6,12}$');
