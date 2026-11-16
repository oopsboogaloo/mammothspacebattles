"""Controls mode mockup (docs/blueprint/spec.md §9): linking the player's controls to engines and devices.

The mix shown is the Thrust ship's own (src/core/arcade.ts, steerValues), written as mixer lines.
Run through make.py.
"""
import math
import make as M

ENG = {"main": "MAIN", "back-l": "BL", "back-r": "BR", "front-l": "FL", "front-r": "FR"}
# Test held: Forward + Turn right -> steerValues: main 1, BL 1, BR 0, FR 1 - 0.5 = 0.5, FL 0.
THROTTLE = {"main": 1.0, "back-l": 1.0, "back-r": 0.0, "front-l": 0.0, "front-r": 0.5}

CONTROLS = [
    ("↑", "Forward", "analog", ["↑", "Pad A", "RT", "Stick ↑"], True),
    ("↓", "Reverse", "analog", ["S", "↓", "Pad B", "LT"], False),
    ("↺", "Turn left", "analog", ["Q", "←", "L-Shift", "Stick ←"], False),
    ("↻", "Turn right", "analog", ["E", "→", "R-Shift", "Stick →"], True),
    ("✦", "Fire", "hold", ["Space", "W", "Pad X", "RB"], False),
    ("⌁", "Tractor", "hold", ["Z", "/", "Pad Y"], False),
    ("◯", "Shield", "hold", ["X", ".", "LB"], False),
]
COLS = ["Forward", "Reverse", "Turn left", "Turn right", "Fire", "Tractor", "Shield"]
ROWS = [
    ("main", "Main thruster", "engine", {"Forward": ("100", "")}, 100),
    ("back-l", "Thruster BL", "engine", {"Forward": ("100", "− Turn left"), "Turn right": ("100", "")}, 100),
    ("back-r", "Thruster BR", "engine", {"Forward": ("100", "− Turn right"), "Turn left": ("100", "")}, 0),
    ("front-l", "Thruster FL", "engine", {"Reverse": ("100", ""), "Turn left": ("100", "− 50% Fwd")}, 0),
    ("front-r", "Thruster FR", "engine", {"Reverse": ("100", ""), "Turn right": ("100", "− 50% Fwd")}, 50),
    ("gun", "Railgun", "weapon", {"Fire": ("on", "")}, 0),
    ("tractor", "Tractor projector", "utility", {"Tractor": ("on", "")}, 0),
    ("shield", "Shield emitter", "utility", {"Shield": ("on", "")}, 0),
]


def plumes():
    out = []
    for cid, thr in THROTTLE.items():
        b = M.BODIES[cid]
        inj = b["injector"]
        d = M.rot((inj["direction"]["x"], inj["direction"]["y"]), b.get("angle", 0))
        wall = M.BODIES[cid + "-wall-a"]["shape"]["vertices"]
        L = max(v["y"] for v in wall) - min(v["y"] for v in wall)
        w = b["shape"]["width"] * 0.55
        x, y = b["position"]["x"] + d[0] * (L + 0.1), b["position"]["y"] + d[1] * (L + 0.1)
        n = (-d[1], d[0])
        tip = (x + d[0] * (0.25 + 1.3 * thr), y + d[1] * (0.25 + 1.3 * thr))
        if thr > 0:
            pts = f"{x+n[0]*w},{y+n[1]*w} {x-n[0]*w},{y-n[1]*w} {tip[0]},{tip[1]}"
            out.append(f'<polygon points="{pts}" fill="url(#plume)" opacity="{0.45+0.5*thr}"/>')
        # tag
        hx, hy = b["position"]["x"], b["position"]["y"]
        tx = hx + (0.62 if hx >= 0 else -0.62) * (1 if abs(hx) > 0.1 else 0)
        out.append(f'<g transform="translate({tx if cid!="main" else 0.95},{hy - (0.32 if cid=="main" else 0)}) scale(1,-1)">'
                   f'<rect x="-0.36" y="-0.15" width="0.72" height="0.3" rx="0.03" fill="#0b1430" stroke="{"#ffd36a" if thr>0 else "#5a6890"}" stroke-width="0.012"/>'
                   f'<text x="0" y="0.055" text-anchor="middle" font-family="IBM Plex Mono" font-size="0.15" fill="{"#ffd36a" if thr>0 else "#93a3c8"}">{ENG[cid]} {int(thr*100)}%</text></g>')
    return "\n".join(out)


