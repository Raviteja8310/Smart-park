"""
Generates SmartPark's original page background scenes as optimised, self-animating SVGs.

  python apps/web/scripts/generate-backgrounds.py

Writes apps/web/public/assets/backgrounds/<section>/<name>.svg. Every scene is built from
geometry here (perspective-projected parking decks, vehicles, chargers, gates, control-room
screens) — no stock imagery. Motion is CSS inside each SVG, slow and transform/opacity-only,
and stops under prefers-reduced-motion.
"""
from pathlib import Path
import math
import re
import random

OUT = Path(__file__).resolve().parents[1] / 'public' / 'assets' / 'backgrounds'
W, H = 1600, 900

# --- shared vehicle silhouettes (unit space) -------------------------------------------
REAR_CAR = (  # rear view, 100 wide x 60 tall
    '<path d="M6 40C6 30 13 26 22 24L31 11C34 6 39 4 47 4H53C61 4 66 6 69 11L78 24C87 26 94 30 94 40V50'
    'C94 54 91 57 86 57H14C9 57 6 54 6 50Z" fill="{body}"/>'
    '<path d="M33 12H67L74 23H26Z" fill="{glass}"/>'
    '<rect x="11" y="31" width="22" height="4" rx="2" fill="{tail}" filter="url(#glow)"/>'
    '<rect x="67" y="31" width="22" height="4" rx="2" fill="{tail}" filter="url(#glow)"/>'
    '<rect x="33" y="32.5" width="34" height="1.2" rx=".6" fill="{tail}" opacity=".7"/>'
    '<rect x="10" y="55" width="16" height="6" rx="2" fill="#05070d"/><rect x="74" y="55" width="16" height="6" rx="2" fill="#05070d"/>'
)
SIDE_CAR = (  # side view, 200 long x 64 tall, facing right
    '<path d="M8 44C8 34 17 30 30 28L64 23C77 11 95 6 120 6C142 6 158 12 172 24L188 28C196 30 199 36 199 44V48'
    'C199 51 197 53 193 53H12C9 53 8 51 8 48Z" fill="{body}"/>'
    '<path d="M72 24C82 15 96 11 118 11C136 11 148 16 157 24Z" fill="{glass}"/>'
    '<circle cx="52" cy="53" r="12" fill="#04060c" stroke="{rim}" stroke-width="2"/>'
    '<circle cx="160" cy="53" r="12" fill="#04060c" stroke="{rim}" stroke-width="2"/>'
    '<rect x="188" y="33" width="10" height="4" rx="2" fill="{head}" filter="url(#glow)"/>'
    '<rect x="6" y="33" width="7" height="4" rx="2" fill="{tail}" filter="url(#glow)"/>'
)
TOP_CAR = (  # top-down, 46 x 92, nose up
    '<rect x="3" y="2" width="40" height="88" rx="14" fill="{body}"/>'
    '<path d="M9 26C15 20 31 20 37 26L35 40H11Z" fill="{glass}"/>'
    '<path d="M11 66H35L37 76C31 81 15 81 9 76Z" fill="{glass}" opacity=".7"/>'
    '<rect x="7" y="3" width="9" height="3" rx="1.5" fill="{head}"/><rect x="30" y="3" width="9" height="3" rx="1.5" fill="{head}"/>'
    '<rect x="7" y="86" width="9" height="3" rx="1.5" fill="{tail}"/><rect x="30" y="86" width="9" height="3" rx="1.5" fill="{tail}"/>'
)
BODY_COLORS = ['#1b2236', '#141a2b', '#232c45', '#0f1424', '#2a2f48', '#1d2840', '#30244a']


def car(kind, x, y, scale, body=None, glass='#0a1020', tail='#ff3b5c', head='#cfe0ff', rim='#2b3550', cls='', extra=''):
    tpl = {'rear': REAR_CAR, 'side': SIDE_CAR, 'top': TOP_CAR}[kind]
    body = body or random.choice(BODY_COLORS)
    inner = tpl.format(body=body, glass=glass, tail=tail, head=head, rim=rim)
    c = f' class="{cls}"' if cls else ''
    return f'<g{c} transform="translate({x:.1f} {y:.1f}) scale({scale:.3f})"{extra}>{inner}</g>'


