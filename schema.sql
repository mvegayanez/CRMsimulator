-- =====================================================================
-- Simulacro CRM · Sesión 1 (CRM relacional)
-- Ejecutar UNA VEZ en el SQL Editor de un proyecto nuevo de Supabase.
-- =====================================================================

-- 1. Perfiles de usuario (uno por cuenta de alumno o profesor)
create table if not exists perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null default 'alumno' check (rol in ('alumno', 'profesor')),
  creado_en timestamptz not null default now()
);

-- 2. Cartera de clientes de cada alumno
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid not null references perfiles(id) on delete cascade,
  nombre text not null,
  empresa text,
  sector text,
  email text,
  telefono text,
  creado_en timestamptz not null default now()
);

-- 3. Interacciones con cada cliente (canal, resultado, notas)
create table if not exists interacciones (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid not null references perfiles(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  canal text not null check (canal in ('email', 'telefono', 'web', 'redes', 'presencial')),
  resultado text check (resultado in ('positivo', 'neutro', 'negativo')),
  notas text,
  fecha timestamptz not null default now()
);

-- 4. Oportunidades de venta asociadas a un cliente
create table if not exists oportunidades (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid not null references perfiles(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  titulo text not null,
  importe numeric(12, 2) not null default 0,
  fase text not null default 'prospeccion'
    check (fase in ('prospeccion', 'propuesta', 'negociacion', 'ganada', 'perdida')),
  creado_en timestamptz not null default now()
);

-- Crear el perfil automáticamente al registrarse
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into perfiles (id, nombre)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_creado
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- =====================================================================
-- Seguridad (Row Level Security): cada alumno solo ve y modifica lo suyo
-- =====================================================================
alter table perfiles enable row level security;
alter table clientes enable row level security;
alter table interacciones enable row level security;
alter table oportunidades enable row level security;

create policy "perfil: ver el propio"
  on perfiles for select using (auth.uid() = id);

create policy "perfil: editar el propio"
  on perfiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "clientes: gestionar los propios"
  on clientes for all
  using (alumno_id = auth.uid())
  with check (alumno_id = auth.uid());

create policy "interacciones: gestionar las propias"
  on interacciones for all
  using (alumno_id = auth.uid())
  with check (
    alumno_id = auth.uid()
    and exists (select 1 from clientes c where c.id = cliente_id and c.alumno_id = auth.uid())
  );

create policy "oportunidades: gestionar las propias"
  on oportunidades for all
  using (alumno_id = auth.uid())
  with check (
    alumno_id = auth.uid()
    and exists (select 1 from clientes c where c.id = cliente_id and c.alumno_id = auth.uid())
  );

-- Índices para las consultas más habituales
create index if not exists idx_clientes_alumno on clientes (alumno_id);
create index if not exists idx_interacciones_cliente on interacciones (cliente_id, fecha desc);
create index if not exists idx_oportunidades_cliente on oportunidades (cliente_id);