def left():
    rows = []
    for ic, name, kind, keys, held in CONTROLS:
        chips = "".join(f"<kbd>{k}</kbd>" for k in keys)
        rows.append(f'<div class="ctl{" held" if held else ""}"><div class="cic">{ic}</div><div class="cbody"><div class="cn">{name}'
                    f'<span class="kind">{kind}</span></div><div class="ck">{chips}<button class="bind" title="Add a key or button: press it">＋</button></div></div>'
                    f'<button class="testbtn" title="Hold to test">{"●" if held else "○"}</button></div>')
    return f"""
<section class="panel left">
  <header class="ph"><span class="phl">CONTROLS</span><button class="ib sm" title="New control">＋</button></header>
  <div class="ctllist">{''.join(rows)}
   <div class="rule"><b>⇄ Turn left + Turn right</b><span>Opposites: held together they cancel each other and count as <b>Forward</b>.</span><button class="ib sm">✎</button></div>
   <div class="ctl ghost"><div class="cic">＋</div><div class="cbody"><div class="cn">New control…</div><div class="ck dimtxt">e.g. Strafe, Boost, Brake</div></div></div>
  </div>
  <footer class="pf">Hold a control's key, or ● here, to test it on the blueprint</footer>
</section>"""


def mixer():
    head = "".join(f"<th>{c}</th>" for c in COLS)
    body = []
    for cid, name, kind, cells, live in ROWS:
        tds = []
        for c in COLS:
            if c in cells:
                v, ease = cells[c]
                tds.append(f'<td class="on"><b>{v}</b>{f"<small>{ease}</small>" if ease else ""}</td>')
            else:
                tds.append('<td class="off">·</td>')
        sel = " sel" if cid == "back-l" else ""
        bar = f'<div class="lv"><i style="width:{live}%"></i></div><span>{live}%</span>' if kind == "engine" else '<span class="dimtxt">off</span>'
        body.append(f'<tr class="{sel}"><th><span class="sw" style="background:{M.COL[kind]}"></span>{name}</th>{"".join(tds)}<td class="live">{bar}</td></tr>')
    return f"""<div class="mixer"><div class="mh"><b>MIXER</b><span>each engine or device takes the <b>largest</b> of its lines · rows: what is driven · columns: controls</span>
<div class="spacer"></div><button class="ib sm">Clear row</button><button class="ib sm">Copy mirrored ⇋</button></div>
<table><thead><tr><th></th>{head}<th>NOW</th></tr></thead><tbody>{''.join(body)}</tbody></table></div>"""


def response():
    rows = [("Forward", "28.3", "0.0", "0.0", "ok"), ("Reverse", "−4.2", "0.0", "0.0", "ok"),
            ("Turn left", "0.0", "0.0", "4.0 ↺", "ok"), ("Turn right", "0.0", "0.0", "4.0 ↻", "ok"),
            ("Forward + Turn right", "25.2", "0.0", "3.0 ↻", "now")]
    tr = "".join(f'<tr class="{c}"><th>{n}</th><td>{a}</td><td>{s}</td><td>{t}</td></tr>' for n, a, s, t, c in rows)
    return f"""<div class="stats resp"><div class="sh">RESPONSE <small>what each control does · est.</small><button class="measure">⏱ Measure</button></div>
<table><thead><tr><th></th><td>ahead m/s²</td><td>sideways</td><td>turn rad/s²</td></tr></thead>{tr}</table>
<div class="checks"><div class="ok">✓ Every engine is driven by a control</div><div class="ok">✓ Forward and Reverse don't turn the ship</div><div class="ok">✓ Turn left and Turn right are mirror images</div></div></div>"""


