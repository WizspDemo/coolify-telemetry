# Coolify Telemetry — Chrome Extension

Popup που δείχνει CPU, RAM και Disk usage των Coolify servers σου, χωρίς να
χρειάζεται να ανοίξεις καρτέλα. Διαβάζει τα δεδομένα από το ίδιο dashboard
backend του project (`../dashboard`) — δεν μιλάει απευθείας στο Coolify.

## Εγκατάσταση (developer mode, τοπικά)

1. Άνοιξε `chrome://extensions`.
2. Ενεργοποίησε **Developer mode** (πάνω δεξιά).
3. **Load unpacked** → επίλεξε αυτόν τον φάκελο (`extension/`).
4. Κάνε κλικ στο εικονίδιο στο toolbar, άνοιξε **Settings**, βάλε:
   - **Dashboard URL**: το URL του dashboard σου (π.χ. `https://telemetry.example.com`)
   - **Dashboard password**: μόνο αν έβαλες `DASHBOARD_PASSWORD` στο backend.
5. Save. Θα εμφανιστούν τα 3 servers με CPU/RAM/Disk, auto-refresh κάθε φορά
   που ανοίγεις το popup.

## Προαπαιτούμενο

Πρέπει πρώτα να έχεις deployαρει το `../dashboard` (που με τη σειρά του
χρειάζεται τα `../agent` σε κάθε Coolify server). Το extension είναι απλά
ένα βολικό frontend πάνω στο ήδη υπάρχον `/api/servers` endpoint.

## Δεν δημοσιεύεται στο Chrome Web Store

Παραμένει developer-mode / unpacked, όπως ζητήθηκε — καμία σχέση με Google
review ή πληρωμή. Ο κώδικας ζει εδώ στο GitHub, ο καθένας μπορεί να τον
κατεβάσει και να τον φορτώσει τοπικά.