def defs(accent_a='#3b82f6', accent_b='#8b5cf6', extra=''):
    return f'''<defs>
<filter id="glow" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
<filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070f"/><stop offset=".45" stop-color="#0a1022"/><stop offset="1" stop-color="#05070d"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1122"/><stop offset="1" stop-color="#070a14"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e0e7ff" stop-opacity=".0"/><stop offset=".2" stop-color="#e0e7ff" stop-opacity=".35"/><stop offset="1" stop-color="#e0e7ff" stop-opacity="0"/></linearGradient>
<linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{accent_a}"/><stop offset="1" stop-color="{accent_b}"/></linearGradient>
<radialGradient id="pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{accent_a}" stop-opacity=".45"/><stop offset="1" stop-color="{accent_a}" stop-opacity="0"/></radialGradient>
<radialGradient id="pool2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{accent_b}" stop-opacity=".4"/><stop offset="1" stop-color="{accent_b}" stop-opacity="0"/></radialGradient>
{extra}
</defs>'''


def style(css):
    base = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'
    return f'<style>{css}{base}</style>'


def svg(body, css=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" '
            f'role="img" aria-hidden="true">{style(css)}{body}</svg>')


# --- perspective helpers ------------------------------------------------------------------
VP = (800, 330)
F = 620
CAM_H = 1.0


def proj(X, Z, Y=0.0):
    """World (X right, Y up from floor, Z forward) -> screen."""
    s = F / Z
    return VP[0] + X * s, VP[1] + (CAM_H - Y) * s


def poly(points, **attrs):
    a = ' '.join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y in points)
    return f'<polygon points="{pts}" {a}/>'


def garage_shell(ceiling=1.9, light_color='#c7d2fe', columns=True, light_rows=(-3.2, 0, 3.2)):
    out = [f'<rect width="{W}" height="{H}" fill="url(#sky)"/>']
    # floor
    out.append(poly([proj(-40, 1.2), proj(40, 1.2), proj(40, 60), proj(-40, 60)], fill='url(#floor)'))
    # ceiling slab
    out.append(poly([proj(-40, 1.2, ceiling), proj(40, 1.2, ceiling), proj(40, 60, ceiling), proj(-40, 60, ceiling)], fill='#060912'))
    # ceiling beams
    for z in [2, 3, 4.5, 6.5, 9.5, 14, 21, 32]:
        out.append(poly([proj(-40, z, ceiling), proj(40, z, ceiling), proj(40, z + .25, ceiling), proj(-40, z + .25, ceiling)], fill='#0d1426'))
    # linear light strips
    for x in light_rows:
        out.append(poly([proj(x - .07, 1.3, ceiling - .02), proj(x + .07, 1.3, ceiling - .02), proj(x + .07, 50, ceiling - .02), proj(x - .07, 50, ceiling - .02)],
                        fill=light_color, opacity='.85', filter='url(#glow)', **{'class': 'strip'}))
    # columns
    if columns:
        for z in [2.6, 4.2, 6.6, 10.4, 16.5]:
            for x in (-6.4, 6.0):
                x0, y0 = proj(x, z, ceiling)
                x1, y1 = proj(x + .5, z, 0)
                out.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" fill="#0c1222"/>')
                out.append(f'<rect x="{x0:.1f}" y="{y0 + (y1 - y0) * .55:.1f}" width="{x1 - x0:.1f}" height="{(y1 - y0) * .06:.1f}" fill="url(#accent)" opacity=".8"/>')
    return ''.join(out)


