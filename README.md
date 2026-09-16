# Üzenetfal

Publikus üzenetfal weboldal: látogatók üzenetet küldhetnek (alapból "Anonim" néven, vagy egyedi
névvel), az admin ("ronin") pedig bejelentkezve válaszolhat vagy elrejtheti a spam üzeneteket.

A weboldal GitHub Pages-en fut (statikus hosting), az üzenetek tárolására pedig a **GitHub Issues
API**-t használja: minden üzenet egy Issue ebben a repóban, az admin válasza pedig egy komment. A
GitHub tokent és az admin jelszót egy kis **Cloudflare Worker** proxy kezeli, ami soha nem kerül a
böngészőbe.

## Telepítés

### 1. GitHub Personal Access Token

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token.
2. Repository access: **Only select repositories** → `ro-nin-star/text`.
3. Permissions: **Issues → Read and write**.
4. Generate, majd mentsd el a tokent (csak egyszer látod).

### 2. Cloudflare Worker

```bash
npm install -g wrangler
wrangler login
```

A `worker/` mappában állítsd be a secreteket (mindegyiknél a parancs interaktívan kéri az értéket):

```bash
cd worker
wrangler secret put GITHUB_TOKEN
wrangler secret put ADMIN_PASSWORD
wrangler secret put SESSION_SECRET
```

- `GITHUB_TOKEN` — az 1. lépésben létrehozott fine-grained token
- `ADMIN_PASSWORD` — az admin ("ronin") bejelentkezési jelszava, válassz erős jelszót
- `SESSION_SECRET` — egy hosszú, véletlenszerű string (pl. `openssl rand -hex 32` kimenete)

Ha szükséges, a `worker/wrangler.toml`-ban ellenőrizd/módosítsd a `GITHUB_OWNER`, `GITHUB_REPO` és
`ALLOWED_ORIGIN` értékeket (`ALLOWED_ORIGIN` a GitHub Pages oldalad domainje, pl.
`https://ro-nin-star.github.io`).

Telepítés:

```bash
wrangler deploy
```

A parancs kiírja a Worker URL-jét (pl. `https://text-uzenetfal.<account>.workers.dev`). Ezt másold
be az [assets/app.js](assets/app.js) elején lévő `API_BASE_URL` konstansba.

### 3. GitHub Pages

GitHub repo → Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch:
`main`, mappa: `/ (root)`.

Néhány perc után elérhető lesz a `https://ro-nin-star.github.io/text/` címen.

## Helyi tesztelés

Worker helyi futtatása:

```bash
cd worker
wrangler dev
```

Ezután `curl`-lel kipróbálhatók a végpontok (a `wrangler dev` kiírja a helyi URL-t, pl.
`http://localhost:8787`):

```bash
curl http://localhost:8787/api/messages

curl -X POST http://localhost:8787/api/messages \
  -H "Content-Type: application/json" \
  -d '{"author":"Teszt","text":"Sziasztok!"}'

curl -X POST http://localhost:8787/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORD>"}'

curl -X POST http://localhost:8787/api/admin/reply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"issueId":1,"text":"Szia, itt vagyok!"}'

curl -X POST http://localhost:8787/api/admin/hide \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"issueId":1}'
```

Frontend helyi teszteléséhez futtass egy statikus szervert a repó gyökerében (pl. `npx serve .`),
és ideiglenesen állítsd az [assets/app.js](assets/app.js) `API_BASE_URL` konstansát a `wrangler dev`
helyi URL-jére.

## Hogyan működik

- Minden üzenet egy GitHub Issue a `message` címkével, body formátum: `**Feladó:** <név>\n\n<szöveg>`
- Admin válasz egy Issue komment, body formátum: `**ronin (admin):**\n\n<válasz>`
- Spam elrejtése az Issue lezárását jelenti (`state: closed`) — a publikus lista csak a nyitott
  üzeneteket mutatja, az admin nézet mindkettőt látja és vissza is állíthatja őket
- Admin bejelentkezés után egy aláírt, lejáró (12 órás) tokent kap a böngésző, amit
  `sessionStorage`-ban tárol — nincs szerveroldali session vagy adatbázis
