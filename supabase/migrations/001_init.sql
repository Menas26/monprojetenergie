-- Mon Projet Énergie : schéma V1
-- À coller en entier dans Supabase > SQL Editor > Run.

create extension if not exists pgcrypto;

-- ============ Tables ============

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text not null,
  departments text[] not null default '{}',   -- ex. {'33','40','47'}
  active boolean not null default true,
  priority int not null default 100,          -- plus petit = servi en premier
  default_commission numeric(10,2),
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  projet text not null check (projet in ('pac','isolation','combles','solaire','batiment')),
  logement text not null check (logement in ('maison','appartement')),
  statut_occupation text not null check (statut_occupation in ('proprietaire','locataire')),
  chauffage text not null check (chauffage in ('fioul','gaz','electrique','autre')),
  code_postal text not null check (code_postal ~ '^\d{5}$'),
  departement text not null,
  prenom text not null,
  nom text not null,
  telephone text not null,
  email text not null,
  statut text not null default 'nouveau'
    check (statut in ('nouveau','sans_partenaire','transmis','rdv','devis','signe','installe','paye','perdu')),
  partner_id uuid references public.partners(id),
  transmitted_at timestamptz,
  rdv_at date,
  devis_at date,
  signe_at date,
  installe_at date,
  utm_source text, utm_medium text, utm_campaign text, utm_term text,
  gclid text,                                  -- stocké seulement si cookies acceptés
  page text,
  ip_hash text,
  notes text
);
create index leads_created_idx on public.leads (created_at desc);
create index leads_ip_idx on public.leads (ip_hash, created_at);
create index leads_status_idx on public.leads (statut);

-- Preuve du consentement : texte exact accepté, version, date
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  consent_text text not null,
  consent_version text not null,
  given_at timestamptz not null default now(),
  ip_hash text,
  user_agent text
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  partner_id uuid references public.partners(id),
  expected_amount numeric(10,2),
  validated_amount numeric(10,2),
  status text not null default 'attendue' check (status in ('attendue','validee','payee','annulee')),
  paid_at date,
  notes text,
  updated_at timestamptz not null default now()
);

-- Comptes autorisés à ouvrir le dashboard
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ============ Sécurité (RLS) ============

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.partners    enable row level security;
alter table public.leads       enable row level security;
alter table public.consents    enable row level security;
alter table public.commissions enable row level security;
alter table public.admins      enable row level security;   -- aucune policy : illisible via l'API

create policy admin_all on public.partners    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.leads       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.consents    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.commissions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Le public (clé anon) n'a AUCUN accès direct aux tables
revoke all on all tables in schema public from anon;

-- ============ Enregistrement d'un prospect (appelé uniquement par le serveur) ============

create or replace function public.submit_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dept text;
  v_partner public.partners%rowtype;
  v_id uuid;
  v_recent int;
begin
  select count(*) into v_recent from public.leads
   where ip_hash = p->>'ip_hash' and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'rate_limited'; end if;

  v_dept := case when left(p->>'code_postal', 2) in ('97','98') then left(p->>'code_postal', 3)
                 else left(p->>'code_postal', 2) end;

  select * into v_partner from public.partners
   where active and v_dept = any (departments)
   order by priority, created_at limit 1;

  insert into public.leads (projet, logement, statut_occupation, chauffage, code_postal, departement,
                            prenom, nom, telephone, email, partner_id, statut,
                            utm_source, utm_medium, utm_campaign, utm_term, gclid, page, ip_hash)
  values (p->>'projet', p->>'logement', p->>'statut_occupation', p->>'chauffage', p->>'code_postal', v_dept,
          p->>'prenom', p->>'nom', p->>'telephone', p->>'email', v_partner.id,
          case when v_partner.id is null then 'sans_partenaire' else 'nouveau' end,
          p->>'utm_source', p->>'utm_medium', p->>'utm_campaign', p->>'utm_term', p->>'gclid', p->>'page', p->>'ip_hash')
  returning id into v_id;

  insert into public.consents (lead_id, consent_text, consent_version, ip_hash, user_agent)
  values (v_id, p->>'consent_text', p->>'consent_version', p->>'ip_hash', p->>'user_agent');

  return jsonb_build_object('lead_id', v_id, 'partner_id', v_partner.id,
                            'partner_name', v_partner.name, 'partner_email', v_partner.contact_email);
end $$;

revoke all on function public.submit_lead(jsonb) from public, anon, authenticated;
grant execute on function public.submit_lead(jsonb) to service_role;

-- ============ Après avoir créé ton compte dans Authentication > Users, exécute (avec TON email) : ============
-- insert into public.admins (user_id) select id from auth.users where email = 'ton-email@exemple.fr';
