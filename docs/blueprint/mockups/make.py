"""Blueprint designer mockups (docs/blueprint/spec.md). Static HTML, not the app.

Run: python3 docs/blueprint/mockups/make.py && node docs/blueprint/mockups/shoot.mjs
The ship is drawn from the real Thrust ship (scenarios/thrust-1.json, world.thrust.ship).
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SHIP = json.load(open(os.path.join(ROOT, "scenarios", "thrust-1.json")))["world"]["thrust"]["ship"]
BODIES = {b["id"].replace("p{n}-", ""): b for b in SHIP["bodies"]}

# Component kind -> (category colour). Blueprint: faint fill, crisp stroke.
COL = {
    "cockpit": "#a9b4ff", "tank": "#5d8cff", "power": "#3fd0c0",
    "weapon": "#d58cff", "engine": "#ffd36a", "utility": "#ff9f6b",
}
# Components (an engine is a head plus its two nozzle walls).
COMPONENTS = [
    ("hull", "cockpit", ["hull"], "Cockpit"),
    ("tank-l", "tank", ["tank-l"], "Tank L"), ("tank-r", "tank", ["tank-r"], "Tank R"),
    ("gen-l", "power", ["gen-l"], "Generator L"), ("gen-r", "power", ["gen-r"], "Generator R"),
    ("battery", "power", ["battery"], "Battery"),
    ("mag-l", "weapon", ["mag-l"], "Magazine L"), ("mag-r", "weapon", ["mag-r"], "Magazine R"),
    ("gun", "weapon", ["gun"], "Railgun"),
    ("main", "engine", ["main", "main-wall-a", "main-wall-b"], "Main thruster"),
    ("back-l", "engine", ["back-l", "back-l-wall-a", "back-l-wall-b"], "Thruster BL"),
    ("back-r", "engine", ["back-r", "back-r-wall-a", "back-r-wall-b"], "Thruster BR"),
    ("front-l", "engine", ["front-l", "front-l-wall-a", "front-l-wall-b"], "Thruster FL"),
    ("front-r", "engine", ["front-r", "front-r-wall-a", "front-r-wall-b"], "Thruster FR"),
    ("tractor", "utility", ["tractor"], "Tractor projector"),
    ("tether", "utility", ["tether"], "Tether winch"),
    ("shield", "utility", ["shield"], "Shield emitter"),
]
PART_OF = {p: c[0] for c in COMPONENTS for p in c[2]}


def rot(v, a):
    c, s = math.cos(a), math.sin(a)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)


def verts(b):
    sh = b["shape"]
    if sh["kind"] == "box":
        w, h = sh["width"] / 2, sh["height"] / 2
        local = [(-w, -h), (w, -h), (w, h), (-w, h)]
    else:
        local = [(v["x"], v["y"]) for v in sh["vertices"]]
    a = b.get("angle", 0)
    p = b["position"]
    return [(p["x"] + rot(v, a)[0], p["y"] + rot(v, a)[1]) for v in local]


def world_anchor(bid, anc):
    b = BODIES[bid]
    r = rot((anc["x"], anc["y"]), b.get("angle", 0))
    return (b["position"]["x"] + r[0], b["position"]["y"] + r[1])


def ship_svg(sel=None, weld_sel=None, ghost=False, dims=False, dim_others=False, show_welds=True, live=False):
    """SVG <g> in metres, y up (the caller flips)."""
    out = []
    for cid, kind, parts, _ in COMPONENTS:
        c = COL[kind]
        is_sel = cid == sel
        op = 0.35 if (dim_others and not is_sel) else 1
        for pid in parts:
            pts = " ".join(f"{x:.3f},{y:.3f}" for x, y in verts(BODIES[pid]))
            fill_op = 0.30 if is_sel else 0.16
            sw = 0.022 if is_sel else 0.014
            out.append(f'<polygon points="{pts}" fill="{c}" fill-opacity="{fill_op}" stroke="{c}" '
                       f'stroke-width="{sw}" opacity="{op}" stroke-linejoin="round"/>')
        if kind == "tank":
            # hatching: propellant fill level (blueprint section lines)
            b = BODIES[parts[0]]; x, y = b["position"]["x"], b["position"]["y"]
            w, h = b["shape"]["width"], b["shape"]["height"]
            out.append(f'<clipPath id="clip-{cid}"><rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}"/></clipPath>')
            lines = "".join(f'<line x1="{x-w/2+i*0.12-0.6}" y1="{y-h/2}" x2="{x-w/2+i*0.12+0.4}" y2="{y+h/2}"/>' for i in range(22))
            out.append(f'<g clip-path="url(#clip-{cid})" stroke="{c}" stroke-width="0.008" opacity="{0.55*op}">{lines}</g>')
    # selection outline
    if sel:
        xs, ys = [], []
        for cid, kind, parts, _ in COMPONENTS:
            if cid == sel:
                for pid in parts:
                    for x, y in verts(BODIES[pid]):
                        xs.append(x); ys.append(y)
        pad = 0.08
        out.append(f'<rect x="{min(xs)-pad}" y="{min(ys)-pad}" width="{max(xs)-min(xs)+2*pad}" height="{max(ys)-min(ys)+2*pad}" '
                   f'fill="none" stroke="#ffe08a" stroke-width="0.016" stroke-dasharray="0.06 0.04"/>')
        for hx in (min(xs) - pad, max(xs) + pad):
            for hy in (min(ys) - pad, max(ys) + pad):
                out.append(f'<rect x="{hx-0.05}" y="{hy-0.05}" width="0.1" height="0.1" fill="#0b1430" stroke="#ffe08a" stroke-width="0.016"/>')
    # welds
    if show_welds:
        for j in SHIP["joints"]:
            a, b = j["a"].replace("p{n}-", ""), j["b"].replace("p{n}-", "")
            if PART_OF.get(a) == PART_OF.get(b):
                continue  # inside a component: hidden (part of the engine)
            x, y = world_anchor(a, j["anchorA"])
            jid = j["id"].replace("p{n}-", "")
            hot = weld_sel and jid in weld_sel
            if hot:
                out.append(f'<circle cx="{x}" cy="{y}" r="0.13" fill="none" stroke="#ffe08a" stroke-width="0.02"/>')
                out.append(f'<circle cx="{x}" cy="{y}" r="0.055" fill="#ffe08a"/>')
            else:
                out.append(f'<circle cx="{x}" cy="{y}" r="0.04" fill="#0b1430" stroke="#e8f0ff" stroke-width="0.014" opacity="{0.4 if dim_others else 0.9}"/>')
    return "\n".join(out)


def thrust_arrows(op=1):
    out = []
    for cid, kind, parts, _ in COMPONENTS:
        if kind != "engine":
            continue
        b = BODIES[parts[0]]
        inj = b["injector"]
        d = rot((inj["direction"]["x"], inj["direction"]["y"]), b.get("angle", 0))
        x, y = b["position"]["x"], b["position"]["y"]
        L = 0.35 + inj["rate"] * 0.08  # arrow length grows with flow
        tx, ty = x - d[0] * L, y - d[1] * L
        sx, sy = x - d[0] * 0.15, y - d[1] * 0.15
        out.append(f'<line x1="{sx}" y1="{sy}" x2="{tx}" y2="{ty}" stroke="#7fd4ff" stroke-width="0.02" marker-end="url(#arr)" opacity="{op}"/>')
    return "\n".join(out)


def dimension_lines():
    """Blueprint dimensions on the selected main thruster."""
    m = BODIES["main"]; wa = verts(BODIES["main-wall-a"]); wb = verts(BODIES["main-wall-b"])
    x0, x1 = -0.6, 0.6
    yt = m["position"]["y"] + 0.075
    s = []
    T = 'font-family="IBM Plex Mono" font-size="0.13" fill="#ffe08a" transform="scale(1,-1)"'
    # chamber width above? put below the exit
    yb = min(p[1] for p in wa) - 0.28
    ex0 = min(p[0] for p in wa); ex1 = max(p[0] for p in wb)
    # nozzle length on the right
    xr = ex1 + 0.25
    ytop = max(p[1] for p in wb); ybot = min(p[1] for p in wb)
    s.append(f'<line x1="{xr}" y1="{ytop}" x2="{xr}" y2="{ybot}" stroke="#ffe08a" stroke-width="0.01" marker-start="url(#tick)" marker-end="url(#tick)"/>')
    s.append(f'<text x="{xr+0.06}" y="{-(ytop+ybot)/2}" {T}>1.10</text>')
    # exit width
    s.append(f'<line x1="{ex0}" y1="{yb}" x2="{ex1}" y2="{yb}" stroke="#ffe08a" stroke-width="0.01" marker-start="url(#tick)" marker-end="url(#tick)"/>')
    s.append(f'<text x="{-0.17}" y="{-(yb-0.17)}" {T}>exit 1.70</text>')
    # flare angle arc at wall b
    cx, cy = 0.55, ytop
    s.append(f'<line x1="{cx}" y1="{cy}" x2="{cx}" y2="{cy-0.75}" stroke="#ffe08a" stroke-width="0.006" stroke-dasharray="0.03 0.03"/>')
    s.append(f'<path d="M {cx} {cy-0.55} A 0.55 0.55 0 0 0 {cx+0.55*math.sin(math.radians(12.8))} {cy-0.55*math.cos(math.radians(12.8))}" fill="none" stroke="#ffe08a" stroke-width="0.01"/>')
    s.append(f'<text x="{cx-0.5}" y="{-(cy-0.62)}" {T}>12.8°</text>')
    return "\n".join(s)


def ship_block(scale, cx, cy, inner, extra=""):
    return f'<g transform="translate({cx},{cy}) scale({scale},{-scale})">{inner}{extra}</g>'


DEFS = """
<defs>
 <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7fd4ff"/></marker>
 <marker id="tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2,9 L8,1" stroke="#ffe08a" stroke-width="1.4"/></marker>
 <pattern id="gridMinor" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#9fb8ff" stroke-opacity="0.07" stroke-width="1"/></pattern>
 <pattern id="gridMajor" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#gridMinor)"/><path d="M100 0H0V100" fill="none" stroke="#9fb8ff" stroke-opacity="0.17" stroke-width="1"/></pattern>
