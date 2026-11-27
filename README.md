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
6. **Finale:** Når alle online spillere står foran scenen, skifter skærmen til en scene set fra publikum.
   Lyset dæmpes, følgespots leder over scenetæppet, der tælles ned fra 3, og tæppet falder.
   Derefter afsløres festivalens navn, dato og sted og til sidst det hemmelige hovednavn, med lys,
   laser, konfetti, jubel og musik. Holdets figurer står forrest i publikum, set bagfra. Kommer man til
   eller genindlæser under finalen, ser man forløbet én gang i den fane. Man kan springe forløbet over.

**Plakaten (🎤):** Under spillet afslører plakaten kun kunstnerne, bogstav for bogstav. Hver post, som
nogen på holdet klarer, afslører flere bogstaver. Først kommer forbogstaverne, og højst 80 % afsløres
før finalen. Festivalens navn, dato, sted og hovednavn sendes slet ikke til browserne, før hele holdet
står samlet foran scenen.

**Hjælp:** Ved hvert spørgsmål kan man få 2 hints. Når man har brugt sine hints eller svaret forkert
2 gange, kan man trykke **Spørg holdet**. Medspillerne får besked og kan sende forslag. Forslagene
vises live hos spilleren, og hver svarmulighed får et 👥-mærke med antal stemmer. Der er også en
holdchat. Efter 5 forkerte svar med alle hints brugt tilbyder vagten at lade én gå videre,
så ingen sidder helt fast.

**Styring:** På mobil trækker man på skærmen (en joystick dukker op), og tryk på en post åbner den.
På computer bruger man piletaster eller WASD og E/mellemrum. Man åbner også en post ved at gå ind i den.

## Tilpasning: jeres egen festival

Alt indhold styres fra eksterne filer. Koden skal ikke ændres.

| Fil | Indhold |
|---|---|
| `config/festival.json` | Festivalnavn, tagline, dato, sted, kunstnere, hemmeligt hovednavn, slutbesked, musik og band. |
| `config/questions.json` | Alle spørgsmål (134), svar og hints pr. post. Mindst ét spørgsmål pr. post. |
| `media/` | Jeres musik (mp3/wav/ogg/m4a) og evt. et bandbillede (png/jpg/webp/svg). |
| `public/world.js` | Kortet (ASCII), posternes navne/emojis, startsteder, figurer og farver. |

**Sådan skifter I festivalen ud** (`config/festival.json`):

```json
{
  "festivalName": "JERES FESTIVAL",
  "tagline": "En kort undertitel",
  "date": "1.–3. juli",
  "place": "Stedet",
  "lineup": ["Band 1", "Band 2", "Band 3"],
  "headliner": "DET HEMMELIGE HOVEDNAVN",
  "headlinerTeaser": "Aftenens hemmelige hovednavn er...",
  "finaleMessage": "Tak for i dag!",
  "stampsRequired": 3,
  "music": {
    "background": "media/jeres-baggrund.mp3",
    "backgroundVolume": 0.35,
    "finale": "media/jeres-finale.mp3",
    "finaleVolume": 0.8,
    "finaleVideo": null
  },
  "band": {
    "members": [
      { "role": "guitar", "name": "Navn", "color": "#ff4f8b" },
      { "role": "vokal", "name": "Navn", "color": "#ffb627" },
      { "role": "trommer", "name": "Navn", "color": "#2ec4b6" },
      { "role": "bas", "name": "Navn", "color": "#7b2ff7" }
    ],
    "image": null
  }
}
```

- **Hemmeligt indtil finalen:** `festivalName`, `date`, `place`, `tagline` og `headliner` vises først, når hele holdet
  står foran scenen. `lineup` afsløres bogstav for bogstav undervejs. Skriv ikke hovednavnet i `lineup`.
