import { createWorld, step, validateDesign } from './sim.js';
let world = createWorld();
const keys = {};
addEventListener('keydown', e => keys[e.key] = true);
addEventListener('keyup', e => keys[e.key] = false);
const root = document.getElementById('root'), canvas = document.getElementById('view'), ctx = canvas.getContext('2d');
function draw() { ctx.clearRect(0, 0, 800, 520); ctx.fillStyle = '#050914'; ctx.fillRect(0, 0, 800, 520); const ship = world.ship; ctx.save(); ctx.translate(ship.pos.x, ship.pos.y); ctx.rotate(ship.angle); for (const l of ship.links.filter(l => l.type === 'structural')) {
    const a = ship.components.find(c => c.id === l.from), b = ship.components.find(c => c.id === l.to);
    ctx.strokeStyle = l.integrity > .5 ? '#4b86b4' : '#d95d39';
    ctx.beginPath();
    ctx.moveTo(a.pos.x, a.pos.y);
    ctx.lineTo(b.pos.x, b.pos.y);
    ctx.stroke();
} for (const comp of ship.components) {
    ctx.fillStyle = comp.type === 'armor' ? '#777' : comp.type === 'engine' || comp.type === 'thruster' ? '#d9822b' : comp.type === 'tank' ? '#2f9e44' : comp.type === 'cannon' ? '#adb5bd' : '#4dabf7';
    ctx.globalAlpha = .35 + .65 * comp.integrity;
    ctx.beginPath();
    ctx.arc(comp.pos.x, comp.pos.y, comp.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '8px sans-serif';
    ctx.fillText(comp.id, comp.pos.x - comp.radius, comp.pos.y);
} ctx.restore(); ctx.globalAlpha = 1; for (const p of world.parcels) {
    ctx.fillStyle = p.kind === 'gas' ? '#ff922b' : p.kind === 'shell' ? '#f8f9fa' : p.kind === 'mineral' ? '#94d82d' : '#868e96';
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
} }
function res(id, k) { return world.ship.components.find(c => c.id === id)?.resources?.[k] ?? 0; }
function hud() { const val = validateDesign(world.ship); root.innerHTML = `<main><section><h1>Mammoth Space Battles</h1><p>Vertical slice: build, launch, thrust, rotate, fire, fragment, scoop, manufacture, and repair through conserved physical state.</p><p class="controls">Controls: ↑/W thrust · ←/A & →/D turn · Space fire · S scoop · M manufacture shell · R repair</p></section><aside><h2>Ship diagnostics</h2><dl><dt>Mass</dt><dd>${world.ship.mass.toFixed(1)}</dd><dt>Velocity</dt><dd>${Math.hypot(world.ship.vel.x, world.ship.vel.y).toFixed(2)}</dd><dt>Angular velocity</dt><dd>${world.ship.angVel.toFixed(3)}</dd><dt>Fuel / Oxidizer</dt><dd>${res('fuel', 'fuel').toFixed(1)} / ${res('oxidizer', 'oxidizer').toFixed(1)}</dd><dt>Metal / Minerals / Shells</dt><dd>${res('metal', 'metal').toFixed(1)} / ${res('metal', 'minerals').toFixed(1)} / ${res('ammo', 'shells')}</dd><dt>Validation</dt><dd>${val.launchBlocked ? 'Blocked' : 'Launch-ready'} ${val.errors.join(', ')}</dd></dl><h2>Event log</h2><ol>${world.log.slice(-8).map(l => `<li>${l}</li>`).join('')}</ol></aside></main>`; }
setInterval(() => { step(world, { forward: keys.ArrowUp || keys.w, left: keys.ArrowLeft || keys.a, right: keys.ArrowRight || keys.d, fire: keys[' '], scoop: keys.s, repair: keys.r, manufacture: keys.m }); draw(); hud(); }, 16);