def bay_rows(rows, bay_w=2.7, n=13, occupancy=.72, tail='#ff3b5c', seed=1, free_glow='#34d399', reserved=None):
    """Rows of bays perpendicular to view; cars seen from the rear."""
    random.seed(seed)
    out = []
    for z_front, depth in rows:
        z_back = z_front + depth
        for i in range(n + 1):
            x = (i - n / 2) * bay_w
            out.append(f'<line x1="{proj(x, z_front)[0]:.1f}" y1="{proj(x, z_front)[1]:.1f}" x2="{proj(x, z_back)[0]:.1f}" y2="{proj(x, z_back)[1]:.1f}" stroke="#cbd5ff" stroke-opacity=".22" stroke-width="{max(.6, 2.4 / z_front):.2f}"/>')
        a, b = proj(-n / 2 * bay_w, z_back), proj(n / 2 * bay_w, z_back)
        out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#cbd5ff" stroke-opacity=".18" stroke-width="{max(.6, 2 / z_front):.2f}"/>')
        for i in range(n):
            cx = (i - n / 2 + .5) * bay_w
            zc = z_front + depth * .45
            sx, sy = proj(cx, zc)
            s = (F / zc) * 1.75 / 100
            r = random.random()
            if r < occupancy:
                out.append(car('rear', sx - 50 * s, sy - 57 * s, s, tail=tail))
            elif reserved and r < occupancy + .08:
                out.append(f'<ellipse cx="{sx:.1f}" cy="{sy - 2:.1f}" rx="{36 * s:.1f}" ry="{5 * s:.1f}" fill="{reserved}" opacity=".35" filter="url(#blur6)"/>')
            else:
                out.append(f'<ellipse class="free" cx="{sx:.1f}" cy="{sy - 2:.1f}" rx="{36 * s:.1f}" ry="{5 * s:.1f}" fill="{free_glow}" opacity=".35" filter="url(#blur6)" style="animation-delay:-{random.random() * 4:.1f}s"/>')
    return ''.join(out)


def floor_reflection():
    return poly([proj(-40, 1.2), proj(40, 1.2), proj(40, 6), proj(-40, 6)], fill='url(#accent)', opacity='.05')


COMMON_CSS = (
    '.strip{animation:flick 9s ease-in-out infinite}'
    '@keyframes flick{0%,100%{opacity:.85}50%{opacity:.7}}'
    '.free{animation:breathe 4s ease-in-out infinite}'
    '@keyframes breathe{0%,100%{opacity:.18}50%{opacity:.5}}'
)


def write(section, name, content):
    d = OUT / section
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(content, encoding='utf-8')
    # Static twin for reduced-motion users: same artwork, animation rules removed.
    static = re.sub(r'<style>.*?</style>', '<style>.free{opacity:.3}</style>', content, flags=re.S)
    (d / name.replace('.svg', '-static.svg')).write_text(static, encoding='utf-8')
    print(f'{section}/{name}: {len(content.encode()) / 1024:.1f} KB (+ static)')


# --- A. Login: cinematic underground garage --------------------------------------------
def login():
    random.seed(7)
    body = defs() + garage_shell(light_color='#c4b5fd', light_rows=(-4.6, -1.6, 1.6, 4.6))
    body += bay_rows([(2.9, 1.6), (5.2, 1.6), (8.4, 1.6), (13.5, 1.6)], occupancy=.68, seed=11)
    body += floor_reflection()
    # ambient light pools
    body += '<ellipse cx="1280" cy="360" rx="420" ry="200" fill="url(#pool2)"/><ellipse cx="300" cy="300" rx="380" ry="190" fill="url(#pool)"/>'
    # moving car along the drive aisle (z≈4.4), with headlight beam
    z = 4.35
    sx, sy = proj(0, z)
    s = (F / z) * 4.6 / 200
    body += (f'<g class="drive" style="transform-origin:{sx:.0f}px {sy:.0f}px">'
             f'<polygon points="{sx + 196 * s:.1f},{sy - 26 * s:.1f} {sx + 900:.1f},{sy - 120:.1f} {sx + 900:.1f},{sy + 40:.1f}" fill="url(#beam)" opacity=".5"/>'
             + car('side', sx - 100 * s, sy - 53 * s, s, body='#1a2240', head='#e0e7ff', rim='#6366f1') + '</g>')
    # floor reflection of the moving car's light
    body += f'<ellipse class="drive" cx="{sx + 60:.1f}" cy="{sy + 18:.1f}" rx="220" ry="10" fill="#a5b4fc" opacity=".18" filter="url(#blur6)"/>'
    css = COMMON_CSS + '.drive{animation:drive 26s cubic-bezier(.45,0,.55,1) infinite}@keyframes drive{0%{transform:translateX(-1300px)}45%,55%{transform:translateX(-80px)}100%{transform:translateX(1500px)}}'
    write('login', 'underground-garage.svg', svg(body, css))


