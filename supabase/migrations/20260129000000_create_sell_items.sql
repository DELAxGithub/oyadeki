create table if not exists sell_items (
  id uuid default gen_random_uuid() primary key,
  line_user_id text not null,
  status text not null default 'analyzing',
  image_summary text,
  extracted_info jsonb default '{}'::jsonb,
  dialogue_history jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table sell_items enable row level security;
create policy "Allow generic access" on sell_items for all using (true) with check (true);
