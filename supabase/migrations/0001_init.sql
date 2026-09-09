-- Esquema de TalkMe sobre Supabase: perfiles, red de contactos con
-- aceptación mutua, mensajes y suscripciones push. Toda la lógica de
-- autorización que antes vivía en Express ahora vive aquí, como RLS +
-- funciones RPC (security definer) que el cliente llama directamente.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

create table public.contacts (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.profiles (id) on delete cascade,
  primary key (owner_id, contact_id)
);

create table public.contact_requests (
  id bigint generated always as identity primary key,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_id, to_id)
);

create table public.messages (
  id bigint generated always as identity primary key,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_requests enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles: visibles para cualquier usuario autenticado (hace falta para
-- poder buscar a alguien por username al pedir contacto); cada uno solo
-- puede tocar su propia fila. El alta de perfiles la hace la Edge
-- Function "register" con la service role, que salta RLS.
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- contacts: solo puedes ver tu propia lista. Los cambios sólo se hacen a
-- través de las funciones RPC de abajo (security definer), nunca por
-- insert/update/delete directo del cliente.
create policy "contacts_select_own" on public.contacts
  for select to authenticated using (auth.uid() = owner_id);

-- contact_requests: solo ves las que has enviado o recibido; escritura
-- únicamente vía RPC.
create policy "contact_requests_select_own" on public.contact_requests
  for select to authenticated using (auth.uid() = from_id or auth.uid() = to_id);

-- messages: solo ves las conversaciones en las que participas; el envío
-- pasa siempre por send_message(), que comprueba que sois contactos.
create policy "messages_select_own" on public.messages
  for select to authenticated using (auth.uid() = from_id or auth.uid() = to_id);

-- push_subscriptions: cada usuario gestiona directamente las suyas.
create policy "push_subscriptions_all_own" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Funciones RPC
-- ---------------------------------------------------------------------

-- Envía una solicitud de contacto por username. Si la otra persona ya te
-- había solicitado a ti, se aceptan mutuamente al instante.
create or replace function public.request_contact(target_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_id uuid;
  reciprocal_id bigint;
  new_request_id bigint;
begin
  if me is null then
    raise exception 'No autenticado';
  end if;

  select id into target_id from public.profiles where username = target_username;
  if target_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if target_id = me then
    return jsonb_build_object('status', 'self');
  end if;

  if exists (select 1 from public.contacts where owner_id = me and contact_id = target_id) then
    return jsonb_build_object('status', 'already_contact');
  end if;

  select id into reciprocal_id
    from public.contact_requests
    where from_id = target_id and to_id = me;

  if reciprocal_id is not null then
    insert into public.contacts (owner_id, contact_id) values (me, target_id), (target_id, me)
      on conflict do nothing;
    delete from public.contact_requests where id = reciprocal_id;
    return jsonb_build_object('status', 'accepted', 'contact_id', target_id);
  end if;

  if exists (select 1 from public.contact_requests where from_id = me and to_id = target_id) then
    return jsonb_build_object('status', 'already_pending');
  end if;

  insert into public.contact_requests (from_id, to_id) values (me, target_id)
    returning id into new_request_id;
  return jsonb_build_object('status', 'pending', 'request_id', new_request_id);
end;
$$;

-- Acepta una solicitud recibida.
create or replace function public.accept_contact_request(request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  req record;
begin
  select * into req from public.contact_requests where id = request_id and to_id = me;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.contacts (owner_id, contact_id)
    values (req.from_id, req.to_id), (req.to_id, req.from_id)
    on conflict do nothing;
  delete from public.contact_requests where id = request_id;

  return jsonb_build_object('status', 'accepted', 'contact_id', req.from_id);
end;
$$;

-- Rechaza o cancela una solicitud en la que participas.
create or replace function public.reject_contact_request(request_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  removed int;
begin
  delete from public.contact_requests
    where id = request_id and (to_id = me or from_id = me);
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

-- Envía un mensaje, comprobando primero que el destinatario es tu contacto.
create or replace function public.send_message(to_id uuid, body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  trimmed text := trim(coalesce(body, ''));
  msg public.messages;
begin
  if me is null then
    raise exception 'No autenticado';
  end if;
  if trimmed = '' then
    raise exception 'Mensaje vacío';
  end if;
  if not exists (select 1 from public.contacts where owner_id = me and contact_id = send_message.to_id) then
    raise exception 'Ese usuario no está en tu red';
  end if;

  insert into public.messages (from_id, to_id, body)
    values (me, send_message.to_id, trimmed)
    returning * into msg;
  return msg;
end;
$$;

grant execute on function
  public.request_contact(text),
  public.accept_contact_request(bigint),
  public.reject_contact_request(bigint),
  public.send_message(uuid, text)
to authenticated;