def right():
    return f"""
<section class="panel right">
  <header class="ph"><span class="phl">PROPERTIES</span><button class="ib sm">⇥</button></header>
  <div class="selhead"><div class="swatch" style="background:{M.COL['engine']}"></div><div><b>Thruster BL</b><small>Engine · its controls · 2 lines</small></div></div>
  <div class="say">Fires fully on <b>Turn right</b>. Fires on <b>Forward</b>, except while <b>Turn left</b> is held.</div>
  <div class="lines">
   <div class="line"><div class="lh"><span class="ln">1</span><button class="src">↻ Turn right ▾</button><span class="x">×</span><div class="val"><span class="num">100</span><span class="unit">%</span></div><button class="ib sm">✕</button></div>
    <div class="sl"><button class="step">◀</button><div class="track"><div class="fill" style="width:100%"></div><div class="knob" style="left:100%"></div></div><button class="step">▶</button></div></div>
   <div class="line"><div class="lh"><span class="ln">2</span><button class="src">↑ Forward ▾</button><span class="x">×</span><div class="val"><span class="num">100</span><span class="unit">%</span></div><button class="ib sm">✕</button></div>
    <div class="sl"><button class="step">◀</button><div class="track"><div class="fill" style="width:100%"></div><div class="knob" style="left:100%"></div></div><button class="step">▶</button></div>
    <div class="ease"><span>eased by</span><button class="src">↺ Turn left ▾</button><div class="val"><span class="num">100</span><span class="unit">%</span></div><button class="ib sm">✕</button></div></div>
   <button class="addline">＋ Add line</button>
  </div>
  <div class="seg"><span>Combine</span><button class="on">Largest</button><button>Sum</button><button>Min</button><button disabled>—</button></div>
  <div class="field"><div class="fl"><label>Throttle limit</label><div class="val"><span class="num">100</span><span class="unit">%</span></div></div></div>
  <div class="actions"><button>⇋ Mirror to BR</button><button>⧉ Copy lines</button><button class="danger">Clear</button></div>
</section>"""


def build():
    W, H = 1280, 800
    cw, ch = W - 248 - 300, H - 48 - 26
    mixh = 262
    ah = ch - mixh
    s = 64
    cx, cy = cw / 2 - 150, ah / 2 + 40
    inner = M.ship_svg(sel="back-l", dim_others=True, show_welds=False) + plumes()
    g = M.ship_block(s, cx, cy, inner)
    # net result at CoM: arrow ahead, turn arc clockwise
    g += (f'<line x1="{cx}" y1="{cy}" x2="{cx}" y2="{cy-110}" stroke="#7dffb0" stroke-width="3" marker-end="url(#arrG)"/>'
          f'<path d="M {cx-38} {cy-30} A 48 48 0 0 1 {cx+40} {cy-26}" fill="none" stroke="#7dffb0" stroke-width="2.5" marker-end="url(#arrG)"/>'
          f'<text x="14" y="70" class="snaplbl">RESULT  25.2 m/s² ahead · 3.0 rad/s² ↻</text>')
    g += M.com_marker(cx, cy - 0.013 * s, 9)
    defs = M.DEFS.replace("</defs>", '<marker id="arrG" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7dffb0"/></marker>'
                          '<linearGradient id="plume" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c0"/><stop offset=".5" stop-color="#ffb35a"/><stop offset="1" stop-color="#ff6a2a" stop-opacity="0"/></linearGradient></defs>')
    testing = '<div class="testing"><span class="dotlive"></span>TESTING <kbd>↑</kbd> Forward + <kbd>E</kbd> Turn right · let go to stop</div>'
    canvas = f"""<main class="canvas ctlmode"><div class="ctltop"><svg class="bp" width="100%" height="100%">{defs}<rect width="100%" height="100%" fill="url(#gridMajor)"/>{g}</svg>{response()}{testing}</div>{mixer()}</main>"""
    body = (f'<div class="grid">{M.topbar("THRUST 1 COPY", True, False, False, mode="controls")}{left()}{canvas}{right()}'
            f'{M.statusbar("<b>Controls</b> · click a cell to add a line · drag a control from the left onto an engine on the blueprint · hold a key to test · <kbd>B</kbd> back to Build")}</div>')
    M.write("07-controls.html", M.page("Blueprint · controls", body, W, H, CSS))


