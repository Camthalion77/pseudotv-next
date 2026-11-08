# PseudoTV Next — Πλήρης οδηγός EPG 2.0

Αυτό το ZIP είναι **overlay** για τον κλάδο `development` του repository `Camthalion77/pseudotv-next`. Δεν αντικαθιστά το Direct Stream engine και δεν εγκαθιστά τίποτα στο ZimaOS.

## Περιλαμβάνει

- **XMLTV 2.0:** τίτλος, υποτίτλος/τίτλος επεισοδίου, περίληψη, σεζόν/επεισόδιο, είδος, ηθοποιοί, σκηνοθέτες, σεναριογράφοι, χρονολογία/ημερομηνία, διάρκεια, ηλικιακή καταλληλότητα, αξιολόγηση και αφίσα — μόνον όπου τα διαθέτει ο Plex.
- **Γλώσσα:** `el` για αναγνωρίσιμα ελληνικά κείμενα, `en` μόνο για ρητά δηλωμένα αγγλικά και `und` όταν δεν έχει καθοριστεί. Δεν γίνεται αυθαίρετη αυτόματη μετάφραση.
- **14 ημέρες:** 336 ώρες από προεπιλογή για νέα εγκατάσταση, με ρύθμιση έως 744 ώρες· ανανέωση EPG κάθε 6 ώρες από προεπιλογή.
- **Plex sync:** ανάκτηση metadata από `/library/metadata/{id}` με timeout 9s, αποθήκευση των αναγκαίων πεδίων σε `epg-metadata.json`, συγχρονισμός ανά 6 ώρες και δυνατότητα χειροκίνητης ανανέωσης.
- **Ασφαλέστερη διαχείριση αφισών:** οι εικόνες περνούν από `/api/epg-image/:id` και αποθηκεύονται στο `epg-images`. Το XMLTV και το νέο EPG JSON δεν περιέχουν Plex token.
- **Οδηγός browser:** `/guide.html`, 3ωρο παράθυρο, προηγούμενο/επόμενο/τώρα, φίλτρο τίτλων/περιγραφών, λεπτομερής καρτέλα εκπομπής, δείκτης τρέχουσας ώρας.
- **Προστασία οδηγού:** ατομική εγγραφή XMLTV (πρώτα προσωρινό αρχείο, μετά rename). Το streaming λειτουργεί ανεξάρτητα από την ανάκτηση μεταδεδομένων.
- **Δοκιμές:** `node --test tests/epg.test.js` και ο συνυπάρχων έλεγχος Direct Stream μέσω GitHub Actions.

## Εγκατάσταση των αλλαγών ΜΟΝΟ στο GitHub

1. Κατεβάστε το ZIP από το ChatGPT στον φάκελο `Downloads`.
2. Εκτελέστε σε macOS:

```bash
cd ~/Projects/pseudotv-next || exit 1
git switch development
git status --short
unzip -o ~/Downloads/pseudotv-next-epg2-complete.zip -d .
git diff --check
git add index.js src/epg.js src/epgRoutes.js src/epgImages.js src/xmltv.js web/public/index.html web/public/guide.html web/public/guide.js web/public/guide.css web/public/templates/xmltv-settings.html tests/epg.test.js .github/workflows/check.yml compose.direct-stream.example.yml README-EPG2-EL.md
git commit -m "Add complete Plex metadata EPG 2.0 and browser guide"
git push origin development
git status -sb
```

## Σημειώσεις λειτουργίας

- Ρυθμίστε το `PUBLIC_BASE_URL` στην προσβάσιμη LAN διεύθυνση του PseudoTV (το compose παράδειγμα χρησιμοποιεί `http://192.168.10.250:8098`). Οι εικόνες του XMLTV θα δείχνουν εκεί και όχι στον Plex.
- Η εγκατάσταση δοκιμής χρησιμοποιεί δικό της `DATABASE`· μην επαναχρησιμοποιήσετε τον τόμο της παλιάς εφαρμογής.
- Η αρχική έκδοση του Plex browser διατηρεί την ιστορική διαχείριση διαπιστευτηρίων/βιβλιοθηκών. Η αλλαγή προστατεύει τα **νέα δημόσια EPG URLs**, δεν αποτελεί γενική αναθεώρηση ασφαλείας της εφαρμογής.
- Σε παλιό τόμο με ρυθμίσεις XMLTV, η προηγούμενη διάρκεια (π.χ. 12 ώρες) παραμένει έως ότου αλλαχθεί σε 336 από τις ρυθμίσεις.
- Η απόλυτη συμβατότητα εικόνων/fields σε κάθε TVHeadend client δεν έχει ακόμη δοκιμαστεί στο πραγματικό ZimaOS. Ορισμένα metadata ίσως δεν υπάρχουν στον Plex.
- Η χειροκίνητη ενημέρωση `/api/epg/refresh` σχεδιάστηκε για τοπικό, έμπιστο LAN· μην εκθέσετε το διαχειριστικό Web UI στο δημόσιο Internet χωρίς έλεγχο πρόσβασης.
- Το Direct Stream παραμένει ανέπαφο· καμία επανακωδικοποίηση δεν προστίθεται.
