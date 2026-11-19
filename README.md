# Magic Learning Quest · serveur de duels

Service des **duels en ligne** de [Magic Learning Quest](https://github.com/jabiru-games/magic-learning-quest) : il tient la liste des joueurs connectés, transmet les invitations et arbitre les duels. C’est un petit serveur Node.js (WebSocket), sans base de données ni compte.

## Ce qu’il fait

- **Salon** : chaque joueur connecté voit les autres (nom du mage et apparence) et sait qui est déjà en duel.
- **Invitations** : défier, accepter, refuser, annuler ; une invitation sans réponse expire après 20 secondes.
- **Duels** : le serveur tire les questions, vérifie les réponses et calcule les points de vie. Une question envoyée à un joueur ne contient jamais sa solution.
- **Rien n’est conservé** : ni messagerie, ni historique. Tout disparaît à la fermeture de la connexion.

### Règles d’un duel

Chaque mage a 100 PV et chaque manche est une **course**. Chacun reçoit une question à son propre niveau ; le premier qui répond juste lance le seul sort de la manche et retire 20 PV à l’adversaire, 25 s’il a répondu dans la première moitié du temps. Une erreur ne coûte pas de vie, mais elle bloque le joueur pour la manche. Le duel s’arrête quand un mage tombe à 0 PV, ou après 10 manches : le plus de PV gagne, et l’égalité existe. Quitter ou perdre la connexion donne la victoire à l’autre joueur.

## Lancer le serveur

```bash
# Avec Docker
docker build -t mlq-duels .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -e ALLOWED_ORIGINS=https://jabiru-games.github.io mlq-duels

# Sans Docker (Node.js 20 ou plus)
npm ci --omit=dev
ALLOWED_ORIGINS=https://jabiru-games.github.io npm start
```

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d’écoute | `8787` |
| `HOST` | Adresse d’écoute ; `127.0.0.1` derrière un proxy sur la même machine | toutes |
| `ALLOWED_ORIGINS` | Origines autorisées, séparées par des virgules ; vide = toutes | vide |
| `MAX_PLAYERS` | Joueurs connectés au maximum | `200` |
| `MAX_PER_ADDRESS` | Connexions par adresse IP | `8` |

`GET /health` répond `{"ok":true,"players":N}` pour la supervision. Les joueurs se connectent sur `/ws`.

### HTTPS obligatoire

Le jeu est servi en HTTPS : le navigateur n’accepte donc qu’une adresse en **`wss://`**. Le dossier `deploy/` contient de quoi publier le serveur sur `magic-learning-quest-srv.jabiru-software.com` :

- **`docker-compose.yml` + `Caddyfile`** : le serveur et Caddy, qui obtient le certificat tout seul. Une fois le nom de domaine pointé vers la machine et les ports 80 et 443 ouverts : `cd deploy && docker compose up -d --build`.
- **`nginx.conf`** : la variante si nginx occupe déjà les ports 80 et 443, avec un certificat certbot.
- **`apache.conf`** et **`duels.service`** : la variante sans Docker, avec Apache devant et un service systemd utilisateur qui lance Node sur `127.0.0.1:8787`.

Le serveur lit `X-Forwarded-For` pour limiter les connexions par adresse : ne jamais l’exposer directement, seulement derrière le proxy.

Vérification : `curl https://magic-learning-quest-srv.jabiru-software.com/health`.

### Relier le jeu

Renseigner l’adresse (`wss://magic-learning-quest-srv.jabiru-software.com/ws`) dans la variable **`DUEL_SERVER_URL`** du dépôt du jeu (Settings → Secrets and variables → Actions → Variables), puis publier une release : le bouton « Contre un joueur » apparaît sur l’écran de défi. En local : `VITE_DUEL_SERVER=ws://localhost:8787/ws npm run dev` dans le dépôt du jeu.

## Protocole

Messages JSON, le type est dans `t`.

| Sens | Message | Contenu |
|---|---|---|
| → serveur | `hello` | `name`, `avatar`, `levels: { clock, math }` |
| ← | `welcome` | `id` du joueur |
| ← | `players` | `list` des autres joueurs : `id`, `name`, `avatar`, `busy` |
| → | `challenge` | `to` (id), `mode` (`clock` ou `math`) |
| ← | `pending` / `invite` | joueur défié (`to`) / joueur qui défie (`from`), `mode` |
| → | `reply` | `accept` (booléen) |
| → | `cancel` | retire son invitation |
| ← | `invite-closed` | `reason` : `declined`, `cancelled`, `timeout`, `gone` |
| ← | `error` | `code` : `busy`, `gone`, `mode` |
| ← | `duel-start` | `mode`, `rival`, `health` |
| ← | `round` | `n`, `of`, `exercise` (sans la réponse, avec `limit` en secondes) |
| → | `answer` | `n`, `value` (`"42"` ou `{ hour, minute }`) |
| ← | `rival-missed` | l’autre joueur s’est trompé : la manche reste à prendre |
| ← | `round-result` | `you` et `rival` : `correct`, `fast`, `given`, `beaten`, `dealt`, `health` ; `you.expected` |
| → | `leave` | abandonne le duel |
| ← | `duel-end` | `result` : `win`, `loss`, `draw` ; `reason` : `health`, `rounds`, `forfeit` |

Protections : messages de 2 Ko au plus, 60 messages par 10 secondes et par connexion, noms limités à 18 caractères, apparence ramenée aux options connues du jeu.

## Développement

```bash
npm ci
npm test        # règles et salon, sans réseau (horloge et hasard injectés)
npm start
```

- `index.js` : HTTP, WebSocket, limites et surveillance des connexions.
- `lobby.js` : salon, invitations et duels, testable sans réseau.
- `domain/` : copie des règles du jeu (`src/domain/` du dépôt du jeu). Après un changement des règles ou des questions côté jeu : `npm run sync-domain -- ../magic-learning-quest`, puis relancer les tests.
