-- FieldProof - schema multi-tenant

create table if not exists companies (
  id serial primary key,
  slug text unique not null,
  name text not null,
  industry text,
  logo_url text,
  brand_color text not null default '#17322B',
  status text not null default 'active',      -- active | suspended
  admin_pin text not null,
  notify_email text,
  cloudinary_folder text not null,
  plan text not null default 'trial',
  max_sites int not null default 10,
  created_at timestamptz not null default now()
);

create table if not exists sites (
  id serial primary key,
  company_id int not null references companies(id) on delete cascade,
  site_code text not null,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, site_code)
);

create table if not exists jobs (
  id serial primary key,
  site_id int not null references sites(id) on delete cascade,
  employee_name text,
  job_type text not null default 'Rutina',
  created_at timestamptz not null default now()
);

create table if not exists media (
  id serial primary key,
  job_id int not null references jobs(id) on delete cascade,
  cloudinary_public_id text not null,
  secure_url text not null,
  resource_type text not null,                -- image | video
  gps_lat numeric,
  gps_lng numeric,
  gps_address text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sites_company on sites(company_id);
create index if not exists idx_jobs_site on jobs(site_id);
create index if not exists idx_media_job on media(job_id);
create index if not exists idx_media_created on media(created_at);