# --- B. Driver: car approaching and settling into a bay ----------------------------------
def driver():
    random.seed(3)
    body = defs('#2563eb', '#7c3aed') + garage_shell(light_rows=(-2.4, 2.4))
    body += bay_rows([(3.4, 1.7), (6.4, 1.7), (11, 1.7)], occupancy=.64, seed=5, n=11)
    body += floor_reflection()
    body += '<ellipse cx="1220" cy="250" rx="420" ry="160" fill="url(#pool)"/>'
    # target bay highlight + car approaching it (rear view, moving away from camera into the bay)
    zt = 3.4 + 1.7 * .45
    tx, ty = proj(2.7 * .5, zt)
    st = (F / zt) * 1.75 / 100
    body += f'<rect class="target" x="{tx - 64 * st:.1f}" y="{ty - 10 * st:.1f}" width="{128 * st:.1f}" height="{12 * st:.1f}" rx="{6 * st:.1f}" fill="none" stroke="#818cf8" stroke-width="2" opacity=".8"/>'
    body += (f'<g class="park" style="transform-origin:{tx:.0f}px {ty:.0f}px">'
             + car('rear', tx - 50 * st, ty - 57 * st, st, body='#232c4a', tail='#ff4d6d') + '</g>')
    css = COMMON_CSS + ('.park{animation:park 14s cubic-bezier(.22,1,.36,1) infinite}'
                        '@keyframes park{0%{transform:translate(-120px,260px) scale(1.9);opacity:0}12%{opacity:1}55%,92%{transform:none;opacity:1}100%{transform:none;opacity:0}}'
                        '.target{animation:tgt 14s ease-in-out infinite}@keyframes tgt{0%,50%{stroke:#818cf8;opacity:.5}60%,92%{stroke:#34d399;opacity:1}100%{opacity:0}}')
    write('driver', 'parking-deck.svg', svg(body, css))


# --- C. Parking discovery: top-down smart lot -------------------------------------------
def parking():
    random.seed(21)
    out = [defs('#3b82f6', '#22d3ee'), '<rect width="1600" height="900" fill="#060a16"/>']
    out.append('<g opacity=".9">')
    bay_w, bay_h = 62, 112
    rows = [(80, 60), (80, 330), (80, 520), (80, 790)]
    for ri, (x0, y0) in enumerate(rows):
        flip = ri % 2 == 1
        for i in range(24):
            x = x0 + i * bay_w
            out.append(f'<rect x="{x}" y="{y0 - (bay_h if flip else 0)}" width="{bay_w}" height="{bay_h}" fill="none" stroke="#cbd5ff" stroke-opacity=".14"/>')
            r = random.random()
            cy = y0 - bay_h + 10 if flip else y0 + 10
            if r < .66:
                out.append(car('top', x + 8, cy, 1, body=random.choice(BODY_COLORS), head='#dbe4ff', tail='#ff3b5c'))
            elif r < .74:
                out.append(f'<rect x="{x + 6}" y="{cy}" width="{bay_w - 12}" height="{bay_h - 20}" rx="8" fill="#a78bfa" opacity=".16"/>')
            else:
                out.append(f'<rect class="free" x="{x + 6}" y="{cy}" width="{bay_w - 12}" height="{bay_h - 20}" rx="8" fill="#34d399" opacity=".18" style="animation-delay:-{random.random() * 4:.1f}s"/>')
                out.append(f'<circle cx="{x + bay_w / 2}" cy="{cy + (bay_h - 20) / 2}" r="3" fill="#34d399"/>')
    out.append('</g>')
    # driving lanes with arrows
    for y in (230, 655):
        out.append(f'<line x1="0" y1="{y}" x2="1600" y2="{y}" stroke="#e2e8ff" stroke-opacity=".12" stroke-width="2" stroke-dasharray="26 22"/>')
    # route trail + moving car (top view, rotated to drive along lane)
    out.append('<path id="lane" d="M-60 255 H1660" fill="none"/>')
    out.append('<g class="cruise">' + car('top', 0, 0, .9, body='#2b3a6e', head='#ffffff', tail='#ff4d6d', extra=' ') + '</g>')
    out.append('<rect class="scan" x="0" y="0" width="1600" height="900" fill="url(#accent)" opacity="0"/>')
    out.append('<ellipse cx="1200" cy="450" rx="520" ry="300" fill="url(#pool)" opacity=".6"/>')
    css = ('.free{animation:breathe 4s ease-in-out infinite}@keyframes breathe{0%,100%{opacity:.1}50%{opacity:.32}}'
           '.cruise{animation:cruise 22s linear infinite}@keyframes cruise{0%{transform:translate(-120px,300px) rotate(90deg)}100%{transform:translate(1720px,300px) rotate(90deg)}}')
    write('parking', 'smart-lot-topdown.svg', svg(''.join(out), css))


