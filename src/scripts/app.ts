// Script de la page d'accueil : formulaire multi-étapes, envoi, cookies, appel téléphonique.
// Aucune clé secrète ici : seules les variables PUBLIC_* sont visibles dans le navigateur.

const CONSENT_KEY = 'mpe_consent';
const CONSENT_VERSION = 'v1';
const PHONE_DISPLAY = '07 77 12 22 70';
let TURNSTILE_SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined;
// Si la clé n'est pas intégrée au build, on la lit au chargement depuis /api/config (valeur publique)
const configReady: Promise<void> = TURNSTILE_SITE_KEY
  ? Promise.resolve()
  : fetch('/api/config').then((r) => r.json()).then((c) => { if (c?.turnstile) TURNSTILE_SITE_KEY = c.turnstile as string; }).catch(() => {});
const FORM_ENABLED = import.meta.env.PUBLIC_FORM_ENABLED !== 'false';
const GTM_ID = import.meta.env.PUBLIC_GTM_ID as string | undefined;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function trackingAllowed(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; }
}

/* ---------- Suivi publicitaire : chargé UNIQUEMENT après "Tout accepter" ---------- */
let trackingLoaded = false;
function loadTracking() {
  if (trackingLoaded || !GTM_ID || !trackingAllowed()) return;
  trackingLoaded = true;
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  document.head.appendChild(s);
}

/* ---------- Origine de la visite (UTM). Le gclid n'est gardé qu'avec consentement ---------- */
function captureAttribution() {
  try {
    const q = new URLSearchParams(location.search);
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'];
    for (const k of keys) { const v = q.get(k); if (v) sessionStorage.setItem(k, v.slice(0, 100)); }
    const g = q.get('gclid');
    if (g && trackingAllowed()) sessionStorage.setItem('gclid', g.slice(0, 200));
  } catch { /* stockage indisponible */ }
}
function readAttribution() {
  const out: Record<string, string> = {};
  try {
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term']) {
      const v = sessionStorage.getItem(k); if (v) out[k] = v;
    }
    if (trackingAllowed()) { const g = sessionStorage.getItem('gclid'); if (g) out.gclid = g; }
  } catch { /* ignore */ }
  return out;
}
captureAttribution();

/* ---------- Cookies et fenêtres légales ---------- */
const banner = $('ck');
let saved: string | null = null;
try { saved = localStorage.getItem(CONSENT_KEY); } catch { /* ignore */ }
if (!saved) banner.hidden = false;
if (saved === 'yes') loadTracking();

document.querySelectorAll<HTMLElement>('[data-d]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    ($(a.getAttribute('data-d')!) as HTMLDialogElement).showModal();
  });
});
document.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => {
  b.addEventListener('click', () => {
    const v = b.getAttribute('data-c')!;
    try { localStorage.setItem(CONSENT_KEY, v); } catch { /* ignore */ }
    if (v === 'no') { try { sessionStorage.removeItem('gclid'); } catch { /* ignore */ } }
    banner.hidden = true;
    b.closest('dialog')?.close();
    if (v === 'yes') { captureAttribution(); loadTracking(); }
  });
});

/* ---------- Bouton d'appel : sur ordinateur, on copie le numéro ---------- */
const toast = $('toast');
let toastTimer: number | undefined;
document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]').forEach((a) => {
  a.addEventListener('click', () => {
    if (matchMedia('(pointer:coarse)').matches) return;
    navigator.clipboard?.writeText(PHONE_DISPLAY).catch(() => {});
    toast.textContent = `Appelez le ${PHONE_DISPLAY} (numéro copié)`;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.style.display = 'none'; }, 4000);
  });
});

/* ---------- Formulaire multi-étapes ---------- */
const form = $<HTMLFormElement>('f');
const steps = Array.from(form.querySelectorAll<HTMLElement>('[data-s]'));
const nextBtn = $<HTMLButtonElement>('next');
const prevBtn = $<HTMLButtonElement>('prev');
const errEl = $('err');
const bar = $('bar');
const stepTxt = $('stepTxt');
const LAST = steps.length - 1;
let i = 0;
let turnstileToken = '';
let turnstileReady = false;

