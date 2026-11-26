# 🎪 Festivalspillet

Et samarbejdende multiplayer-spil i browseren (computer og mobil/touch). Spillerne
starter forskellige steder omkring en festival, skal svare på spørgsmål for at komme
forbi vagter og stande og hjælper hinanden undervejs. Til sidst mødes holdet foran
hovedscenen, hvor festivalnavnet og det hemmelige hovednavn afsløres.

Spillet er et klassisk top-down eventyr: man går rundt på et kort, og bomme spærrer vejen,
indtil man har løst en opgave.

## Kom i gang

Kræver Node.js 18 eller nyere. Der er ingen npm-afhængigheder.

```bash
npm start            # eller: node server.js
```

Åbn http://localhost:3000, og tryk **Start et nyt spil**. Del koden (fx `K7QM2X`) eller linket
`http://…/?s=K7QM2X` med de andre spillere.

## Spillets gang

1. **Session:** Én spiller opretter spillet og får en kode på 6 tegn. Kun dem med koden kommer ind.
2. **Avatar:** Man vælger navn, figur og farve. Spillerne fordeles på 4 startsteder:
   busstoppet, cykelparkeringen, parkeringspladsen og campingpladsen.
3. **Ruten:** Hvert startsted har 2 bomme med temaspørgsmål, fx Billetkontrollen,
   Tasketjekket, Pantstationen og Vandposten.
4. **Festivalpladsen:** Her ligger 6 stande: madbod, merch, bar, teltscene, info/førstehjælp og
   toiletkø. Man skal have `STAMPS_REQUIRED` stempler (standard 3).
5. **Scenevagten:** Spørgsmålet her lukker op til hovedscenen, som indtil da er skjult under en presenning.
6. **Finale:** Når alle online spillere står foran scenen, afsløres hovednavnet, og koncerten starter.

**Plakaten:** Hver post, som nogen på holdet klarer, låser brikker op på en fælles festivalplakat.
Den viser bands, dato, sted og bogstaverne i festivalnavnet. Hovednavnet afsløres først i finalen.

**Hjælp:** Ved hvert spørgsmål kan man få 2 hints. Når man har brugt sine hints eller svaret forkert
2 gange, kan man trykke **Spørg holdet**. Medspillerne får besked og kan sende forslag. Forslagene
vises live hos spilleren, og hver svarmulighed får et 👥-mærke med antal stemmer. Der er også en
holdchat. Efter 5 forkerte svar med alle hints brugt tilbyder vagten at lade én gå videre,
så ingen sidder helt fast.

**Styring:** På mobil trækker man på skærmen (en joystick dukker op), og tryk på en post åbner den.
På computer bruger man piletaster eller WASD og E/mellemrum. Man åbner også en post ved at gå ind i den.

## Tilpasning

| Fil | Indhold |
|---|---|
| `config/festival.json` | Festivalnavn, tagline, dato, sted, bands, hemmeligt hovednavn og slutbesked. **Sendes aldrig til browseren.** |
| `config/questions.json` | Alle spørgsmål, svar og hints pr. post. Svarene ligger kun på serveren. |
| `public/world.js` | Kortet (ASCII), posternes navne/emojis, startsteder, figurer og farver. |

Kør `npm run check` efter ændringer i kortet. Den tjekker, at alle startsteder kan nå scenen.

## Miljøvariabler

| Variabel | Standard | Betydning |
|---|---|---|
| `PORT` | 3000 | HTTP-port |
| `MAX_PLAYERS` | 6 | Maks spillere pr. session |
| `STAMPS_REQUIRED` | 3 | Stempler der kræves før Scenevagten (maks 6) |
| `SKIP_AFTER_WRONG` | 5 | Forkerte svar før "lad mig komme videre" (0 = aldrig) |
| `SESSION_TTL_HOURS` | 12 | Hvor længe en inaktiv session gemmes |
| `MAX_SESSIONS` | 500 | Maks samtidige sessioner |

## Hosting

- **Docker:** `docker build -t festivalspil . && docker run -p 3000:3000 -e MAX_PLAYERS=8 festivalspil`
- Spillet virker på alle hosts, der kan køre Node, fx Render, Fly.io, Railway eller en VPS.
  Kør **én** instans, fordi sessionerne ligger i hukommelsen.
- Bag en reverse proxy (nginx) skal buffering være slået fra for `/api/s/*/events` (Server-Sent Events).
- Brug HTTPS i produktion. Del-knappen og udklipsholderen på mobil kræver det.

## GitHub Pages (uden server)

Spillet kan også køre som en statisk side på GitHub Pages. Her forbindes spillernes browsere
direkte til hinanden via WebRTC med [PeerJS](https://peerjs.com/), så der er ingen server at drive.

- Workflowet `.github/workflows/pages.yml` bygger og udgiver siden ved hvert push til `main`.
- Første gang: Gå til **Settings → Pages** i repoet og vælg **Source: GitHub Actions**.
  Pages fra et privat repo kræver en betalt GitHub-plan.
- Del-knappen kopierer et link med koden, fx `https://<bruger>.github.io/scene-what/#K7QM2X`.
- Byg lokalt med `python3 artifact/build.py --pages _site`, og åbn `_site/index.html` via en lokal webserver.

Sådan virker det: Spil-koden bestemmer et fast id. Den første spiller bliver "hub" og videresender
alles tilstand til de andre. Lukker hubben fanen, overtager en af de andre automatisk efter ca. 10 sekunder.
Hver spiller husker sit eget fremskridt i browserfanen. En genindlæsning fortsætter som samme spiller,
mens en ny fane eller en anden enhed med samme kode bliver en ny spiller.

Prikken ved 👥 viser forbindelsen: 🟢 forbundet, 🟡 forbinder, ⚪ spiller alene. Tryk på 👥 for at se
detaljer, herunder seneste fejl, hvis forbindelsen ikke lykkes.

Begrænsninger i version 1:
- **Spørgsmål og svar ligger i sidens kildekode.** Brug Node-versionen, hvis svarene skal være skjult.
- Forbindelsen etableres via PeerJS' gratis offentlige server (`0.peerjs.com`). Man kan bruge en egen
  server med `?peerhost=min.server.dk&peerport=443&peerpath=/`.
- Der er ingen TURN-server, så enkelte firma- og skolenetværk kan forhindre forbindelsen.
  Spillet kører så videre for én spiller.
- Holdet ser kun de spillere, der har siden åben lige nu.

Filer: `artifact/peer-room.js` (peer-to-peer), `artifact/engine.js` (spillogik i browseren),
`artifact/vendor/peerjs.min.js` (PeerJS 1.5.4, MIT-licens) og `artifact/build.py` (bygger både
artifact- og Pages-versionen).

## Teknik

- `server.js`: Node `http`, real-time via Server-Sent Events og POST-kald. Ingen afhængigheder.
- `public/game.js`: Canvas-rendering, tåge (fog of war), touch-joystick, modaler og lyd via WebAudio.
- Spillerens fremskridt holdes på serveren. Genindlæser man siden, fortsætter man, hvor man slap
  (gemt i `localStorage` pr. spil-kode).