</defs>"""


def com_marker(x, y, r=11):
    return (f'<g transform="translate({x},{y})"><circle r="{r}" fill="#0b1430" stroke="#fff" stroke-width="1.5"/>'
            f'<path d="M0,-{r} A{r},{r} 0 0 1 {r},0 L0,0 Z M0,{r} A{r},{r} 0 0 1 -{r},0 L0,0 Z" fill="#fff"/>'
            f'<line x1="-{r+8}" y1="0" x2="-{r+2}" y2="0" stroke="#fff"/><line x1="{r+2}" y1="0" x2="{r+8}" y2="0" stroke="#fff"/>'
            f'<line y1="-{r+8}" y2="-{r+2}" x1="0" x2="0" stroke="#fff"/><line y1="{r+2}" y2="{r+8}" x1="0" x2="0" stroke="#fff"/></g>')


CSS = open(os.path.join(HERE, "blueprint.css")).read()


def page(title, body, w, h, extra_css=""):
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@400;500;600&display=swap" rel="stylesheet">
<style>{CSS}
:root{{--W:{w}px;--H:{h}px}} {extra_css}</style></head><body><div class="app">{body}</div></body></html>"""


# ---------- shared panels ----------
CATS = ["Cockpits", "Engines", "Tanks", "Storage", "Weapons", "Generators", "Batteries", "Utilities"]