- **Musik:** Læg jeres filer i `media/`, og skriv stien i `music`. `background` looper under hele spillet og tones ud,
  når lyset dæmpes i finalen. `finale` looper, når bandet går på scenen. Et fuldt `https://`-link virker også.
  Sæt et felt til `null` for at slå det fra.
  **Lyden kommer fra scenen:** Musikken under spillet lyder, som om den spiller fra hovedscenen. Den bliver
  højere og klarere, jo tættere man kommer, og svagere og mere dump langt væk (ned til 3 % i det fjerneste hjørne). Retningen høres
  i stereo. Bløde lydbølger fra scenen viser, hvor lyden kommer fra. I finalen spiller den for fuld styrke.
  Afstand, dæmpning og retning kræver, at filen ligger på samme adresse som spillet (fx i `media/`). Ved et link
  til en anden side styres kun lydstyrken (og på iPhone slet ikke). Uden `finale` bruges den indbyggede syntetiske musik. Lyden starter
  ved første tryk på siden (browsernes regel), og 🔊-knappen slår den fra og til. Demo-filerne
  `media/demo-*.mp3` er lavet med `tools/make-demo-music.py` og må frit udskiftes.
- **Finalevideo i stedet for bandet:** Læg en video i `media/` med navnet `finale-video.mp4` (eller `.webm`,
  `.mov`, `.m4v`), eller skriv et YouTube-link eller en sti i `music.finaleVideo`. Så vises videoen stort på
  scenens LED-væg i stedet for bandet, lige efter at navn og hovednavn er afsløret, og videoens egen lyd erstatter
  `finale`-musikken. Findes der ingen video, eller kan den ikke afspilles, kommer bandet og `finale`-musikken som
  før. Brug mp4 (H.264/AAC), som alle browsere kan afspille. Hold filen under 100 MB (GitHubs grænse pr. fil),
  gerne langt under, så den indlæses hurtigt på mobil. YouTube-videoer starter med lyd i de fleste browsere,
  fordi spilleren allerede har trykket på siden. Ellers vises YouTubes egen afspilknap. Lukker man finalen, stopper
  videoen, og `finale`-musikken spiller videre fra scenen.
  **Forhåndshentning:** Få sekunder efter at spillet er startet, hentes videofilen i baggrunden med lav prioritet,
  så den starter med det samme i finalen. Man kan følge det i hold-vinduet (👥). Filer over 400 MB (150 MB på
  mobil), eller når telefonen sparer på data, hentes ikke helt. Dér begynder browseren i stedet at buffere starten
  af videoen. Ved YouTube åbnes forbindelsen på forhånd.
  Node-serveren og Pages-bygget oplyser selv, om der ligger en `finale-video.*` i `media/`. (Byg Pages igen efter at
  have lagt en video ind, hvilket workflowet gør automatisk ved push.)
- **Bandet på scenen:** `members` er 1–6 medlemmer med `role` (`guitar`, `bas`, `vokal`, `trommer` eller `keys`),
  et valgfrit `name` og en `color` til kantlyset. Trommeslageren står bagest i midten. Sæt `image` til fx
  `"media/band.png"` (gerne med gennemsigtig baggrund) for at vise et rigtigt billede i stedet for figurerne.

**Hvor læses filerne fra?**
- **Node-versionen:** `config/` og `media/` som standard. Med `FESTIVAL_CONFIG`, `QUESTIONS_CONFIG` og `MEDIA_DIR`
  kan de ligge hvor som helst, fx uden for projektet. Serveren genindlæser automatisk, når en fil ændres. Er der en
  fejl i filen, beholder den den gamle udgave og skriver fejlen i loggen. Festivaloplysningerne sendes aldrig til
  browseren før finalen.
- **GitHub Pages:** Siden henter `config/festival.json` og `config/questions.json` ved opstart, så et push med en
  rettet fil er nok. Eller peg på filer et helt andet sted:
  `https://rodiano.github.io/scene-what/?config=https://…/festival.json&questions=https://…/questions.json`.
  Det andet sted skal tillade hentning fra andre sider (CORS). Det gør fx rå filer på GitHub og Gist. En fejl i filen
  vises på forsiden.
- **Artifact-versionen:** Filerne bages ind, når den bygges. Musikfiler kan ikke komme med, så den bruger den
  indbyggede lyd.

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
| `FESTIVAL_CONFIG` | `config/festival.json` | Sti til festivalfilen |
| `QUESTIONS_CONFIG` | `config/questions.json` | Sti til spørgsmålsfilen |
| `MEDIA_DIR` | `media` | Mappe med musik og billeder (serveres på `/media/…`) |