const val = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();
const checked = (name: string) => form.querySelector<HTMLInputElement>(`[name=${name}]:checked`)?.value ?? '';

async function loadTurnstile() {
  await configReady;
  if (turnstileReady || !TURNSTILE_SITE_KEY) return;
  turnstileReady = true;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true;
  s.onload = () => {
    (window as any).turnstile.render('#ts', {
      sitekey: TURNSTILE_SITE_KEY,
      language: 'fr',
      callback: (t: string) => { turnstileToken = t; },
      'expired-callback': () => { turnstileToken = ''; },
    });
  };
  document.head.appendChild(s);
}

function validate(): string {
  if (i < 4) {
    const name = ['projet', 'logement', 'statut', 'chauffage'][i];
    if (!checked(name)) return 'Merci de choisir une réponse.';
  }
  if (i === 4 && !/^\d{5}$/.test(val('cp'))) return 'Entrez un code postal à 5 chiffres.';
  if (i === LAST) {
    if (!val('prenom') || !val('nom')) return 'Merci d’indiquer votre prénom et votre nom.';
    if (!/^(?:\+33|0)[1-9](?:[\s.]?\d{2}){4}$/.test(val('tel'))) return 'Entrez un numéro français valide.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email'))) return 'Entrez une adresse email valide.';
    if (!(form.elements.namedItem('consent') as HTMLInputElement).checked) return 'Cochez la case pour que nous puissions transmettre votre demande.';
    if (TURNSTILE_SITE_KEY && !turnstileToken) return 'Merci de valider la vérification anti-robot.';
  }
  return '';
}

function show() {
  steps.forEach((s, k) => { s.hidden = k !== i; });
  prevBtn.hidden = i === 0;
  nextBtn.textContent = i === LAST ? 'Envoyer ma demande' : 'Continuer';
  bar.style.width = `${((i + 1) / steps.length) * 100}%`;
  stepTxt.textContent = `Étape ${i + 1} sur ${steps.length}`;
  if (i === LAST) loadTurnstile();
}

function done() {
  form.hidden = true;
  stepTxt.hidden = true;
  (bar.parentNode as HTMLElement).hidden = true;
  $('cardT').hidden = true;
  const ok = $('ok');
  ok.hidden = false;
  ok.scrollIntoView({ block: 'center' });
  (window as any).dataLayer?.push({ event: 'lead_submitted' }); // sans donnée personnelle ; actif seulement si GTM chargé
}

async function submit() {
  if (!FORM_ENABLED) {
    errEl.textContent = `Le formulaire n'est pas encore ouvert. Appelez-nous au ${PHONE_DISPLAY}.`;
    return;
  }
  nextBtn.disabled = true;
  nextBtn.textContent = 'Envoi en cours…';
  try {
    const consentText = (form.querySelector('.consent span') as HTMLElement).textContent!.replace(/\s+/g, ' ').trim();
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projet: checked('projet'),
        logement: checked('logement'),
        statut: checked('statut'),
        chauffage: checked('chauffage'),
        cp: val('cp'),
        prenom: val('prenom'),
        nom: val('nom'),
        tel: val('tel'),
        email: val('email'),
        website: val('website'),
        consent: true,
        consent_text: consentText,
        consent_version: CONSENT_VERSION,
        turnstile: turnstileToken,
        page: location.pathname,
        ...readAttribution(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any).error || 'Une erreur est survenue. Réessayez ou appelez-nous.');
    }
    done();
  } catch (e) {
    errEl.textContent = (e as Error).message;
    (window as any).turnstile?.reset();
    turnstileToken = '';
    nextBtn.disabled = false;
    show();
  }
}

nextBtn.addEventListener('click', () => {
  const m = validate();
  errEl.textContent = m;
  if (m) return;
  if (i < LAST) { i++; show(); } else { submit(); }
});
// AUTO_NEXT : un clic sur une réponse (étapes 1 à 4) passe directement à l'étape suivante
form.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.type === 'radio' && i < 4) setTimeout(() => nextBtn.click(), 250);
});
prevBtn.addEventListener('click', () => { if (i > 0) { i--; errEl.textContent = ''; show(); } });
show();