def icon_engine(head_w=34, wall=30, flare=10, extra=""):
    hw = head_w / 2
    return (f'<svg viewBox="-30 -6 60 52" class="ico"><rect x="{-hw}" y="0" width="{head_w}" height="7" />'
            f'<polygon points="{-hw+2},7 {-hw+6},7 {-hw-flare+6},{7+wall} {-hw-flare+2},{7+wall}"/>'
            f'<polygon points="{hw-2},7 {hw-6},7 {hw+flare-6},{7+wall} {hw+flare-2},{7+wall}"/>{extra}</svg>')


def left_panel(cat="Engines", active=1, cards=None, touch=False, dragging=None):
    if cards is None:
        cards = [
            ("Light thruster", "0.8 m · 1.2 kg", "1.45 kg/s", icon_engine(26, 22, 5)),
            ("Main thruster", "1.2 m · 3.0 kg", "7.78 kg/s", icon_engine(36, 34, 8)),
            ("Lander engine", "1.0 m · 81 N", "0.5 kg/s", icon_engine(32, 26, 4)),
            ("Heavy engine", "1.2 m · 580 N", "6 kg/s · lean", icon_engine(36, 30, 2, '<rect x="-12" y="-5" width="24" height="5"/>')),
            ("Steering jet", "0.3 m · new", "small turns", icon_engine(14, 12, 3)),
        ]
    dots = "".join(f'<button class="dot{" on" if i == active else ""}" title="{c}">{c[:2].upper()}</button>' for i, c in enumerate(CATS))
    items = []
    for i, (n, a, b, ic) in enumerate(cards):
        cls = "card" + (" picked" if dragging == n else "")
        items.append(f'<div class="{cls}"><div class="thumb">{ic}</div><div class="ctext"><div class="cname">{n}</div>'
                     f'<div class="cstat">{a}</div><div class="cstat">{b}</div></div>'
                     f'<button class="add" title="Add to blueprint (or double-click / drag)">＋</button></div>')
    return f"""
<section class="panel left">
  <header class="ph"><span class="phl">COMPONENTS</span><button class="ib sm" title="Search components (/)">⌕</button></header>
  <div class="typesel">
    <button class="arrow" title="Previous type ([)">◀</button>
    <div class="tname"><small>TYPE · {active+1}/8</small><b>{cat.upper()}</b><span class="caret">▾</span></div>
    <button class="arrow" title="Next type (])">▶</button>
  </div>
  <div class="dots">{dots}</div>
  <div class="listwrap">
    <div class="list">{''.join(items)}</div>
    <div class="sbar"><button class="sbtn">▲</button><div class="strack"><div class="sthumb" style="top:6%;height:58%"></div></div><button class="sbtn">▼</button></div>
  </div>
  <footer class="pf">Drag onto the blueprint · double-click · or ＋</footer>
</section>"""


