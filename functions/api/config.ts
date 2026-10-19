// Cloudflare Pages Function : GET /api/config
// Renvoie uniquement des valeurs PUBLIQUES par conception (URL Supabase, clé anon, clé de site Turnstile).
// Jamais de clé secrète ici.

interface Env {
  SUPABASE_URL?: string;
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  PUBLIC_TURNSTILE_SITE_KEY?: string;
}

export const onRequestGet = ({ env }: { env: Env }) =>
  new Response(
    JSON.stringify({
      supabaseUrl: env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '',
      supabaseAnon: env.PUBLIC_SUPABASE_ANON_KEY || '',
      turnstile: env.PUBLIC_TURNSTILE_SITE_KEY || '',
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
