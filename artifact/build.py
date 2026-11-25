# Bygger en enkelt HTML-fil til claude.ai-artifact ud fra spillets kilder.
import json, re, pathlib
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
css = (R/'public/style.css').read_text()
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
dst = R/'artifact/festivalspil.html'
dst.write_text(out)
print(dst, len(out))