def field(label, value, unit, pos, changed=False, readonly=False, note=""):
    reset = '<button class="reset" title="Back to default">↺</button>' if changed else ""
    ro = " ro" if readonly else ""
    ctl = "" if readonly else f"""<div class="sl"><button class="step" title="Smaller (−)">◀</button>
      <div class="track"><div class="fill" style="width:{pos}%"></div><div class="knob" style="left:{pos}%"></div></div>
      <button class="step" title="Larger (+)">▶</button></div>"""
    return f"""<div class="field{ro}{' changed' if changed else ''}">
  <div class="fl"><label title="Drag the name left/right to scrub">{label}</label>{reset}
   <div class="val"><span class="num">{value}</span><span class="unit">{unit}</span></div></div>
  {ctl}{f'<div class="note">{note}</div>' if note else ''}
</div>"""


def stats_box(rows, title="THRUST 1", sub="Preset · read-only — Duplicate to edit"):
    r = "".join(f'<tr><th>{k}</th><td>{v}</td><td class="d {c}">{d}</td></tr>' for k, v, d, c in rows)
    return f'<div class="stats"><div class="sh">PERFORMANCE <small>full tanks · full magazine</small></div><table>{r}</table></div>'


STD_STATS = [
    ("Mass", "61.2 kg", "", ""), ("Width × height", "5.2 × 3.6 m", "", ""),
    ("Accel. forward", "28.3 m/s²", "", ""), ("Accel. reverse", "4.2 m/s²", "", ""),
    ("Turn", "≈ 7 rad/s²", "", ""), ("Thrust ÷ mass", "Fwd 2.9 g", "", ""),
    ("Full-burn time", "— s", "", ""), ("Joins", "20 welds · 17 parts", "", ""),
]


def topbar(name="THRUST 1", dirty=False, touch=False, preset=True):
    badge = '<span class="badge">PRESET</span>' if preset else '<span class="badge edit">EDITING</span>'
    return f"""
<header class="top">
  <button class="ib menu" title="Blueprints: new, open, duplicate, import, export (Ctrl+O)">☰ <span>BLUEPRINTS</span></button>
  <div class="title"><span class="tl">DRAWING</span><span class="tn">{name}{'<i>●</i>' if dirty else ''}</span>{badge}</div>
  <div class="grp"><button class="ib" title="Undo (Ctrl+Z)">↶</button><button class="ib" title="Redo (Ctrl+Shift+Z)">↷</button></div>
  <div class="grp tog"><button class="ib on" title="Centre of mass (C)">◉ CoM</button><button class="ib on" title="Thrust arrows (T)">↑ Thrust</button><button class="ib on" title="Welds (W)">• Welds</button><button class="ib" title="Dimensions (D)">⟷ Dims</button><button class="ib on" title="Snap (S, hold Shift to override)">⌗ Snap</button></div>
  <div class="spacer"></div>
  <button class="ib" title="Fit (Z)">⤢ Fit</button>
  <button class="try" title="Try it in the sandbox (Enter)">▶ TRY IT</button>
</header>"""


def canvas(inner_svg, w, h, extra_html=""):
    return f"""
<main class="canvas">
 <svg class="bp" width="100%" height="100%">{DEFS}<rect width="100%" height="100%" fill="url(#gridMajor)"/>{inner_svg}</svg>
 {extra_html}
</main>"""


def scalebar(x, y, px_per_m):
    ticks = "".join(f'<line x1="{x+i*px_per_m/2}" y1="{y-4 if i%2 else y-8}" x2="{x+i*px_per_m/2}" y2="{y}" stroke="#e8f0ff"/>' for i in range(5))
    return (f'<g class="scale"><line x1="{x}" y1="{y}" x2="{x+2*px_per_m}" y2="{y}" stroke="#e8f0ff" stroke-width="1.5"/>{ticks}'
            f'<text x="{x}" y="{y+16}">0</text><text x="{x+px_per_m-4}" y="{y+16}">1</text><text x="{x+2*px_per_m-14}" y="{y+16}">2 m</text></g>')


