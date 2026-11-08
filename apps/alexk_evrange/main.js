'use strict';
/**
 * EV Range Cluster - the electric range and the charge on the instrument cluster.
 *
 * Draws two layers on cluster-render's "panel" target (a separate Store tool, PROTOCOL.md):
 *   - a gauge band that imitates the original eDrive indicator, filled to the charge
 *   - the text "37km/82%"
 * The numbers come from the eDrive app (idrive7-apps), which writes /tmp/mgu-edrive.json
 * four times a second: { t, kw, soc, rangeKm }. This app only reads it.
 *
 * The app's own screen shows whether the renderer and the data are there; the settings
 * move and resize the widget and turn its parts on and off.
 */
const fs = require('fs');
const net = require('net');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const Wd = require('./widget');

const SOCKET = '/dev/shm/cluster-render/render.sock';
const EDRIVE_FILE = '/tmp/mgu-edrive.json';
const STALE_MS = 5000;
const W = 1600, H = 520;
const GO = '#2fd27a';

const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };

/** cluster-render client: JSON frames over the unix socket, reconnects, re-sends its layers */
class Cluster {
    constructor(log, onUp) {
        this.log = log; this.onUp = onUp;
        this.up = false; this.err = ''; this.event = ''; this.sock = null; this.timer = null;
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
        const REF_T = 1, REF_G = 2;

        /* ---------- the data (read, never written) ---------- */
        let lastT = null, changedAt = 0;
        const data = { km: null, pct: null, fresh: false, test: false, why: 'starting', raw: null };
        const isNum = (v) => typeof v === 'number' && isFinite(v);
        function readData() {
            if (settings.get('testValues')) {
                Object.assign(data, { km: 37, pct: 60, fresh: true, test: true, why: 'test values', raw: null });
                return;
            }
            data.test = false;
            let d = null;
            try {
                d = JSON.parse(fs.readFileSync(EDRIVE_FILE, 'utf8'));
            } catch (e) {
                Object.assign(data, { km: null, pct: null, fresh: false, raw: null,
                    why: e.code === 'ENOENT' ? 'file missing: eDrive is not writing it (demo mode, or not running)'
                        : e.code === 'EACCES' ? 'file not readable by this app'
                        : e.name === 'SyntaxError' ? 'file unreadable' : String(e.code || e.message) });
                return;
            }
            data.raw = d;
            // fresh = the file's own stamp keeps changing (the clock may jump after start-up,
            // so it is watched on the steady clock, not compared with now)
            if (d && d.t !== lastT) { lastT = d.t; changedAt = mono(); }
            data.fresh = changedAt > 0 && mono() - changedAt < STALE_MS;
            if (!data.fresh) { data.km = null; data.pct = null; data.why = 'file is not being updated'; return; }
            data.km = isNum(d.rangeKm) ? d.rangeKm : null;
            data.pct = isNum(d.soc) ? d.soc : null;
            data.why = data.km === null && data.pct === null ? 'eDrive has no charge reading yet'
                : data.km === null ? 'eDrive has no range yet' : data.pct === null ? 'eDrive has no charge yet' : 'ok';
        }

        /* ---------- the layers ---------- */
        let sentGeom = '', sentVals = '';
        const shown = () => !!settings.get('enabled');
        function geom() { return Wd.geometry(settings.get('dx'), settings.get('dy'), settings.get('size')); }

        function createLayers() {
            sentGeom = ''; sentVals = '';
            cluster.send({ op: 'hello', app: 'alexk_evrange', proto: 1 });
            const g = geom();
            cluster.send(Object.assign({ op: 'layer', ref: REF_T, target: 'panel', kind: 'effect', class: 'overlay',
                visible: shown() && settings.get('showText') ? 1 : 0, fs: Wd.TEXT_FS }, g.text));
            cluster.send(Object.assign({ op: 'layer', ref: REF_G, target: 'panel', kind: 'effect', class: 'overlay',
                visible: shown() && settings.get('showGauge') ? 1 : 0, fs: Wd.GAUGE_FS }, g.gauge));
            apply(true);
        }

        function apply(force) {
            if (!cluster.up) return;
            const g = geom();
            const vt = shown() && settings.get('showText') ? 1 : 0, vg = shown() && settings.get('showGauge') ? 1 : 0;
            const gk = JSON.stringify([g, vt, vg]);
            if (force || gk !== sentGeom) {
                cluster.send(Object.assign({ op: 'set', ref: REF_T, visible: vt }, g.text));
                cluster.send(Object.assign({ op: 'set', ref: REF_G, visible: vg }, g.gauge));
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_aspect', v: String(g.text.w / g.text.h) });
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_px', v: String(1 / g.text.h) });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_aspect', v: String(g.gauge.w / g.gauge.h) });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_px', v: String(1 / g.gauge.h) });
                sentGeom = gk;
            }
            const km = Wd.digitsOf(data.km, 999), pc = Wd.digitsOf(data.pct, 100);
            const pos = data.pct === null ? -1 : Wd.chargeToS(Math.max(0, Math.min(1, data.pct / 100)));
            const vk = km + '|' + pc + '|' + pos.toFixed(4);
            if (force || vk !== sentVals) {
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_km', v: km });
                cluster.send({ op: 'uniform', ref: REF_T, name: 'u_pc', v: pc });
                cluster.send({ op: 'uniform', ref: REF_G, name: 'u_s', v: String(pos) });
                sentVals = vk;
            }
        }

        const cluster = new Cluster(log, createLayers);
        cluster.start();
        readData();
        setInterval(() => { readData(); apply(false); }, 1000);
        settings.onChange(() => { readData(); apply(false); });

        /* ---------- the screen ---------- */
        ctx.loop('MAIN', 4, () => {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            G.frame(cv, t, ['EV range'], 0, [data.test && { text: 'TEST VALUES' }]);
            const row = (y, label, value, color) => {
                cv.text(label, 80, y, 30, t.dim, { font: 'label' });
                cv.text(value, 520, y, 34, color, { font: 'bold' });
            };
            row(120, 'Cluster renderer', cluster.up ? 'Connected' : 'Not found: install cluster-render from the Store',
                cluster.up ? GO : t.warn);
            const good = data.why === 'ok' || data.test;
            row(190, 'eDrive data', good ? data.km + ' km  /  ' + data.pct + ' %' : data.why, good ? GO : t.warn);
            if (data.raw && !data.test) {
                row(235, 'File says', 'soc ' + data.raw.soc + '   range ' + data.raw.rangeKm + '   kw ' + data.raw.kw, t.dim);
            }
            const g = geom();
            row(285, 'Widget', shown() ? 'On the cluster at ' + g.gauge.x + ', ' + g.gauge.y : 'Hidden (see Settings)',
                shown() ? t.text : t.dim);
            if (cluster.event) row(345, 'Renderer says', String(cluster.event).slice(0, 70), t.dim);
            if (!cluster.up && cluster.err) row(345, 'Socket', String(cluster.err), t.dim);
            cv.text('Settings: move, resize and turn parts on and off. Use Show test values to place it.',
                80, 470, 28, t.dim, { font: 'label' });
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