## Hosting

- **Docker:** `docker build -t festivalspil . && docker run -p 3000:3000 -e MAX_PLAYERS=8 festivalspil`
- Spillet virker på alle hosts, der kan køre Node, fx Render, Fly.io, Railway eller en VPS.
  Kør **én** instans, fordi sessionerne ligger i hukommelsen.
- Bag en reverse proxy (nginx) skal buffering være slået fra for `/api/s/*/events` (Server-Sent Events).
- Brug HTTPS i produktion. Del-knappen og udklipsholderen på mobil kræver det.

## GitHub Pages (uden server)

Spillet kan også køre som en statisk side på GitHub Pages uden egen server. Spillerne forbindes
ad to veje på én gang, og man ser hinanden, så længe mindst én af dem virker:

1. **MQTT-relay:** Tilstanden sendes gennem en offentlig MQTT-broker over WebSocket
   (`wss://broker.hivemq.com:8884/mqtt`). Det går gennem de fleste firewalls.
2. **Peer-to-peer:** Browserne forbindes direkte via WebRTC med [PeerJS](https://peerjs.com/).

**QR-kode:** Tryk på koden øverst til venstre eller på 👥 for at vise en QR-kode, som andre i nærheden
kan scanne. Den åbner spillet direkte på karaktervalget med koden udfyldt. QR-koden vises også,
mens man laver sin figur. Delte links virker på samme måde.

- Workflowet `.github/workflows/pages.yml` bygger og udgiver siden ved hvert push til `main`.
- Første gang: Gå til **Settings → Pages** i repoet og vælg **Source: GitHub Actions**.
  Pages fra et privat repo kræver en betalt GitHub-plan.
- Del-knappen kopierer et link med koden, fx `https://<bruger>.github.io/scene-what/#K7QM2X`.
- Byg lokalt med `python3 artifact/build.py --pages _site`, og åbn `_site/index.html` via en lokal webserver.

Sådan virker peer-to-peer-delen: Spil-koden bestemmer et fast id. Den første spiller bliver "hub" og videresender
alles tilstand til de andre. Lukker hubben fanen, overtager en af de andre automatisk efter ca. 10 sekunder.
Hver spiller husker sit eget fremskridt i browserfanen. En genindlæsning fortsætter som samme spiller,
mens en ny fane eller en anden enhed med samme kode bliver en ny spiller.

Prikken ved 👥 viser forbindelsen: 🟢 forbundet, 🟡 forbinder, ⚪ spiller alene. Tryk på 👥 for at se
detaljer, fx `MQTT ✓, P2P ✗ (network)`.

Begrænsninger i version 1:
- **Spørgsmål og svar ligger i sidens kildekode.** Brug Node-versionen, hvis svarene skal være skjult.
- Begge veje bruger gratis offentlige tjenester (HiveMQ's offentlige MQTT-broker og PeerJS' server).
  De er åbne for alle, så spillets tilstand kan i princippet læses af andre, der kender koden.
  Man kan bruge egne servere med `?mqtt=wss://min.broker.dk/mqtt` og
  `?peerhost=min.server.dk&peerport=443&peerpath=/`. `?mqtt=off` slår MQTT fra.
- Holdet ser kun de spillere, der har siden åben lige nu.

Filer: `artifact/mqtt-room.js` (MQTT og samling af de to veje), `artifact/peer-room.js`
(peer-to-peer), `artifact/engine.js` (spillogik i browseren) og `artifact/build.py` (bygger både
artifact- og Pages-versionen). Tredjepartskode i `artifact/vendor/` (PeerJS 1.5.4 og MQTT.js 5.10.1)
og `public/vendor/qrcode.js` (qrcode-generator 1.4.4) er alle under MIT-licens.

## Teknik

- `server.js`: Node `http`, real-time via Server-Sent Events og POST-kald. Ingen afhængigheder.
- `public/game.js`: Canvas-rendering, tåge (fog of war), touch-joystick, modaler og lyd via WebAudio.
- Spillerens fremskridt holdes på serveren. Genindlæser man siden, fortsætter man, hvor man slap
  (gemt pr. fane).