def title_block(name="THRUST 1"):
    return f"""<div class="tblock"><div><small>DRAWING</small><b>{name}</b></div><div><small>SCALE</small><b>1 m = 100 px</b></div>
 <div><small>REV</small><b>7</b></div><div><small>DESIGNER</small><b>MAMMOTH YARD</b></div></div>"""


def zoomctl():
    return '<div class="zoom"><button>＋</button><div class="zl">100%</div><button>−</button></div>'


def statusbar(text):
    return f'<footer class="status">{text}</footer>'


def right_engine(touch=False):
    tabs = '<div class="tabs"><button class="on">SHAPE</button><button>FUEL</button><button>BUILD</button><button>LINKS</button></div>'
    fields = "".join([
        field("Chamber width", "1.20", "m", 46),
        field("Chamber length", "1.35", "m", 50),
        field("Throat width", "1.00", "m", 44, changed=True),
        field("Wall thickness", "0.10", "m", 20),
        field("Nozzle wall length", "1.10", "m", 40),
        field("Nozzle flare", "12.8", "°", 43),
    ])
    return f"""
<section class="panel right">
  <header class="ph"><span class="phl">PROPERTIES</span><button class="ib sm" title="Collapse panel">⇥</button></header>
  <div class="selhead"><div class="swatch" style="background:{COL['engine']}"></div><div><b>Main thruster</b><small>Engine · chemical H₂/O₂ · 3 parts, 2 welds</small></div></div>
  {tabs}
  <div class="fields">{fields}</div>
  <div class="derived"><div><small>THRUST (est.)</small><b>1.40 kN</b></div><div><small>MASS</small><b>3.00 kg</b></div><div><small>EXHAUST</small><b>≈ 190 m/s</b></div></div>
  <div class="actions"><button>⧉ Duplicate</button><button>⇋ Mirror</button><button class="danger">🗑 Remove</button></div>
</section>"""


def right_weld():
    rows = "".join([
        field("Tension limit", "22 950", "N", 46),
        field("Compression limit", "45 900", "N", 46),
        field("Shear limit", "16 050", "N", 46),
        field("Torque limit", "5 520", "N·m", 46),
        field("Yield (bend before break)", "0.30", "", 30),
    ])
    return f"""
<section class="panel right">
  <header class="ph"><span class="phl">PROPERTIES</span><button class="ib sm">⇥</button></header>
  <div class="selhead"><div class="swatch weld"></div><div><b>Weld · Tank L ↔ Generator L</b><small>2 weld points · 0.60 m apart</small></div></div>
  <div class="joins"><button class="chip" style="--c:{COL['tank']}">Tank L ↗</button><span>↔</span><button class="chip" style="--c:{COL['power']}">Generator L ↗</button></div>
  <div class="seg"><span>Strength</span><button>Light</button><button class="on">Standard</button><button>Heavy</button><button>Custom</button></div>
  <div class="fields">{rows}</div>
  <div class="derived"><div><small>WEAKEST WAY</small><b>Torque</b></div><div><small>HOLDS</small><b>≈ 38 g</b></div><div><small>LIVE LOAD</small><b>— (try it)</b></div></div>
  <div class="actions"><button>✂ Unweld</button><button class="danger">🗑 Remove weld</button></div>
</section>"""


def right_placing():
    return f"""
<section class="panel right">
  <header class="ph"><span class="phl">PROPERTIES</span><button class="ib sm">⇥</button></header>
  <div class="selhead"><div class="swatch" style="background:{COL['tank']}"></div><div><b>Placing: Propellant tank</b><small>Tank · H₂/O₂ 1 : 8 · new</small></div></div>
  <div class="placing">
    <div class="pl-row ok"><span>●</span> Snaps to <b>Tank R</b> (right face, flush)</div>
    <div class="pl-row ok"><span>●</span> 2 weld points · Standard</div>
    <div class="pl-row warn"><span>▲</span> Centre of mass moves 0.31 m right — the ship will turn while thrusting</div>
    <div class="pl-row"><span>⇧</span> Hold Shift to place without snapping</div>
    <div class="pl-row"><span>⎋</span> Esc or drop on the list to cancel</div>
  </div>
  <div class="derived"><div><small>MASS</small><b>6.05 kg</b></div><div><small>H₂ + O₂</small><b>4.05 kg</b></div><div><small>SIZE</small><b>1.5 × 1.0 m</b></div></div>
</section>"""


def editor(w, h, right, ship_inner, stats_rows, status, left=None, overlay="", touch=False, name="THRUST 1", preset=True, dirty=False, extra_canvas=""):
    cls = " touch" if touch else ""
    return f'<div class="grid{cls}">{topbar(name, dirty, touch, preset)}{left or left_panel(touch=touch)}{canvas(ship_inner, w, h, stats_box(stats_rows) + title_block(name) + zoomctl() + extra_canvas)}{right}{statusbar(status)}</div>{overlay}'


