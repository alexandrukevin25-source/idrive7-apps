'use strict';
/**
 * EV Range Cluster - the electric range and the charge on the instrument cluster.
 *
 * Draws two layers on cluster-render's "panel" target (a separate Store tool, PROTOCOL.md):
 *   - a gauge that imitates the coolant gauge of the M theme (double arc, M tricolour, red glow), filled to the charge
 *   - the text "37km/82%"
 * The charge is read from the car itself (UDS 0x22, as eDrive does) and the range is calculated the
 * way eDrive does it (ev.js): learned from this car's driving, outside temperature and climate taken into
 * account, only the charge above the one where the engine starts counts. No eDrive needed.
 *
 * The app's own screen shows whether the renderer and the data are there; the settings
 * move and resize the widget and turn its parts on and off.
 */
const fs = require('fs');
const net = require('net');
const mgu = require('./kit/mgu');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./kit/dids');
const G = require('./kit/gauges');
const Wd = require('./widget');

const SOCKET = '/dev/shm/cluster-render/render.sock';
const W = 1600, H = 520;
const GO = '#2fd27a';

const SLOTS = { '0x203': 'panel', '0x203top': 'panel', '0x201': 'panel201', '0x202': 'panel202', 'map': 'map' };

const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };

/** cluster-render client: JSON frames over the unix socket, reconnects, re-sends its layers */
class Cluster {
    constructor(log, onUp) {
        this.log = log; this.onUp = onUp;
        this.up = false; this.err = ''; this.event = ''; this.sock = null; this.timer = null;
        this.tg = {}; this.ly = {};      // the latest 'target' and 'layer' events (state, holder, reason)
    }
    start() { this.connect(); }
    stop() { if (this.timer) clearTimeout(this.timer); if (this.sock) this.sock.destroy(); }
    connect() {
        let buf = Buffer.alloc(0);
        let sock;
        try { sock = net.createConnection(SOCKET); } catch (e) { this.err = String(e.message || e); this.retry(); return; }
        this.sock = sock;
        sock.on('connect', () => { this.up = true; this.err = ''; this.log.info('cluster-render: connected'); this.onUp(); });
        sock.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 4) {
                const len = buf.readUInt32LE(0);
                if (buf.length < 4 + len) break;
                if (buf[4] === 0x4A) {
                    const text = buf.slice(5, 4 + len).toString('utf8');
                    this.event = text;
                    try {
                        const o = JSON.parse(text);
                        if (o.ev === 'target' && o.target) this.tg[o.target] = o;
                        else if (o.ev === 'layer' && o.ref) this.ly[o.ref] = o;
                    } catch (e) { /* not JSON: ignore */ }
                    if (/error|refused|fail/i.test(text)) this.log.warn('cluster-render: ' + text);
                }
                buf = buf.slice(4 + len);
            }
        });
        sock.on('error', (e) => { this.err = e.code || String(e.message || e); });
        sock.on('close', () => { this.up = false; this.retry(); });
    }
    retry() { this.timer = setTimeout(() => this.connect(), 3000); }
    send(obj) {
        if (!this.up) return;
        const body = Buffer.from(JSON.stringify(obj), 'utf8');
        const head = Buffer.alloc(5);
        head.writeUInt32LE(body.length + 1, 0);
        head.writeUInt8(0x4A, 4);
        this.sock.write(Buffer.concat([head, body]));
    }
}