# --- D. Owner: multi-storey facility cross-section ---------------------------------------
def owner():
    random.seed(4)
    out = [defs('#2563eb', '#a855f7'), '<rect width="1600" height="900" fill="url(#sky)"/>']
    out.append('<ellipse cx="800" cy="840" rx="900" ry="120" fill="url(#pool)" opacity=".5"/>')
    x0, x1 = 160, 1440
    levels = [200, 360, 520, 680]
    out.append(f'<rect x="{x0}" y="150" width="{x1 - x0}" height="690" fill="#080d1b" stroke="#2b3450" stroke-width="1.5"/>')
    for li, y in enumerate(levels):
        out.append(f'<rect x="{x0}" y="{y + 130}" width="{x1 - x0}" height="14" fill="#141c33"/>')
        out.append(f'<rect class="strip" x="{x0 + 20}" y="{y - 40}" width="{x1 - x0 - 40}" height="3" fill="#c7d2fe" opacity=".7" filter="url(#glow)" style="animation-delay:-{li * 2}s"/>')
        for i in range(9):
            cx = x0 + 70 + i * 135
            out.append(f'<line x1="{cx - 12}" y1="{y + 70}" x2="{cx - 12}" y2="{y + 130}" stroke="#cbd5ff" stroke-opacity=".15"/>')
            if random.random() < .7:
                out.append(car('side', cx, y + 74, .52, body=random.choice(BODY_COLORS), rim='#3b4366'))
            else:
                out.append(f'<rect class="free" x="{cx + 6}" y="{y + 122}" width="96" height="6" rx="3" fill="#34d399" opacity=".5"/>')
        # sensor nodes
        out.append(f'<circle class="node" cx="{x1 - 30}" cy="{y + 20}" r="4" fill="#818cf8" style="animation-delay:-{li}s"/>')
    # elevator / core with data line
    out.append(f'<rect x="{x0 - 70}" y="150" width="70" height="690" fill="#0b1224" stroke="#2b3450"/>')
    out.append(f'<rect class="lift" x="{x0 - 60}" y="680" width="50" height="80" rx="6" fill="url(#accent)" opacity=".55"/>')
    out.append(f'<line x1="{x1 + 40}" y1="150" x2="{x1 + 40}" y2="840" stroke="url(#accent)" stroke-width="2" stroke-dasharray="4 10" class="data"/>')
    css = (COMMON_CSS + '.node{animation:node 3s ease-in-out infinite}@keyframes node{0%,100%{opacity:.3}50%{opacity:1}}'
           '.lift{animation:lift 16s ease-in-out infinite}@keyframes lift{0%,100%{transform:translateY(0)}45%,55%{transform:translateY(-480px)}}'
           '.data{animation:data 6s linear infinite}@keyframes data{to{stroke-dashoffset:-140}}')
    write('owner', 'facility-infrastructure.svg', svg(''.join(out), css))


