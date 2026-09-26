# Coolify Telemetry

Παρακολούθηση CPU, RAM και Disk usage για πολλαπλά Coolify servers —
συνολικά ανά VPS, και ανά project (χωρίς SSH).

## Δομή του repo

- **`agent/`** — Node/Express service, deployάρεται μία φορά **ανά Coolify
  server** μέσα από το ίδιο το Coolify. Διαβάζει τα Docker labels που βάζει
  το Coolify (`coolify.projectName` κλπ.) και τα συνδυάζει με τα metrics του
  ενσωματωμένου `coolify-sentinel` container (CPU/RAM/Disk), για να δώσει ένα
  authenticated JSON endpoint ανά server.
- **`dashboard/`** — Κεντρικό web dashboard (React + Express) που καλεί τους
  3 agents και δείχνει συνολικά + ανά-project νούμερα, με auto-refresh.
- **`extension/`** — Chrome extension (developer mode) που δείχνει τα ίδια
  νούμερα σε popup, χωρίς να ανοίγεις browser tab.

## Γιατί agent ανά server και όχι απευθείας κλήση στο Coolify API;

Το δημόσιο Coolify REST API (`/api/v1`) δεν εκθέτει αριθμητικά RAM/CPU/Disk
ανά project — μόνο λίστες πόρων με boolean flags. Τα πραγματικά νούμερα τα
έχει μόνο το `coolify-sentinel` container, που ακούει αποκλειστικά σε
`localhost:8888` μέσα σε κάθε server. Το `agent` λύνει αυτό deployαρόμενο
στο ίδιο server/δίκτυο, χωρίς να απαιτεί SSH πρόσβαση — μόνο το Sentinel
token (διαθέσιμο από το Coolify UI).

## Σειρά εγκατάστασης

1. Σε **κάθε** από τα 3 Coolify servers: ενεργοποίησε Sentinel + Metrics
   (Servers → Configuration → Metrics), πάρε το Sentinel token, deploy τον
   `agent/` (δες `agent/README.md`).
2. Deploy το `dashboard/` σε ένα Coolify server (μπορεί να είναι κι αυτό ένα
   από τα 3), με το `SERVERS` env var να δείχνει στα 3 agent URLs + tokens
   (δες `dashboard/README.md`).
3. Άνοιξε το dashboard URL — θα δεις CPU/RAM/Disk ανά server + ανά project.
4. (Προαιρετικό) Φόρτωσε το `extension/` σε developer mode στο Chrome για
   γρήγορη πρόσβαση από το toolbar (δες `extension/README.md`).

## Ασφάλεια

- Κάθε agent προστατεύεται με δικό του `AGENT_TOKEN` (bearer token) — μόνο το
  dashboard το ξέρει.
- Το dashboard προστατεύεται προαιρετικά με `DASHBOARD_PASSWORD`.
- Κανένα SSH credential δεν αποθηκεύεται πουθενά· ο agent χρησιμοποιεί μόνο
  το docker socket που ήδη έχει πρόσβαση μέσα στο container του.
