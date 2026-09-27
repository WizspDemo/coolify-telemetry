# Coolify Telemetry Dashboard

Κεντρικό dashboard που δείχνει, για κάθε ένα από τα Coolify servers σου:

- Συνολικό CPU%, RAM χρήση, και **disk χρήση ολόκληρου του VPS**.
- Ανά **project** (βάσει των labels `coolify.projectName` που βάζει το ίδιο
  το Coolify): πόση RAM και πόσο disk καταναλώνει.

Δεν χρειάζεται SSH σε κανένα server. Χρειάζεται από 1 **agent** container
(φάκελος `../agent`) να τρέχει σε κάθε Coolify server, deployαρισμένο μέσα
από το ίδιο το Coolify.

## Αρχιτεκτονική

```
[Server 1: Coolify + coolify-sentinel + telemetry-agent] --\
[Server 2: Coolify + coolify-sentinel + telemetry-agent] ---> [Dashboard] -> εσύ (browser)
[Server 3: Coolify + coolify-sentinel + telemetry-agent] --/
```

Κάθε agent διαβάζει τοπικά τα docker labels + το Sentinel API του server
του, και εκθέτει ένα μικρό authenticated `/metrics` endpoint. Το dashboard
(αυτός ο φάκελος) καλεί τους 3 agents κάθε 30 δευτερόλεπτα και δείχνει τα
αποτελέσματα.

## Βήμα 1: Deploy τους 3 agents

Δες `../agent/README.md`. Πρέπει να γίνει **πρώτα**, ένας agent ανά server,
πριν έχει νόημα να στήσεις το dashboard.

## Βήμα 2: Deploy το dashboard στο Coolify

1. Στο Coolify σου, νέο **Application** → **Docker Compose**, δείξε το σε
   αυτό το repo (`dashboard/` folder) και χρησιμοποίησε το `docker-compose.yml`
   εδώ (ή `Dockerfile` απευθείας ως app type "Dockerfile").
2. Environment variables:
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — used **once**, to create your
     first account when the app boots with no accounts yet. Log in with
     these, then use the "Αλλαγή password" button in the UI to set your
     own - the env vars are never consulted again after that.
   - `SESSION_SECRET` — a long random string (e.g. `openssl rand -hex 32`).
     Keeps you logged in across redeploys; if left empty a random one is
     generated per process start (fine, but logs everyone out on redeploy).
   - `SERVERS` — JSON array, ένα entry ανά agent που έστησες:
     ```json
     [
       {"name":"Server 1","url":"https://telemetry-1.example.com","token":"AGENT_TOKEN_TOU_SERVER_1"},
       {"name":"Server 2","url":"https://telemetry-2.example.com","token":"AGENT_TOKEN_TOU_SERVER_2"},
       {"name":"Server 3","url":"https://telemetry-3.example.com","token":"AGENT_TOKEN_TOU_SERVER_3"}
     ]
     ```
3. **Persistent storage**: πρόσθεσε ένα volume mount `/app/data` (Coolify UI
   → Storages, ή μέσω API `type:"persistent"`), αλλιώς ο λογαριασμός σου
   χάνεται σε κάθε redeploy.
4. Deploy, βάλε domain, άνοιξέ το.

## Τοπική ανάπτυξη

```bash
# Terminal 1: backend
cd server
cp .env.example .env   # βάλε τα SERVERS
npm install
npm run dev             # tsc --watch
npm start                # σε άλλο terminal, μετά το πρώτο build

# Terminal 2: frontend με hot reload (proxy στο :8080)
cd client
npm install
npm run dev
```

Άνοιξε http://localhost:5173 (dev) ή http://localhost:8080 (production build).

## Τι δείχνει ακριβώς

Για κάθε server: CPU%, RAM used/total, Disk used/total (root filesystem —
δηλαδή το **συνολικό storage του VPS**), και πίνακα με κάθε Coolify project
+ RAM/Disk που καταναλώνει συνολικά (άθροισμα όλων των containers/resources
μέσα σε αυτό το project).
