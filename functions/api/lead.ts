// Cloudflare Pages Function : POST /api/lead
// Vérifie l'anti-spam (Turnstile + piège), valide les champs, enregistre le prospect dans Supabase
// avec la clé service_role (secret serveur), puis prévient le partenaire par email avec le minimum d'informations.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  IP_SALT: string;
  ALLOWED_ORIGIN?: string;
}

const PROJETS = ['pac', 'isolation', 'combles', 'solaire', 'batiment'];
const LOGEMENTS = ['maison', 'appartement'];
const STATUTS = ['proprietaire', 'locataire'];
const CHAUFFAGES = ['fioul', 'gaz', 'electrique', 'autre'];
const LIBELLES: Record<string, string> = {
  pac: 'Pompe à chaleur air/eau', isolation: 'Isolation (murs, toiture)', combles: 'Combles et sous-sol',
  solaire: 'Panneaux photovoltaïques', batiment: 'Bâtiment entier',
  maison: 'Maison', appartement: 'Appartement', proprietaire: 'Propriétaire', locataire: 'Locataire',
  fioul: 'Chaudière fioul', gaz: 'Chaudière gaz', electrique: 'Chauffage électrique', autre: 'Autre',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[\s.\-()]/g, '');
  const m = d.match(/^(?:\+33|0033|0)([1-9]\d{8})$/);
  return m ? `0${m[1]}` : null;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  // 1. Origine : seul notre site peut appeler cette API
  const origin = request.headers.get('Origin');
  if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Origine refusée.' }, 403);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  // 2. Piège anti-robot : un humain ne remplit pas ce champ caché. On répond "ok" sans rien enregistrer.
  if (str(body.website, 200)) return json({ ok: true });

  // 3. Turnstile
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const tsToken = str(body.turnstile, 4096);
  if (!tsToken) return json({ error: 'Vérification anti-robot manquante.' }, 400);
  const ts = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: tsToken, remoteip: ip }),
  }).then((r) => r.json<{ success: boolean }>()).catch(() => ({ success: false }));
  if (!ts.success) return json({ error: 'Vérification anti-robot échouée. Réessayez.' }, 400);

  // 4. Validation stricte côté serveur
  const projet = str(body.projet, 20), logement = str(body.logement, 20), statut = str(body.statut, 20), chauffage = str(body.chauffage, 20);
  const cp = str(body.cp, 5), prenom = str(body.prenom, 80), nom = str(body.nom, 80), email = str(body.email, 200).toLowerCase();
  const tel = normalizePhone(str(body.tel, 30));
  if (!PROJETS.includes(projet) || !LOGEMENTS.includes(logement) || !STATUTS.includes(statut) || !CHAUFFAGES.includes(chauffage))
    return json({ error: 'Merci de compléter toutes les étapes.' }, 400);
  if (!/^\d{5}$/.test(cp)) return json({ error: 'Code postal invalide.' }, 400);
  if (!prenom || !nom) return json({ error: 'Prénom et nom requis.' }, 400);
  if (!tel) return json({ error: 'Numéro de téléphone invalide.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Adresse email invalide.' }, 400);

  // 5. Consentement obligatoire et conservé comme preuve
  const consentText = str(body.consent_text, 3000);
  if (body.consent !== true || consentText.length < 40) return json({ error: 'Le consentement est requis.' }, 400);

  const ipHash = await sha256(`${env.IP_SALT}|${ip}`);
  const payload = {
    projet, logement, statut_occupation: statut, chauffage, code_postal: cp, prenom, nom, telephone: tel, email,
    consent_text: consentText, consent_version: str(body.consent_version, 20) || 'v1',
    utm_source: str(body.utm_source, 100) || null, utm_medium: str(body.utm_medium, 100) || null,
    utm_campaign: str(body.utm_campaign, 100) || null, utm_term: str(body.utm_term, 100) || null,
    gclid: str(body.gclid, 200) || null, page: str(body.page, 200) || null,
    ip_hash: ipHash, user_agent: str(request.headers.get('User-Agent'), 300),
  };

  // 6. Enregistrement via la fonction SQL (clé service_role, jamais exposée au navigateur)
  const sbHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/submit_lead`, {
    method: 'POST', headers: sbHeaders, body: JSON.stringify({ p: payload }),
  });
  if (!rpc.ok) {
    const txt = await rpc.text();
    if (txt.includes('rate_limited')) return json({ error: 'Trop de demandes. Réessayez plus tard ou appelez-nous.' }, 429);
    console.error('submit_lead failed', rpc.status, txt);
    return json({ error: "Votre demande n'a pas pu être enregistrée. Appelez-nous au 07 77 12 22 70." }, 500);
  }
  const lead = await rpc.json<{ lead_id: string; partner_id: string | null; partner_name: string | null; partner_email: string | null }>();

  // 7. Email au partenaire : uniquement les informations nécessaires
  if (lead.partner_email) {
    const text = [
      'Nouvelle demande de rappel, faite par la personne elle-même sur monprojetenergie.fr.',
      '',
      `Projet : ${LIBELLES[projet]}`,
      `Logement : ${LIBELLES[logement]} (${LIBELLES[statut]})`,
      `Chauffage actuel : ${LIBELLES[chauffage]}`,
      `Code postal : ${cp}`,
      '',
      `Contact : ${prenom} ${nom}`,
      `Téléphone : ${tel}`,
      `Email : ${email}`,
      '',
      'Rappel unique et à la demande de la personne, dans les 5 jours ouvrables. Aucune relance par SMS, email ou réseaux sociaux.',
      `Référence : ${lead.lead_id}`,
    ].join('\n');
    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [lead.partner_email], subject: `Nouvelle demande : ${LIBELLES[projet]} (${cp})`, text }),
    }).catch(() => null);
    if (mail && mail.ok) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/leads?id=eq.${lead.lead_id}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ statut: 'transmis', transmitted_at: new Date().toISOString() }),
      }).catch(() => {});
    } else {
      console.error('email partenaire non envoyé', lead.lead_id); // le lead reste "nouveau" dans le dashboard : à renvoyer
    }
  }

  return json({ ok: true });
};

// Toute autre méthode est refusée
export const onRequest = () => json({ error: 'Méthode non autorisée.' }, 405);