# --- E. Gate access: automated entrance -------------------------------------------------
def gate():
    out = [defs('#3b82f6', '#8b5cf6'), '<rect width="1600" height="900" fill="url(#sky)"/>']
    out.append('<rect x="0" y="640" width="1600" height="260" fill="#070b16"/>')
    out.append('<rect x="0" y="636" width="1600" height="4" fill="#1b2440"/>')
    for i in range(16):
        out.append(f'<rect x="{i * 110 + 20}" y="760" width="60" height="6" rx="3" fill="#e2e8ff" opacity=".12"/>')
    # canopy
    out.append('<path d="M640 180H1500L1540 214H600Z" fill="#0d1428" stroke="#2b3450"/>')
    out.append('<rect class="strip" x="650" y="214" width="880" height="3" fill="#c7d2fe" opacity=".8" filter="url(#glow)"/>')
    out.append('<text x="1070" y="206" fill="#a5b4fc" font-family="Segoe UI, sans-serif" font-size="18" letter-spacing="8" text-anchor="middle" opacity=".7">ENTRY</text>')
    # booth + ANPR camera + barrier
    out.append('<rect x="980" y="430" width="110" height="210" rx="10" fill="#0e1630" stroke="#2f3a5c"/>')
    out.append('<rect x="996" y="452" width="78" height="56" rx="6" fill="url(#accent)" opacity=".35"/>')
    out.append('<circle class="node" cx="1035" cy="540" r="7" fill="#34d399"/>')
    out.append('<rect x="1020" y="300" width="14" height="140" fill="#1a2340"/><rect x="990" y="290" width="70" height="26" rx="6" fill="#141c36"/>')
    out.append('<polygon class="scan" points="996,306 760,560 900,600" fill="#818cf8" opacity=".14"/>')
    out.append('<g class="arm" style="transform-origin:1000px 560px"><rect x="560" y="552" width="440" height="16" rx="8" fill="#e2e8f0"/>'
               + ''.join(f'<rect x="{580 + k * 70}" y="552" width="34" height="16" fill="#ef4444"/>' for k in range(6)) + '</g>')
    out.append('<circle cx="1000" cy="560" r="16" fill="#1a2340"/>')
    # vehicle approaching and passing
    out.append('<g class="enter"><polygon points="560,590 1100,520 1100,680" fill="url(#beam)" opacity=".45"/>'
               + car('side', 0, 0, 2.6, body='#1f2a50', head='#eef2ff', rim='#6366f1').replace('<g transform="translate(0.0 0.0)', '<g transform="translate(-60 470)') + '</g>')
    out.append('<ellipse cx="700" cy="700" rx="600" ry="70" fill="url(#pool)" opacity=".5"/>')
    css = (COMMON_CSS +
           '.enter{animation:enter 12s cubic-bezier(.45,0,.55,1) infinite}'
           '@keyframes enter{0%{transform:translateX(-700px)}30%,50%{transform:translateX(0)}85%,100%{transform:translateX(1900px)}}'
           '.arm{animation:arm 12s ease-in-out infinite}@keyframes arm{0%,34%{transform:rotate(0)}42%,72%{transform:rotate(78deg)}82%,100%{transform:rotate(0)}}'
           '.scan{animation:scan 12s ease-in-out infinite}@keyframes scan{0%,24%{opacity:0}28%,36%{opacity:.3}40%,100%{opacity:0}}'
           '.node{animation:node 12s steps(1) infinite}@keyframes node{0%,36%{fill:#f59e0b}37%,80%{fill:#34d399}81%,100%{fill:#f59e0b}}')
    write('gate', 'automated-entrance.svg', svg(''.join(out), css))