def ship_layer(cw, ch, scale, ox=0, oy=0, **kw):
    cx, cy = cw / 2 + ox, ch / 2 + oy
    inner = ship_svg(**kw)
    arrows = thrust_arrows()
    dims = dimension_lines() if kw.get("dims") else ""
    g = ship_block(scale, cx, cy, inner + arrows + dims)
    com = com_marker(cx + 0 * scale, cy - 0.013 * scale)
    return g + com, cx, cy


def write(name, html):
    open(os.path.join(HERE, name), "w").write(html)


# Canvas sizes (approx, for placing the ship): desktop 1280x800 -> canvas ~ 1280-250-300 x 800-48-28
def build():
    # 1. Engine selected (desktop)
    W, H = 1280, 800
    cw, ch = W - 248 - 300, H - 48 - 26
    layer, cx, cy = ship_layer(cw, ch, 100, oy=10, sel="main", dims=True)
    layer += scalebar(24, ch - 30, 100)
    write("01-engine-selected.html", page("Blueprint · engine selected", editor(W, H, right_engine(), layer, STD_STATS,
          "<b>Main thruster</b> selected · drag to move (its welds re-form where it lands) · <kbd>Del</kbd> remove · <kbd>Tab</kbd> next part · <kbd>Esc</kbd> deselect"), W, H))

    # 2. Dragging a tank in (snap preview)
    layer2, cx, cy = ship_layer(cw, ch, 100, ox=-60, oy=10, show_welds=True)
    # ghost tank snapped below back-r thruster? put it to the right of tank-r: x=2.05+1.5=3.55
    gx, gy = 3.55 + 0.0, -0.549612
    s = 100; X = cx + gx * s; Y = cy - gy * s
    ghost = (f'<g><rect x="{X-0.75*s}" y="{Y-0.5*s}" width="{1.5*s}" height="{1.0*s}" fill="{COL["tank"]}" fill-opacity="0.12" stroke="#7dffb0" stroke-width="2" stroke-dasharray="7 5"/>'
             f'<text x="{X-28}" y="{Y+5}" class="ghostlbl">TANK</text>'
             f'<circle cx="{X-0.75*s}" cy="{Y-0.4*s}" r="7" fill="none" stroke="#7dffb0" stroke-width="2"/><circle cx="{X-0.75*s}" cy="{Y-0.4*s}" r="3" fill="#7dffb0"/>'
             f'<circle cx="{X-0.75*s}" cy="{Y+0.3*s}" r="7" fill="none" stroke="#7dffb0" stroke-width="2"/><circle cx="{X-0.75*s}" cy="{Y+0.3*s}" r="3" fill="#7dffb0"/>'
             f'<line x1="{X-0.75*s}" y1="{Y-0.5*s-30}" x2="{X-0.75*s}" y2="{Y+0.5*s+30}" stroke="#7dffb0" stroke-dasharray="4 4" opacity=".7"/>'
             f'<line x1="{cx-2.8*s}" y1="{Y-0.5*s}" x2="{X+0.75*s+20}" y2="{Y-0.5*s}" stroke="#7dffb0" stroke-dasharray="4 4" opacity=".5"/>'
             f'<text x="{X-0.75*s+8}" y="{Y-0.5*s-10}" class="snaplbl">SNAP · flush with Tank R</text>'
             f'<g transform="translate({X+40},{Y+30})"><path d="M0,0 L0,18 L5,14 L9,22 L12,20 L8,13 L14,13 Z" fill="#fff" stroke="#000" stroke-width="1"/></g></g>')
    # CoM shift arrow
    ccx, ccy = cx, cy
    ghost += f'<line x1="{ccx+14}" y1="{ccy}" x2="{ccx+0.31*s+24}" y2="{ccy}" stroke="#ffb35a" stroke-width="2" marker-end="url(#arr)" opacity=".9"/>'
    ghost += f'<g opacity=".55">{com_marker(ccx+0.31*s+34, ccy, 8)}</g><text x="{ccx+20}" y="{ccy-16}" class="warnlbl">CoM → 0.31 m</text>'
    layer2 += ghost + scalebar(24, ch - 30, 100)
    st2 = [("Mass", "61.2 → 67.3 kg", "+6.1", "up"), ("Width × height", "6.7 × 3.6 m", "+1.5", "up"),
           ("Accel. forward", "25.7 m/s²", "−2.6", "down"), ("Accel. reverse", "3.8 m/s²", "−0.4", "down"),
           ("Turn", "≈ 5.9 rad/s²", "−1.1", "down"), ("Thrust ÷ mass", "Fwd 2.6 g", "", ""),
           ("Full-burn time", "— s", "+", "up"), ("Joins", "21 welds · 18 parts", "+1", "")]
    write("02-dragging-snap.html", page("Blueprint · placing a tank", editor(W, H, right_placing(), layer2, st2,
          "Placing <b>Propellant tank</b> · green = will weld · release to place · <kbd>Shift</kbd> no snap · <kbd>R</kbd> rotate (later) · <kbd>Esc</kbd> cancel",
          left=left_panel("Tanks", 2, cards=[
              ("Propellant tank", "1.5 × 1.0 m", "6.05 kg full", '<svg viewBox="-30 -6 60 52" class="ico"><rect x="-24" y="4" width="48" height="32"/></svg>'),
              ("Round tank", "⌀ 1.0 m", "3.6 kg full", '<svg viewBox="-30 -6 60 52" class="ico"><circle cx="0" cy="20" r="16"/></svg>'),
              ("Slim tank", "1.5 × 0.5 m", "3.8 kg full", '<svg viewBox="-30 -6 60 52" class="ico"><rect x="-24" y="12" width="48" height="16"/></svg>'),
              ("Xenon tank", "later", "—", '<svg viewBox="-30 -6 60 52" class="ico" opacity=".4"><rect x="-14" y="4" width="28" height="32" rx="10"/></svg>'),
          ], dragging="Propellant tank"), name="THRUST 1 COPY", preset=False, dirty=True), W, H))

    # 3. Weld selected
    layer3, cx, cy = ship_layer(cw, ch, 100, oy=10, weld_sel={"w-tank-gen-l-a", "w-tank-gen-l-b"}, dim_others=False)
    # pop label
    s = 100; wx, wy = world_anchor("tank-l", {"x": 0.75, "y": -0.4})
    X, Y = cx + wx * s, cy - wy * s
    layer3 += (f'<g class="callout"><line x1="{X}" y1="{Y}" x2="{X+30}" y2="{Y+170}" stroke="#ffe08a"/>'
               f'<rect x="{X+30}" y="{Y+170}" width="196" height="46" rx="3" fill="#0b1430" stroke="#ffe08a"/>'
               f'<text x="{X+40}" y="{Y+188}" class="co1">WELD  Tank L ↔ Generator L</text><text x="{X+40}" y="{Y+206}" class="co2">weakest: torque 5.5 kN·m</text></g>')
    layer3 += scalebar(24, ch - 30, 100)
    write("03-weld-selected.html", page("Blueprint · weld selected", editor(W, H, right_weld(), layer3, STD_STATS,
          "<b>Weld</b> selected · click a part's name to jump to it · <kbd>Del</kbd> remove weld · <kbd>Esc</kbd> deselect"), W, H))

    # 4. Blueprints menu (overlay)
    def thumb(scale=11, w=120, h=70):
        return f'<svg width="{w}" height="{h}">{ship_block(scale, w/2, h/2+4, ship_svg(show_welds=False))}</svg>'
    designs = [
        ("THRUST 1", "Preset", "61.2 kg · 28.3 m/s² · 5 engines", True, True),
        ("THRUST 1 COPY", "Edited 2 min ago", "67.3 kg · 25.7 m/s² · 5 engines", False, False),
        ("ASTEROIDS SHIP", "Preset", "≈ 59 kg · 3 engines fwd", True, False),
        ("LANDER", "Preset", "25.8 kg · 6.3 m/s² · 2 engines", True, False),
        ("GUNSHIP 3", "Preset", "90.8 kg · 12.8 m/s² · 2 engines", True, False),
        ("MAMMOTH", "Preset", "279 kg · 6.4 m/s² · 4 engines", True, False),
    ]
    cards = "".join(f'<div class="dcard{" cur" if cur else ""}">{thumb() if i < 2 else "<div class=nothumb>preview</div>"}<div class="dt"><b>{n}</b>'
                    f'<small>{"🔒 " if pre else ""}{sub}</small><small>{st}</small></div></div>' for i, (n, sub, st, pre, cur) in enumerate(designs))
    overlay = f"""<div class="scrim"></div>
<div class="drawer">
 <header class="ph"><span class="phl">BLUEPRINTS</span><button class="ib sm" title="Close (Esc)">✕</button></header>
 <div class="dtools"><button class="primary">＋ New blank</button><button>⧉ Duplicate</button><button>✎ Rename</button><button>⤓ Export</button><button>⤒ Import</button><button class="danger">🗑</button></div>
 <div class="dfilter"><button class="on">All 6</button><button>Mine 1</button><button>Presets 5</button><input placeholder="Search…"></div>
 <div class="dlist">{cards}</div>
 <footer class="pf">Presets can't be changed: editing one makes a copy · Saved in this browser · Export for a file</footer>
</div>"""
    layer4, _, _ = ship_layer(cw, ch, 100, oy=10)
    write("04-blueprints-menu.html", page("Blueprint · blueprints menu", editor(W, H, right_engine(), layer4, STD_STATS, "Blueprints", overlay=overlay), W, H))

    # 5. Try it
    tw, th = W, H
    s = 34
    shipg = ship_block(s, 560, 440, ship_svg(show_welds=False), "")
    # rotate ship slightly
    shipg = f'<g transform="rotate(-24 560 440)">{shipg}' + \
            ''.join(f'<circle cx="{560+dx}" cy="{440+60+dy}" r="{r}" fill="{c}" opacity="{o}"/>' for dx, dy, r, c, o in
                    [(0, 10, 9, "#fff3c0", .9), (-6, 26, 8, "#ffc36a", .8), (5, 42, 7, "#ff9b4a", .6), (-3, 60, 6, "#ff7a3a", .4), (2, 80, 5, "#c85a2a", .25),
                     (-70, -40, 4, "#ffc36a", .5), (70, -40, 4, "#ffc36a", .5), (-70, -28, 3, "#ff9b4a", .3), (70, -28, 3, "#ff9b4a", .3)]) + '</g>'
    stars = "".join(f'<circle cx="{(i*397)%W}" cy="{(i*211)%H}" r="{0.6+(i%3)*0.4}" fill="#fff" opacity="{0.3+(i%5)*0.12}"/>' for i in range(160))
    rock = '<polygon points="930,250 1000,215 1075,240 1110,310 1085,385 1010,410 950,380 915,320" fill="#2a2f45" stroke="#8d95b8" stroke-width="2"/>' \
           '<circle cx="1000" cy="300" r="14" fill="none" stroke="#596080"/><circle cx="1050" cy="350" r="8" fill="none" stroke="#596080"/>'
    wrap = '<rect x="6" y="6" width="1268" height="788" fill="none" stroke="#7fd4ff" stroke-opacity=".25" stroke-dasharray="10 8"/>'
    trybody = f"""<div class="try-view"><svg width="{W}" height="{H}">{DEFS}<rect width="100%" height="100%" fill="#03050c"/>{stars}{wrap}{rock}{shipg}
<text x="1040" y="440" class="rocklbl">TARGET ROCK · 1 of 1</text></svg>
<div class="tbar"><button class="back">◀ BACK TO BLUEPRINT <kbd>Esc</kbd></button><div class="tt"><small>TRY-OUT</small><b>THRUST 1 COPY</b><span>no gravity · edges wrap · nothing is saved</span></div>
<div class="spacer"></div><button class="ib">↺ Refuel & reset <kbd>R</kbd></button><button class="ib">⏸ Pause <kbd>Space</kbd></button><button class="ib">◌ Rock: on</button></div>
<div class="gauges"><div class="g"><small>FUEL</small><div class="bar"><i style="width:82%"></i></div><b>6.6 / 8.1 kg</b></div>
<div class="g"><small>SHELLS</small><div class="bar"><i style="width:91%"></i></div><b>109 / 120</b></div>
<div class="g"><small>SPEED</small><b class="big">14.2 m/s</b></div><div class="g"><small>SPIN</small><b class="big">0.6 rad/s</b></div>
<div class="g"><small>DAMAGE</small><b class="big">0 parts lost</b></div></div>
<div class="keys"><b>CONTROLS</b><span><kbd>W</kbd> fire</span><span><kbd>↑</kbd> forward</span><span><kbd>Q</kbd><kbd>E</kbd> turn</span><span><kbd>S</kbd> reverse</span><span><kbd>Z</kbd> tractor</span><span><kbd>X</kbd> shield</span></div>
</div>"""
    write("05-try-it.html", page("Blueprint · try it", trybody, W, H))

    # 6. iPad landscape (1180 x 820): touch sizes, Properties collapsible
    W6, H6 = 1180, 820
    cw6, ch6 = W6 - 236 - 300, H6 - 56 - 28
    layer6, _, _ = ship_layer(cw6, ch6, 80, oy=20, sel="main", dims=True)
    layer6 += scalebar(24, ch6 - 30, 80)
    write("06-ipad-landscape.html", page("Blueprint · iPad", editor(W6, H6, right_engine(touch=True), layer6, STD_STATS,
          "Tap to select · drag to move · two fingers to pan and pinch to zoom · long-press for more", touch=True), W6, H6))


if __name__ == "__main__":
    build()
    print("written")