CSS = """
.ctlmode { display: grid; grid-template-rows: 1fr 262px; }
.ctltop { position: relative; overflow: hidden; }
.ctllist { flex: 1; overflow: hidden; padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; }
.ctl { display: grid; grid-template-columns: 26px 1fr 30px; gap: 6px; align-items: center; border: 1px solid var(--faint); border-radius: 3px; padding: 5px 6px; }
.ctl.held { border-color: var(--go); background: rgba(125,255,176,.06); }
.ctl.held .cic, .ctl.held .testbtn { color: var(--go); }
.ctl.ghost { border-style: dashed; color: var(--dim); }
.cic { font-size: 17px; text-align: center; }
.cn { font-size: 14px; display: flex; gap: 6px; align-items: baseline; }
.kind { font-size: 9.5px; letter-spacing: .14em; color: var(--dim); text-transform: uppercase; }
.ck { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
.ck kbd { font-size: 10px; }
.bind { border: 1px dashed var(--faint); font-size: 10px; height: 17px; width: 20px; border-radius: 3px; color: var(--cyan); }
.testbtn { height: 30px; border-radius: 15px; font-size: 13px; }
.dimtxt { color: var(--dim); font-size: 11px; }
.rule { border: 1px solid rgba(127,212,255,.4); border-radius: 3px; padding: 6px 8px; font-size: 12px; color: var(--dim); position: relative; }
.rule b { color: var(--ink); font-weight: 500; }
.rule > b { display: block; color: var(--cyan); }
.rule .ib { position: absolute; right: 4px; top: 4px; }
.testing { position: absolute; left: 10px; top: 10px; border: 1px solid var(--go); color: var(--go); padding: 5px 10px; font-size: 12px; letter-spacing: .08em; background: rgba(11,20,48,.9); display: flex; gap: 6px; align-items: center; }
.dotlive { width: 8px; height: 8px; border-radius: 50%; background: var(--go); box-shadow: 0 0 8px var(--go); }
.resp { min-width: 330px; }
.resp thead td { font-family: "IBM Plex Sans Condensed"; color: var(--dim); font-size: 10.5px; }
.resp tr.now th, .resp tr.now td { color: var(--go); }
.measure { margin-left: 8px; float: right; height: 22px; padding: 0 8px; border-radius: 3px; font-size: 11px; letter-spacing: .04em; color: var(--cyan); border-color: rgba(127,212,255,.5); }
.checks { border-top: 1px solid var(--faint); padding: 5px 10px; font-size: 11.5px; }
.checks .ok { color: var(--go); }
.mixer { border-top: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
.mh { display: flex; gap: 10px; align-items: center; padding: 4px 10px; border-bottom: 1px solid var(--faint); font-size: 11.5px; color: var(--dim); }
.mh > b { color: var(--ink); letter-spacing: .18em; font-size: 13px; font-weight: 500; }
.mh span b { color: var(--ink); font-weight: 500; }
.mixer table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.mixer thead th { font-weight: 400; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); padding: 3px 2px; border-left: 1px solid var(--faint); }
.mixer thead th:first-child { width: 132px; border-left: none; }
.mixer thead th:last-child { width: 92px; }
.mixer tbody th { text-align: left; font-weight: 400; font-size: 12.5px; padding: 0 8px; white-space: nowrap; }
.mixer td { border-left: 1px solid var(--faint); border-top: 1px solid rgba(190,210,255,.08); text-align: center; height: 26px; font-family: "IBM Plex Mono"; font-size: 12px; }
.mixer td.off { color: rgba(147,163,200,.4); }
.mixer td.on b { font-weight: 500; color: var(--cyan); }
.mixer td.on small { display: block; font-size: 9.5px; color: var(--warn); line-height: 1; margin-top: -1px; }
.mixer tr.sel th, .mixer tr.sel td { background: rgba(255,224,138,.08); }
.mixer tr.sel th { box-shadow: inset 3px 0 0 var(--sel); }
.sw { display: inline-block; width: 8px; height: 12px; margin-right: 7px; vertical-align: -1px; opacity: .8; border-radius: 1px; }
.live { display: flex; align-items: center; gap: 5px; padding: 0 8px; height: 26px; }
.lv { flex: 1; height: 6px; border: 1px solid var(--faint); } .lv i { display: block; height: 100%; background: #ffd36a; }
.live span { font-size: 11px; width: 32px; text-align: right; }
.say { padding: 8px 10px; font-size: 13px; color: var(--dim); border-bottom: 1px solid var(--faint); line-height: 1.35; }
.say b { color: var(--ink); font-weight: 500; }
.lines { padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.line { border: 1px solid var(--faint); border-radius: 3px; padding: 6px 8px; }
.lh { display: flex; align-items: center; gap: 6px; }
.ln { font-family: "IBM Plex Mono"; font-size: 11px; color: var(--dim); width: 12px; }
.src { height: 28px; padding: 0 8px; border-radius: 3px; border-color: var(--cyan); color: var(--cyan); font-size: 12.5px; }
.lh .x { color: var(--dim); }
.lh .val, .ease .val { min-width: 64px; margin-left: auto; }
.ease { display: flex; gap: 6px; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--faint); font-size: 12px; color: var(--warn); }
.ease .src { border-color: var(--warn); color: var(--warn); }
.addline { height: 32px; border-style: dashed; border-radius: 3px; color: var(--cyan); }
"""


