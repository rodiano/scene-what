# Bygger en enkelt HTML-fil til claude.ai-artifact ud fra spillets kilder.
import json, re, pathlib, sys, shutil
R = pathlib.Path(__file__).resolve().parent.parent
world = (R/'public/world.js').read_text()
world = re.sub(r'^export ', '', world, flags=re.M)
game = (R/'public/game.js').read_text()
game = re.sub(r"^import \{.*?\} from './world.js';\n", '', game, flags=re.S)
def sub(old, new, s, regex=False, count=1):
    n = len(re.findall(old, s, flags=re.S)) if regex else s.count(old)
    assert n >= 1, f'mangler: {old[:60]}'
    return re.sub(old, new, s, flags=re.S) if regex else s.replace(old, new)
game = sub(r"async function api\(path, body\) \{.*?\n\}\n", "const api = (path, body) => ENGINE.api(path, body);\n", game, regex=True)
game = sub("new EventSource(", "new ENGINE.FakeEventSource(", game)
game = sub("EventSource.CLOSED", "2", game)
game = sub(r"history\.replaceState\([^;]*;", "", game, regex=True)
game = sub(r"function shareLink\(code\).*?\nasync function share\(code\) \{.*?\n\}\n", """async function share(code) {
  if (window.__PAGES__) {
    const url = location.origin + location.pathname + '#' + code;
    if (navigator.share) { try { await navigator.share({ title: 'Festivalspillet', text: `Kom med til festivalen! 🎪 Kode: ${code}`, url }); return; } catch {} }
    try { await navigator.clipboard.writeText(url); toast('🔗 Link kopieret – send det til dit hold'); }
    catch { toast(`🔑 Spil-koden er <b>${code}</b> – send den til dit hold`, 6000); }
    return;
  }
  try { await navigator.clipboard.writeText(code); toast(`🔑 Koden ${code} er kopieret – send den til dit hold`); }
  catch { toast(`🔑 Spil-koden er <b>${code}</b> – send den til dit hold`, 6000); }
}
""", game, regex=True)
game = sub("const urlCode = (params.get('s') || location.pathname.split('/s/')[1] || '')", "const urlCode = (location.hash.slice(1) || '')", game)
fest = json.loads((R/'config/festival.json').read_text()); fest.pop('_kommentar', None)
qs = json.loads((R/'config/questions.json').read_text())['questions']
engine = (R/'artifact/engine.js').read_text()
html = (R/'public/index.html').read_text()
body = html.split('<body>')[1].split('<script type="module"')[0]
body = body.replace('<button id="charShare" class="btn small">🔗 Del</button>', '<button id="charShare" class="btn small">📋 Kopiér</button>')
body = body.replace('<button id="teamShare" class="btn">🔗 Del link</button>', '<button id="teamShare" class="btn">📋 Kopiér kode</button>')
body = body.replace('<p id="lobbyError" class="error"></p>', '<p id="lobbyError" class="error"></p>\n      <p class="muted">Demo-version: dine medspillere skal åbne denne samme side og skrive koden.</p>')
body = body.replace('<button id="teamBtn" class="chip">👥 <span id="teamCount">1</span></button>', '<button id="teamBtn" class="chip"><span id="netDot" title="Forbindelse til holdet">⚪</span> 👥 <span id="teamCount">1</span></button>')
body = body.replace('<h3>👥 Dit hold</h3>', '<h3>👥 Dit hold</h3>\n      <p id="netText" class="net-text"></p>')
css = (R/'public/style.css').read_text()
css += '''
.net-text { background: #f3edff; border-radius: 12px; padding: 8px 12px; font-size: 14px; margin: 0 0 12px; }
'''
# Viser forbindelsesstatus i HUD og hold-vinduet (kun i de serverløse versioner)
game += '''
(function netStatus() {
  let last = null;
  const TXT = {
    solo: ['⚪', 'Spiller alene – der er ingen forbindelse til medspillere i denne visning.'],
    connecting: ['🟡', 'Forbinder til holdet…'],
    connected: ['🟢', 'Forbundet til holdet.'],
  };
  setInterval(() => {
    if (!G.code) return;
    const st = ENGINE.status();
    const [dot, txt] = TXT[st.state] || TXT.connecting;
    $('netDot').textContent = dot;
    let t = txt;
    if (st.state === 'connected') t += st.others ? ` Du kan se ${st.others} medspiller${st.others > 1 ? 'e' : ''}.` : ' Ingen andre er med endnu – del koden.';
    if (st.role) t += ` (rolle: ${st.role})`;
    if (st.state !== 'connected' && st.error) t += ` Seneste fejl: ${st.error}.`;
    $('netText').textContent = t;
    if (last && last !== st.state) {
      if (st.state === 'connected') toast('🟢 Forbundet til holdet');
      else if (last === 'connected') toast('🟡 Mistede forbindelsen til holdet – prøver igen…');
    }
    last = st.state;
  }, 1000);
})();
'''
js_json = lambda o: json.dumps(o, ensure_ascii=False).replace('<', '\\u003c')
out = f"""<title>Festivalspillet</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* VOICE occasion: et familiespil
   IDEA en festival om natten – kort, armbånd, plakat
   PICTURE selve spillets kort i fuld skærm
   COLOUR natlilla ground, pink/orange accenter
   TYPE system-ui
   LAYOUT spillet fylder skærmen; modaler som bundark på mobil */
:root{{color-scheme:dark}}
{css}
</style>
{body}
<script>
{{
const FESTIVAL_DATA = {js_json(fest)};
const QUESTIONS_DATA = {js_json(qs)};
{world}
{engine}
{game}
}}
</script>
"""
if len(sys.argv) >= 3 and sys.argv[1] == '--pages':
    # Fuldt HTML-dokument til GitHub Pages med peer-to-peer-multiplayer (PeerJS)
    site = pathlib.Path(sys.argv[2]).resolve(); site.mkdir(parents=True, exist_ok=True)
    peer = (R/'artifact/peer-room.js').read_text()
    script = f"""<script>window.__PAGES__ = true;</script>
<script src="peerjs.min.js"></script>
<script>
{{
const FESTIVAL_DATA = {js_json(fest)};
const QUESTIONS_DATA = {js_json(qs)};
{world}
{peer}
{engine}
{game}
}}
</script>"""
    head = """<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#1b1037">
<title>Festivalspillet</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎪</text></svg>">
"""
    doc = head + f"<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n{script}\n</body>\n</html>\n"
    (site/'index.html').write_text(doc)
    shutil.copy(R/'artifact/vendor/peerjs.min.js', site/'peerjs.min.js')
    (site/'.nojekyll').write_text('')
    print(site/'index.html', len(doc))
else:
    dst = R/'artifact/festivalspil.html'
    dst.write_text(out)
    print(dst, len(out))
