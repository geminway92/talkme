-- Reinicio total del modelo de identidad: se quita Supabase Auth por
-- completo. Ahora la identidad es un ID numérico (tipo "teléfono") que se
-- genera solo, una vez, al crear la cuenta; se guarda en el localStorage
-- del dispositivo y se comparte con la familia para que te añadan. El PIN
-- solo actúa de candado dentro de la propia app.
--
-- AVISO: esto NO es seguridad real. No hay sesión de la que Postgres
-- pueda sacar "quién eres", así que no hay RLS que lo aplique — cualquiera
-- con la anon key podría, en teoría, leer o escribir estas tablas
-- directamente saltándose la app. Es una elección consciente para
-- máxima sencillez en un chat familiar de confianza, no para datos
-- sensibles. Ejecuta este archivo entero en el SQL Editor de Supabase
-- (sustituye por completo a 0001_init.sql).

drop function if exists public.send_message(uuid, text);
drop function if exists public.reject_contact_request(bigint);
drop function if exists public.accept_contact_request(bigint);
drop function if exists public.request_contact(text);

drop table if exists public.push_subscriptions;
drop table if exists public.messages;
drop table if exists public.contact_requests;
drop table if exists public.contacts;
drop table if exists public.profiles;

create table public.users (
  id bigint primary key,
  display_name text not null,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table public.contacts (
  owner_id bigint not null references public.users (id) on delete cascade,
  contact_id bigint not null references public.users (id) on delete cascade,
  primary key (owner_id, contact_id)
);

create table public.contact_requests (
  id bigint generated always as identity primary key,
  from_id bigint not null references public.users (id) on delete cascade,
  to_id bigint not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_id, to_id)
);

create table public.messages (
  id bigint generated always as identity primary key,
  from_id bigint not null references public.users (id) on delete cascade,
  to_id bigint not null references public.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Sin RLS: acceso abierto para anon/authenticated. La app se comporta
-- correctamente por convención (cada cliente solo pide/envía lo suyo),
-- no porque la base de datos se lo impida a un tercero.
grant select, insert, update, delete on
  public.users, public.contacts, public.contact_requests,
  public.messages, public.push_subscriptions
to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Envía una solicitud de contacto por ID. Si la otra persona ya te había
-- solicitado a ti, se aceptan mutuamente al instante.
create or replace function public.request_contact(me_id bigint, target_id bigint)
returns jsonb
language plpgsql
as $$
declare
  reciprocal_id bigint;
  new_request_id bigint;
begin
  if target_id = me_id then
    return jsonb_build_object('status', 'self');
  end if;
  if not exists (select 1 from public.users where id = target_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if exists (select 1 from public.contacts where owner_id = me_id and contact_id = target_id) then
    return jsonb_build_object('status', 'already_contact');
  end if;

  select id into reciprocal_id
    from public.contact_requests
    where from_id = target_id and to_id = me_id;

  if reciprocal_id is not null then
    insert into public.contacts (owner_id, contact_id) values (me_id, target_id), (target_id, me_id)
      on conflict do nothing;
    delete from public.contact_requests where id = reciprocal_id;
    return jsonb_build_object('status', 'accepted', 'contact_id', target_id);
  end if;

  if exists (select 1 from public.contact_requests where from_id = me_id and to_id = target_id) then
    return jsonb_build_object('status', 'already_pending');
  end if;

  insert into public.contact_requests (from_id, to_id) values (me_id, target_id)
    returning id into new_request_id;
  return jsonb_build_object('status', 'pending', 'request_id', new_request_id);
end;
$$;

-- Acepta una solicitud recibida.
create or replace function public.accept_contact_request(me_id bigint, request_id bigint)
returns jsonb
language plpgsql
as $$
declare
  req record;
begin
  select * into req from public.contact_requests where id = request_id and to_id = me_id;
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

-- Rechaza o cancela una solicitud.
create or replace function public.reject_contact_request(me_id bigint, request_id bigint)
returns boolean
language plpgsql
as $$
declare
  removed int;
begin
  delete from public.contact_requests
    where id = request_id and (to_id = me_id or from_id = me_id);
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

-- Envía un mensaje, comprobando primero que el destinatario es tu contacto.
create or replace function public.send_message(me_id bigint, to_id bigint, body text)
returns public.messages
language plpgsql
as $$
declare
  trimmed text := trim(coalesce(body, ''));
  msg public.messages;
begin
  if trimmed = '' then
    raise exception 'Mensaje vacío';
  end if;
  if not exists (select 1 from public.contacts where owner_id = me_id and contact_id = send_message.to_id) then
    raise exception 'Ese usuario no está en tu red';
  end if;

  insert into public.messages (from_id, to_id, body)
    values (me_id, send_message.to_id, trimmed)
    returning * into msg;
  return msg;
end;
$$;

grant execute on function
  public.request_contact(bigint, bigint),
  public.accept_contact_request(bigint, bigint),
  public.reject_contact_request(bigint, bigint),
  public.send_message(bigint, bigint, text)
to anon, authenticated;