# --- F. Admin: mobility control room ----------------------------------------------------
def admin():
    random.seed(9)
    out = [defs('#2563eb', '#8b5cf6'), '<rect width="1600" height="900" fill="#04060d"/>']
    out.append('<ellipse cx="800" cy="380" rx="900" ry="360" fill="url(#pool)" opacity=".35"/>')
    # curved video wall
    screens = []
    for row in range(3):
        for col in range(7):
            x = 120 + col * 196
            y = 120 + row * 128 + abs(col - 3) * 10
            screens.append((x, y))
            out.append(f'<rect x="{x}" y="{y}" width="184" height="116" rx="6" fill="#0a1020" stroke="#26304d"/>')
            kind = (row * 7 + col) % 4
            if kind == 0:  # occupancy grid
                for gy in range(4):
                    for gx in range(8):
                        c = random.choice(['#34d399', '#fb7185', '#fb7185', '#a78bfa', '#34d399'])
                        out.append(f'<rect x="{x + 12 + gx * 20}" y="{y + 14 + gy * 24}" width="14" height="18" rx="2" fill="{c}" opacity=".55"/>')
            elif kind == 1:  # line chart
                pts = ' '.join(f'{x + 10 + i * 16},{y + 90 - random.randint(10, 70)}' for i in range(11))
                out.append(f'<polyline class="trace" points="{pts}" fill="none" stroke="#818cf8" stroke-width="2" pathLength="1" stroke-dasharray="1" style="animation-delay:-{random.random() * 6:.1f}s"/>')
            elif kind == 2:  # bars
                for i in range(8):
                    h = random.randint(16, 80)
                    out.append(f'<rect class="bar" x="{x + 14 + i * 20}" y="{y + 100 - h}" width="12" height="{h}" rx="2" fill="url(#accent)" opacity=".7" style="transform-origin:{x + 20 + i * 20}px {y + 100}px;animation-delay:-{i * .3:.1f}s"/>')
            else:  # map
                out.append(f'<path d="M{x + 10} {y + 80}C{x + 60} {y + 20} {x + 120} {y + 100} {x + 174} {y + 30}" fill="none" stroke="#3b82f6" stroke-width="2" opacity=".6"/>')
                for _ in range(5):
                    out.append(f'<circle class="node" cx="{x + random.randint(20, 165)}" cy="{y + random.randint(20, 100)}" r="4" fill="#34d399" style="animation-delay:-{random.random() * 3:.1f}s"/>')
    # console desk + operators silhouettes
    out.append('<path d="M0 760C300 690 1300 690 1600 760V900H0Z" fill="#0a0f1e"/>')
    out.append('<path d="M120 742C420 684 1180 684 1480 742" fill="none" stroke="url(#accent)" stroke-width="3" opacity=".7" filter="url(#glow)"/>')
    for x in (430, 800, 1170):
        out.append(f'<circle cx="{x}" cy="660" r="26" fill="#05070d"/><path d="M{x - 52} 760C{x - 50} 700 {x + 50} 700 {x + 52} 760Z" fill="#05070d"/>')
    css = ('.trace{animation:trace 6s ease-in-out infinite}@keyframes trace{0%{stroke-dashoffset:1}50%,100%{stroke-dashoffset:0}}'
           '.bar{animation:bar 5s ease-in-out infinite alternate}@keyframes bar{from{transform:scaleY(.6)}to{transform:scaleY(1)}}'
           '.node{animation:node 3s ease-in-out infinite}@keyframes node{0%,100%{opacity:.3}50%{opacity:1}}')
    write('admin', 'mobility-control-room.svg', svg(''.join(out), css))


