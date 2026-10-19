# Mon Projet Énergie : guide de mise en ligne (Mac, débutant)

Ce projet contient : le site (Astro), l'API du formulaire (`functions/api/lead.ts`), la base de données (`supabase/migrations/001_init.sql`) et le tableau de bord (`/admin`).
**Rien de secret n'est dans le code.** Les secrets se saisissent dans Cloudflare, jamais dans GitHub.

Fais les étapes dans l'ordre. Ne passe pas à la suivante tant qu'une étape ne marche pas.

## A. Mise en ligne rapide en mode aperçu (à faire d'abord)

Le site peut être en ligne et partageable **avant** la base de données. Par défaut il est en **mode aperçu** :
- non indexé par Google (`PUBLIC_NOINDEX` absent ou `true`),
- formulaire fermé : il affiche "Appelez-nous" au lieu d'envoyer (`PUBLIC_FORM_ENABLED` absent ou `false`).

Fais l'étape 0 (outils), puis l'étape 4 (GitHub et Cloudflare Pages) **sans** les secrets : seul le site est publié, à l'adresse `https://ton-projet.pages.dev`. Partage ce lien à tes partenaires pour avoir leurs retours.
Ensuite, fais les étapes 2 et 3 (Supabase, Turnstile, Resend), ajoute les secrets, puis passe `PUBLIC_FORM_ENABLED` à `true`.
Le jour du lancement officiel seulement (mentions légales remplies, contrats signés) : `PUBLIC_NOINDEX` à `false` et branche le domaine.

## 0. Outils sur ton Mac (une seule fois)

Ouvre l'app **Terminal**, puis colle ligne par ligne :

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node git
node -v && git --version
```

## 1. Lancer le site en local (pour voir le résultat)

Dézippe le projet, puis dans le Terminal :

```bash
cd ~/Downloads/mon-projet-energie      # adapte le chemin si besoin
npm install
cp .env.example .env
npm run dev
```

Ouvre http://localhost:4321. Le formulaire s'affiche mais ne peut pas encore envoyer (il faut les étapes 2 à 4).

## 2. Supabase (base de données)

1. Crée un compte sur supabase.com, puis **New project**. Région : **Europe (Frankfurt ou Paris)**. Note le mot de passe de base de données dans un gestionnaire de mots de passe.
2. Menu **SQL Editor** > **New query** > colle tout le contenu de `supabase/migrations/001_init.sql` > **Run**. Tu dois voir "Success".
3. Menu **Authentication > Users > Add user** : crée ton compte (ton email + un mot de passe long).
4. Retourne dans **SQL Editor** et exécute, avec ton vrai email :
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'ton-email@exemple.fr';
   ```
5. Ajoute ton premier partenaire (SQL Editor). Exemple, départements de la Gironde et des Landes :
   ```sql
   insert into public.partners (name, contact_email, departments, default_commission)
   values ('Nom de l''entreprise', 'contact@entreprise.fr', '{33,40}', 1000);
   ```
6. **Project Settings > API** : note l'**URL du projet**, la clé **anon public** et la clé **service_role**.
   - `anon` et URL : publiques, sans danger.
   - `service_role` : **SECRÈTE**. Ne la colle jamais dans un fichier du projet, dans GitHub, ni dans un message.

## 3. Cloudflare Turnstile (anti-spam) et Resend (emails)

- **Turnstile** : compte Cloudflare > Turnstile > Add site > ton domaine. Note la **Site key** (publique) et la **Secret key** (secrète).
- **Resend** : compte sur resend.com > Domains > ajoute `monprojetenergie.fr` et colle les enregistrements DNS demandés (chez ton registrar ou Cloudflare). Puis API Keys > crée une clé (secrète). Tant que le domaine n'est pas vérifié, l'envoi échoue : le prospect est enregistré mais reste au statut "nouveau" dans le dashboard.

## 4. GitHub puis Cloudflare Pages

1. Crée un dépôt **privé** sur github.com (par exemple `mon-projet-energie`), vide.
2. Dans le Terminal, depuis le dossier du projet :
   ```bash
   git init
   git add .
   git status        # vérifie qu'il n'y a PAS de .env ni .dev.vars dans la liste
   git commit -m "V1"
   git branch -M main
   git remote add origin https://github.com/TON-COMPTE/mon-projet-energie.git
   git push -u origin main
   ```
3. Cloudflare > **Workers & Pages > Create > Pages > Connect to Git** > choisis le dépôt.
   - Framework : **Astro**, commande de build : `npm run build`, dossier de sortie : `dist`.
4. **Settings > Variables and Secrets** du projet Pages :
   - Variables normales (aussi pour le build) : `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_TURNSTILE_SITE_KEY`. Laisse `PUBLIC_GTM_ID` vide pour l'instant.
   - **Secrets** (type "Secret") : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `IP_SALT` (une longue suite de caractères aléatoires), `ALLOWED_ORIGIN` (`https://monprojetenergie.fr`).
5. Relance un déploiement (Deployments > Retry). Ajoute ensuite le domaine : **Custom domains > monprojetenergie.fr**.

## 5. Tester de bout en bout

1. Ouvre le site, remplis le formulaire avec TES coordonnées et un code postal couvert par ton partenaire test.
2. Vérifie : message de confirmation, ligne dans le dashboard `/admin`, email reçu par le partenaire.
3. Dans `/admin`, change le statut, ajoute une commission : vérifie que ça se sauvegarde.
4. Teste le bouton d'appel depuis ton téléphone.
5. Teste un code postal non couvert : le prospect passe en "sans_partenaire".

## 6. Ce qui est volontairement désactivé

- **Suivi publicitaire** : GTM ne se charge qu'après "Tout accepter" ET si `PUBLIC_GTM_ID` est rempli. Le `gclid` n'est enregistré que si les cookies sont acceptés.
- **Aucun email de relance** : le partenaire reçoit un seul email par demande.

## 7. À faire avant les pubs (ne pas sauter)

- Remplir tous les `[à compléter]` dans `src/pages/index.astro` (mentions légales, confidentialité, pied de page) : raison sociale, SIREN, adresse, email, hébergeur, partenaires, prestataires, durée de conservation.
- Faire relire les textes légaux et le texte du consentement par un juriste ou un avocat.
- Signer un contrat avec chaque partenaire (commission, validation, paiement, rappel unique et à la demande, aucune relance, preuve du consentement, rôles RGPD).
- Vérifier que le widget Turnstile (chargé depuis Cloudflare) est bien décrit dans la politique de confidentialité, à valider avec ton juriste.
- Mention France Rénov' : déjà présente sous l'accueil. Elle doit aussi apparaître dans tes annonces, vérifie l'arrêté du 7 juillet 2026 sur Légifrance.

## Coûts à prévoir

- Nom de domaine : environ 10 à 15 euros par an.
- **Supabase gratuit : le projet se met en pause après une semaine sans activité.** Passe sur l'offre Pro (à partir de 25 dollars par mois) avant de lancer les pubs, sinon le formulaire peut tomber en panne.
- Resend : gratuit jusqu'à 100 emails par jour et 3 000 par mois (vérifie les limites actuelles sur leur page de prix).
- Cloudflare Pages et Turnstile : gratuits dans les limites actuelles (à vérifier sur leur page de prix).
