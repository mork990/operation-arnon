// The commander's personal gear in this mission: empty hands (orders, tablet) or binoculars. No weapon: the commander
// does not shoot here, every action goes through the units.
import { G, bus } from '../core.js';
import { Input } from '../player.js';

const $ = id => document.getElementById(id);

export class Gear {
  constructor() {
    this.mode = null; this.bino = false; this.hideRifle = true; this.eyeGas = 0;
    bus.on('key', k => { if (G.state !== 'play' || (G.tablet && G.tablet.open)) return; if (k === 'KeyV') this.set(this.mode === 'bino' ? 'cmd' : 'bino'); if (k === 'KeyQ') this.set('cmd'); });
    document.querySelectorAll('#gearbar button').forEach(b => { const go = e => { e.preventDefault(); e.stopPropagation(); this.set(b.dataset.gear === this.mode ? 'cmd' : b.dataset.gear); }; b.addEventListener('click', go); b.addEventListener('touchstart', go, { passive: false }); });
    this.set('cmd', true);
  }
  set(mode, silent = false) {
    if (this.mode === mode) return; this.mode = mode; this.bino = mode === 'bino';
    document.querySelectorAll('#gearbar button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gear === mode)));
    document.body.classList.add('cmdmode'); G.freeCursor = true;
    if (this.bino) G.player.fovBase = 9.5; else G.player.fovBase = G.fovBase0 || 54;
    if (!silent) { $('wname').textContent = this.bino ? 'משקפת 7x' : ''; G.audio.playS(this.bino ? 'cloth' : 'gear', { vol: .5 }); }
  }
  pre() { this.fireReq = Input.fire; Input.fire = false; Input.reloadReq = false; Input.ads = false; Input.adsToggle = false; }
  hud() { if (this.bino) { $('ammo').textContent = '7x'; $('res').textContent = ''; } const cr = $('cross'); cr.style.opacity = this.bino ? 0 : .35; }
  update() {}
}