# --- Operator: monitored deck with sensor/camera coverage -------------------------------
def operator():
    random.seed(13)
    body = defs('#0ea5e9', '#8b5cf6') + garage_shell(light_rows=(-2.8, 2.8))
    body += bay_rows([(3.0, 1.6), (5.6, 1.6), (9.2, 1.6)], occupancy=.75, seed=17, n=11, reserved='#a78bfa')
    for x, z in ((-5.2, 3.2), (5.0, 5.4)):
        cx, cy = proj(x, z, 1.75)
        fx, fy = proj(x * .1, z + 2.5)
        body += f'<rect x="{cx - 14:.1f}" y="{cy - 6:.1f}" width="28" height="12" rx="4" fill="#1b2442"/>'
        body += f'<polygon class="cone" points="{cx:.1f},{cy:.1f} {fx - 260:.1f},{fy:.1f} {fx + 260:.1f},{fy:.1f}" fill="#38bdf8" opacity=".08"/>'
    body += '<rect class="sweep" x="0" y="420" width="1600" height="2" fill="#38bdf8" opacity=".35" filter="url(#glow)"/>'
    css = COMMON_CSS + ('.cone{animation:cone 7s ease-in-out infinite alternate}@keyframes cone{from{opacity:.05}to{opacity:.13}}'
                        '.sweep{animation:sweep 9s linear infinite}@keyframes sweep{0%{transform:translateY(0);opacity:0}10%{opacity:.35}90%{opacity:.35}100%{transform:translateY(470px);opacity:0}}')
    write('operator', 'monitored-deck.svg', svg(body, css))


# --- G. EV charging hub ------------------------------------------------------------------
def ev():
    random.seed(5)
    out = [defs('#22d3ee', '#3b82f6'), '<rect width="1600" height="900" fill="url(#sky)"/>']
    out.append('<rect x="0" y="600" width="1600" height="300" fill="#070b16"/>')
    out.append('<path d="M80 150H1520L1560 190H40Z" fill="#0c1428" stroke="#26304d"/>')
    out.append('<rect class="strip" x="60" y="190" width="1480" height="3" fill="#a5f3fc" opacity=".8" filter="url(#glow)"/>')
    for i in range(5):
        x = 140 + i * 290
        # charger pillar
        out.append(f'<rect x="{x}" y="360" width="56" height="250" rx="12" fill="#101a33" stroke="#2a3a62"/>')
        out.append(f'<rect x="{x + 10}" y="384" width="36" height="52" rx="6" fill="#0a1226"/>')
        out.append(f'<rect class="lvl" x="{x + 14}" y="388" width="28" height="44" rx="4" fill="url(#accent)" style="transform-origin:{x + 28}px 432px;animation-delay:-{i * 1.3:.1f}s"/>')
        out.append(f'<path d="M{x + 31} 396L{x + 23} 412H{x + 30}L{x + 26} 426L{x + 36} 408H{x + 29}Z" fill="#ffffff" opacity=".9"/>')
        out.append(f'<rect x="{x + 6}" y="600" width="44" height="10" rx="3" fill="#22d3ee" opacity=".5" filter="url(#glow)"/>')
        # cable + car
        out.append(f'<path d="M{x + 56} 470C{x + 110} 470 {x + 110} 560 {x + 150} 560" fill="none" stroke="#1e293b" stroke-width="7" stroke-linecap="round"/>')
        out.append(f'<path class="flow" d="M{x + 56} 470C{x + 110} 470 {x + 110} 560 {x + 150} 560" fill="none" stroke="#67e8f9" stroke-width="2" stroke-dasharray="4 14" style="animation-delay:-{i * .4:.1f}s"/>')
        out.append(car('side', x + 70, 510, 1.15, body=random.choice(BODY_COLORS), rim='#22d3ee', head='#e0f2fe'))
        out.append(f'<rect x="{x - 10}" y="680" width="250" height="4" rx="2" fill="#22d3ee" opacity=".25"/>')
    out.append('<ellipse cx="800" cy="640" rx="900" ry="90" fill="url(#pool)" opacity=".45"/>')
    css = (COMMON_CSS + '.lvl{animation:lvl 6s ease-in-out infinite}@keyframes lvl{0%{transform:scaleY(.15)}85%{transform:scaleY(1)}100%{transform:scaleY(1);opacity:.6}}'
           '.flow{animation:flow 1.4s linear infinite}@keyframes flow{to{stroke-dashoffset:-18}}')
    write('ev-charging', 'ev-charging-hub.svg', svg(''.join(out), css))


if __name__ == '__main__':
    for fn in (login, driver, parking, owner, gate, admin, operator, ev):
        fn()