mgu.run({
    async start(ctx) {
        const { settings, log } = ctx;
        const targetName = () => SLOTS[settings.get('clusterSlot')] || 'panel';
        const REF_T = 1, REF_G = 2;
        // the map slot, and the whole-cluster slot in its "on top" variant, ask to win over what else is drawn there (e.g. the Waze map)
        const top = () => targetName() === 'map' || settings.get('clusterSlot') === '0x203top';

        /* ---------- the data: the charge, read from the car itself (UDS over the head unit's diagnostic link) ---------- */
        const cfg = Object.assign({ ecu: 7, soc: [], soh: [] }, (ctx.spec.config && ctx.spec.config.battery) || {});
        let ev = null;                         // the range, calculated as eDrive does it (ev.js): made when the app runs
        let drive = null;                      // the driving mode (drive.js)
        const diag = new Diag(ctx.signals, log);
        diag.quiet = true;
        const reader = new DidReader(diag, { ecu: cfg.ecu });
        let socT = 0, socNow = null, busy = false, sohFailT = 0;
        const data = { km: null, pct: null, fresh: false, test: false, why: 'starting', raw: null };
        const isNum = (v) => typeof v === 'number' && isFinite(v);
        const maxAge = () => Math.max(60, settings.get('poll') * 4) * 1000;

        async function pollSoc() {
            if (busy || !diag.available) return;
            busy = true;
            try {
                const v = await reader.value('soc', cfg.soc);
                if (isNum(v) && v >= 0 && v <= 100) { socNow = v; socT = Date.now(); if (ev) ev.onSoc(v, socT); }
                // battery health (it scales the energy per %): read once a week, a failed read again after an hour
                if (ev && socT && ev.sohDue(7) && Date.now() - sohFailT > 3600000) {
                    const h = await reader.value('soh', cfg.soh);
                    if (isNum(h) && h >= 40 && h <= 110) ev.setSoh(h); else sohFailT = Date.now();
                }
            } catch (e) { log.warn('soc: ' + (e && e.message || e)); }
            busy = false;
            readData(); apply(false);
        }
                
                function readData() {
            if (settings.get('testValues')) {
                Object.assign(data, { km: 37, pct: 60, fresh: true, test: true, why: 'test values', raw: null });
                return;
            }
            data.test = false;
            data.raw = { soc: socNow };
            data.fresh = socT > 0 && Date.now() - socT < maxAge();
            if (!data.fresh) {
                data.km = null; data.pct = null;
                data.why = !diag.available ? 'no diagnostic link to the car yet' : socT ? 'charge reading is old' : 'waiting for the first charge reading';
                return;
            }
            data.pct = Math.round(socNow);
            data.km = ev ? ev.rangeKm(socNow) : null;
            data.why = 'ok';
        }

        /* ---------- the layers ---------- */
        let sentGeom = '', sentVals = '';
        const shown = () => !!settings.get('enabled');
        // a hidden layer never asks for the slot, so with no data the stock cluster stays untouched
        // the driving modes it is shown in (Settings): unknown mode (no signal yet) counts as "other"
        const modeOn = () => !!settings.get(drive && drive.key ? drive.key : 'modeOther');
        const wanted = (part) => shown() && settings.get(part) && modeOn() && (data.fresh || data.test);
        function geom() {
            return Wd.geometry(settings.get('dx'), settings.get('dy'), settings.get('size'),
                settings.get('tdx'), settings.get('tdy'), settings.get('tsize'), targetName() === 'map' ? 'map' : 'panel');
        }
        const right = () => (settings.get('textAlign') === 'left' ? 0 : 1);

        function createLayers() {
            sentGeom = ''; sentVals = '';
            cluster.send({ op: 'hello', app: 'alexk_evrange', proto: 1 });
            const g = geom();
            cluster.send(Object.assign({ op: 'layer', ref: REF_T, target: targetName(), kind: 'effect', class: 'overlay', contend: top() ? 1 : 0, z: top() ? 200 : 0,
                visible: wanted('showText') ? 1 : 0, fs: Wd.TEXT_FS }, g.text));
            cluster.send(Object.assign({ op: 'layer', ref: REF_G, target: targetName(), kind: 'effect', class: 'overlay', contend: top() ? 1 : 0, z: top() ? 200 : 0,
                visible: wanted('showGauge') ? 1 : 0, fs: Wd.GAUGE_FS }, g.gauge));
            apply(true);
        }

        function apply(force) {
            if (!cluster.up) return;
            const g = geom();
            const vt = wanted('showText') ? 1 : 0, vg = wanted('showGauge') ? 1 : 0;
            const th = Wd.themeColors(settings.get('theme'));
            const gk = JSON.stringify([g, vt, vg, right(), th]);
            if (force || gk !== sentGeom) {
                cluster.send(Object.assign({ op: 'set', ref: REF_T, visible: vt }, g.text));
                cluster.send(Object.assign({ op: 'set', ref: REF_G, visible: vg }, g.gauge));
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_aspect', v: String(g.text.w / g.text.h) });
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_px', v: String(1 / g.text.h) });
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_right', v: String(right()) });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_aspect', v: String(g.gauge.w / g.gauge.h) });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_px', v: String(1 / g.gauge.h) });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_ca', v: th[0] });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_cb', v: th[1] });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_cc', v: th[2] });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_cm', v: th[3] });
                sentGeom = gk;
            }
            const km = Wd.digitsOf(data.km, 999), pc = Wd.digitsOf(data.pct, 100);
            const pos = data.pct === null ? -1 : Wd.chargeToS(Math.max(0, Math.min(1, data.pct / 100)));
            const vk = km + '|' + pc + '|' + pos.toFixed(4);
            if (force || vk !== sentVals) {
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_km', v: km });
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_pc', v: pc });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_s', v: String(pos) });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_f', v: String(data.pct === null ? 0 : Math.max(0, Math.min(1, data.pct / 100))) });
                sentVals = vk;
            }
        }

        let cluster = new Cluster(log, createLayers);
        readData();

        /* ---------- start: with the car, or only when switched on in Settings ----------
         * The app itself is started by the head unit (startType autostart). "Start with the car" off: it then
         * does nothing - no car signals, no diagnostic reads, nothing on the cluster - until it is switched
         * on in Settings. */
        let running = false;
        function begin() {
            if (running) return;
            running = true;
            ev = require('./ev')(ctx);
            drive = require('./drive').watchDriveMode(ctx, () => { apply(false); });
            diag.init();
            diag.on('available', (up) => { if (up) pollSoc(); });
            (function schedule() { setTimeout(() => { pollSoc().then(schedule); }, settings.get('poll') * 1000); })();
            cluster.start();
            setInterval(() => { readData(); apply(false); }, 1000);
            setTimeout(pollSoc, 2000);
        }
        if (settings.get('autoRun')) begin();
        settings.onChange((k) => {
            if (k === 'autoRun') { if (settings.get('autoRun')) begin(); return; }   // off: takes effect at the next start
            if (k === 'clusterSlot' && running) { cluster.stop(); cluster = new Cluster(log, createLayers); cluster.start(); return; }
            readData(); apply(false);
        });

        /* ---------- the screen ---------- */
        ctx.loop('MAIN', 4, () => {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            G.frame(cv, t, ['EV range'], 0, [data.test && { text: 'TEST VALUES' }]);
            const row = (y, label, value, color) => {
                cv.text(label, 80, y, 30, t.dim, { font: 'label' });
                cv.text(value, 520, y, 34, color, { font: 'bold' });
            };
            const i = ev ? ev.info(data.pct) : null;
            if (!i) {
                row(120, 'Start with the car', 'Off: switch it on in Settings to start', t.warn);
                row(162, 'Now', 'Idle: nothing is read and nothing is shown on the cluster', t.dim);
                cv.text('Settings: Start with the car, driving modes, range and position.', 80, 480, 28, t.dim, { font: 'label' });
                return ctx.ui.image('MAIN_GFX', cv);
            }
            row(120, 'Cluster renderer', cluster.up ? 'Connected' : 'Not found: install cluster-render from the Store',
                cluster.up ? GO : t.warn);
            const good = data.why === 'ok' || data.test;
            row(162, 'Car data', good ? data.km + ' km  /  ' + data.pct + ' %' : data.why, good ? GO : t.warn);
            const cl = i.climate === 'ac' ? 'A/C on' : i.climate ? 'climate on' : i.climate === false ? 'climate off' : 'climate ?';
            row(204, 'Reading', (isNum(i.ambient) ? i.ambient.toFixed(1) + ' C' : '-- C') + '   ' + cl
                + (isNum(i.soh) ? '   health ' + Math.round(i.soh) + ' %' : ''), t.dim);
            row(246, 'Engine starts at', i.reserve + ' %  ' + (i.reserveAuto ? '(auto, ' + i.starts + ' starts seen)' : '(set)'), t.text);
            row(288, 'Range model', i.learned ? 'learned: ' + i.kpp.toFixed(2) + ' km per %   pace ' + Math.round(i.pace) + ' km/h'
                : 'not learned yet: from the temperature curve', i.learned ? GO : t.dim);
            const dm = drive && drive.label;
            row(330, 'Driving mode', dm ? dm + (modeOn() ? '  (shown)' : '  (hidden)') : (drive && drive.raw ? 'not recognised: ' + drive.raw.slice(0, 48) : 'waiting for the car'),
                dm ? (modeOn() ? GO : t.dim) : t.dim);
            const g = geom();
            const tg = cluster.tg[targetName()];
            row(372, 'Slot', targetName() + ' (' + settings.get('clusterSlot') + ')'
                + (tg ? '  ' + tg.state + (tg.holder ? ', held by ' + tg.holder : '') + (tg.reason ? ' (' + tg.reason + ')' : '') : ''), t.dim);
            const ly = cluster.ly[REF_G];
            row(414, 'Widget', shown() ? 'At ' + g.gauge.x + ', ' + g.gauge.y + (ly ? '  ' + ly.state + (ly.reason ? ' (' + ly.reason + ')' : '') : '') : 'Hidden (see Settings)',
                shown() ? t.text : t.dim);
            if (cluster.event) row(456, 'Renderer says', String(cluster.event).slice(0, 70), t.dim);
            if (!cluster.up && cluster.err) row(456, 'Socket', String(cluster.err), t.dim);
            cv.text('Settings: move, resize and turn parts on and off. Use Show test values to place it.',
                80, 500, 26, t.dim, { font: 'label' });
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