def right_cockpit():
    rows = "".join(
        f'<div class="cc{" warn" if w else ""}"><span class="cic">{ic}</span><b>{n}</b><span class="ck">{"".join(f"<kbd>{k}</kbd>" for k in keys[:2])}</span><span class="drv">{d}</span></div>'
        for (ic, n, kind, keys, held), d, w in zip(CONTROLS, ["Main · BL · BR", "FL · FR", "BR · FL", "BL · FR", "Railgun", "Tractor", "Shield"], [0] * 7))
    return f"""
<section class="panel right">
  <header class="ph"><span class="phl">PROPERTIES</span><button class="ib sm">⇥</button></header>
  <div class="selhead"><div class="swatch" style="background:{M.COL['cockpit']}"></div><div><b>Cockpit</b><small>Cockpit · the ship's controls start here · 7 controls, 8 parts wired</small></div></div>
  <div class="tabs"><button>SHAPE</button><button class="on">CONTROLS</button><button>BUILD</button><button>TRACTOR</button></div>
  <div class="cclist"><div class="cch"><span>CONTROL</span><span>KEYS</span><span>DRIVES</span></div>{rows}
   <div class="rule"><b>⇄ Turn left + Turn right</b><span>held together: cancel, count as <b>Forward</b></span></div>
   <div class="okline">✓ Every engine is wired · Forward and Reverse don't turn the ship</div>
  </div>
  <div class="actions two"><button class="primary">⤢ Open mixer <kbd>K</kbd></button><button>＋ New control</button></div>
</section>"""


def wires(cx, cy, s):
    """Control wires from the cockpit to every part it drives (blueprint wiring diagram)."""
    out = []
    hub = (cx, cy - 0.35 * s)
    for cid in ["main", "back-l", "back-r", "front-l", "front-r", "gun", "tractor", "shield"]:
        b = M.BODIES[cid]
        x, y = cx + b["position"]["x"] * s, cy - b["position"]["y"] * s
        mx = hub[0] if abs(x - hub[0]) < 4 else x
        # orthogonal route: down/up from hub to the part's height, then across
        path = f"M {hub[0]} {hub[1]} L {hub[0]} {y} L {x} {y}" if cid not in ("gun", "shield") else f"M {hub[0]} {hub[1]} L {x} {y}"
        out.append(f'<path d="{path}" fill="none" stroke="#7fd4ff" stroke-width="1.6" stroke-dasharray="6 4" opacity=".85"/>')
        out.append(f'<circle cx="{x}" cy="{y}" r="4.5" fill="#0b1430" stroke="#7fd4ff" stroke-width="1.6"/>')
    out.append(f'<rect x="{hub[0]-7}" y="{hub[1]-7}" width="14" height="14" fill="#7fd4ff"/>')
    return "\n".join(out)


def build_cockpit():
    W, H = 1280, 800
    cw, ch = W - 248 - 300, H - 48 - 26
    s = 100
    cx, cy = cw / 2, ch / 2 + 10
    inner = M.ship_svg(sel="hull", show_welds=False)
    layer = M.ship_block(s, cx, cy, inner) + wires(cx, cy, s) + M.com_marker(cx, cy - 0.013 * s)
    layer += f'<text x="{cx-2.6*s}" y="{cy-1.75*s}" class="wirelbl">- - -  CONTROL WIRING · cockpit to 8 parts</text>'
    layer += M.scalebar(24, ch - 30, s)
    body = M.editor(W, H, right_cockpit(), layer, M.STD_STATS,
                    "<b>Cockpit</b> selected · its wires show what each control drives · <kbd>K</kbd> open the mixer · a part knocked off the cockpit's ship no longer answers its controls")
    M.write("08-cockpit-controls.html", M.page("Blueprint · cockpit controls", body, W, H, CSS + CSS2))


CSS2 = """
.cclist { flex: 1; overflow: hidden; padding: 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.cch { display: grid; grid-template-columns: 1fr 78px 92px; font-size: 9.5px; letter-spacing: .16em; color: var(--dim); padding: 0 4px 2px 30px; }
.cc { display: grid; grid-template-columns: 22px 1fr 78px 92px; gap: 4px; align-items: center; border: 1px solid var(--faint); border-radius: 3px; padding: 5px 4px; min-height: 36px; }
.cc b { font-weight: 400; font-size: 13.5px; }
.cc .ck { display: flex; gap: 2px; }
.cc .drv { font-family: "IBM Plex Mono"; font-size: 10.5px; color: var(--cyan); }
.okline { font-size: 11.5px; color: var(--go); padding: 4px 2px; }
.actions.two { grid-template-columns: 1.3fr 1fr; }
.actions .primary { border-color: var(--cyan); color: var(--cyan); }
.wirelbl { font-family: "IBM Plex Mono"; font-size: 11px; fill: var(--cyan); letter-spacing: .1em; }
"""
