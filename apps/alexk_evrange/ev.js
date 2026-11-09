'use strict';
/**
 * ev.js - the electric range, calculated the way eDrive does it (ported from eDrive 2.8.3, range.js unchanged).
 *
 * Learns from the car's own driving (charge used per km, per speed band; climate / on-board draw per hour,
 * per outside temperature) and counts only the charge above the one where the engine starts. Until it has
 * learned, the range of a full battery at the outside temperature is used (the "Electric range when full,
 * 20 C" setting, scaled by a temperature curve).
 *
 * Fed by main.js with every charge reading (onSoc); the car's signals (speed, engine, climate, seat and
 * wheel heating, outside temperature) are watched here. Learning is kept in evrange.json in the data folder.
 */
const fs = require('fs');
const path = require('path');
const { RangeModel } = require('./range');

const isNum = (v) => typeof v === 'number' && isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const SEAT_KW = [0, 0.04, 0.07, 0.1];     // seat heating per level 0..3 (kW)
const WHEEL_KW = 0.06;                     // steering-wheel heating (kW)
const PACE_TAU = 300;                      // s: the pace follows the last few minutes of driving
const PACE_KEEP = 15 * 60000;              // ms without moving after which there is no "current pace"
const STOP_MS = 5 * 60000;                 // standing longer than this is parking, not traffic
const RESERVE = 8;                         // engine-start charge (%) until two engine starts have been seen
// Low battery: the car holds the charge at about 5-11 % and drives as a hybrid; nothing in this zone teaches
// the range, and the range counts down to its top.
const HOLD_TOP = 11;
// range of a full battery by outside temperature for a car doing 50 km at 20 C: [C, low km, high km]
const RANGE_CURVE = [[-10, 20, 30], [0, 30, 38], [10, 40, 45], [20, 50, 50]];
const ON = { 1: true, KLIMAANLAGE_EIN: true, 0: false, KLIMAANLAGE_AUS: false };

module.exports = function createEstimator(ctx) {
    const { settings, log } = ctx;
    const S = (ctx.spec.config && ctx.spec.config.scaling) || {};
    const sc = (k, raw) => {
        const c = S[k];
        if (!c || raw === undefined || raw === null || raw === c.invalid) return null;
        const v = raw * c.factor + (c.offset || 0);
        return c.max != null && v > c.max ? null : v;
    };

    /* ---------- what is learned (kept across restarts) ---------- */
    const STATE = path.join(ctx.dataDir, 'evrange.json');
    let st = {};
    try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch (e) { /* first run */ }
    st.rangeV = 2;
    const model = new RangeModel(st);
    let savedAt = Date.now(), saved = JSON.stringify(st);
    const save = () => {
        savedAt = Date.now(); saved = JSON.stringify(st);
        try { fs.writeFileSync(STATE, saved); } catch (e) { log.warn('save: ' + e); }
    };
    process.on('exit', () => { if (JSON.stringify(st) !== saved) save(); });

    const live = { soc: null, socT: 0, soh: isNum(st.soh) ? st.soh : null, sohT: st.sohT || 0, ambient: null, speed: null,
        rpm: null, rpmT: 0, climate: null, ac: null, seats: {}, wheel: null, pace: null, lastMove: 0 };
    const kwhPerPct = () => settings.get('designKwh') * (isNum(live.soh) ? live.soh : 100) / 100 / 100;

    /* ---------- electric driving: distance and engine use since the last charge reading ---------- */
    const seg = { km: 0, engine: false, engineAll: false, climate: null, climateMixed: false, comfort: 0 };
    let lastSpeedT = 0;
    const onSpeed = (kmh) => {
        const now = Date.now();
        if (lastSpeedT && isNum(kmh)) {
            const dt = clamp(now - lastSpeedT, 0, 2000);
            seg.km += kmh * dt / 3600000;
            const engineOn = isNum(live.rpm) && live.rpm > 400 && now - live.rpmT < 5000;
            if (kmh > 3 && !engineOn) live.lastMove = now;
            if (!engineOn && now - live.lastMove < STOP_MS) {
                live.pace = live.pace === null ? kmh : live.pace + (kmh - live.pace) * (dt / 1000) / (dt / 1000 + PACE_TAU);
            }
        }
        lastSpeedT = now;
    };
    const paceNow = () => (live.pace !== null && live.lastMove && Date.now() - live.lastMove < PACE_KEEP ? live.pace : null);
    const onRpm = (rpm) => {
        const was = live.rpm;
        live.rpm = rpm; live.rpmT = Date.now();
        if (rpm > 400) seg.engine = true;
        else if (rpm < 300) seg.engineAll = false;
        // an engine start while driving at a low charge is where this car stops driving electric
        if (isNum(was) && was < 300 && rpm > 600 && isNum(live.speed) && live.speed > 3
            && isNum(live.soc) && Date.now() - live.socT < 60000 && live.soc <= 20 && live.soc > HOLD_TOP) {
            st.engineStarts = (st.engineStarts || []).concat([Math.round(live.soc * 10) / 10]).slice(-5);
            log.info('engine started while driving at ' + live.soc.toFixed(1) + ' %');
            save();
        }
    };
    /** Charge at which the engine starts: the setting, or the median of the engine starts seen. */
    function reserve() {
        const s = settings.get('reserve');
        if (s != null && s !== 'auto' && isFinite(+s)) return +s;
        const e = (st.engineStarts || []).filter((x) => x > HOLD_TOP).sort((a, b) => a - b);
        return Math.max(HOLD_TOP, e.length >= 2 ? e[Math.floor(e.length / 2)] : RESERVE);
    }

    /* ---------- climate control on / off (per zone: on when any zone is on) ---------- */
    const zones = { climate: {}, ac: {} };
    const onZone = (what, on, zone) => {
        if (typeof on !== 'boolean') return;
        const z = zones[what];
        if (zone === 'ALL_ZONES') zone = 0;
        if (!zone) Object.keys(z).forEach((k) => delete z[k]);
        z[zone || 0] = on;
    };
    const entries = (v, key, out) => {
        out = out || [];
        if (v && typeof v === 'object') {
            if (key in v) out.push(v);
            else Object.keys(v).forEach((k) => entries(v[k], key, out));
        }
        return out;
    };
    const one = (v, key) => { const e = entries(v, key)[0]; return e ? e[key] : undefined; };
    const climateNow = () => {
        const sys = Object.keys(zones.climate).length ? Object.keys(zones.climate).some((k) => zones.climate[k]) : null;
        const ac = Object.keys(zones.ac).length ? Object.keys(zones.ac).some((k) => zones.ac[k]) : null;
        live.ac = ac;
        return ac ? 'ac' : sys;
    };
    const climateChanged = () => {
        const now = climateNow();
        if (now === null) return;
        if (live.climate !== null && now !== live.climate) { seg.climateMixed = true; log.info('climate control ' + (now === 'ac' ? 'on (A/C)' : now ? 'on' : 'off')); }
        live.climate = now;
    };
    const onClimate = (what, key, v) => { entries(v, key).forEach((e) => onZone(what, e[key], e.operationZone)); climateChanged(); };
    const onAircon = (v) => {
        const on = ON[one(v, 'statusAircon')];
        if (typeof on === 'boolean') { zones.ac = { 0: on }; climateChanged(); }
    };
    const onBlower = (v) => {
        const b = one(v, 'statusBlowerSettingDR');
        if (typeof b === 'number' && b < 255) { zones.climate = { 0: b > 0 }; climateChanged(); }
    };
    const stretchClimate = () => (seg.climateMixed ? 'mixed' : seg.climate);
    const level = (v) => (typeof v === 'number' && v >= 0 && v < 15 ? Math.min(3, v) : null);
    const onSeat = (pos, key) => (v) => { live.seats[pos] = level(one(v, key)); };
    const comfortKw = () => {
        const seats = Object.keys(live.seats).reduce((a, k) => a + (live.seats[k] ? SEAT_KW[live.seats[k]] : 0), 0);
        return seats + (live.wheel ? WHEEL_KW : 0);
    };

    /* ---------- the car's signals ---------- */
    const watch = (iface, handlers, opts, name) => ctx.signals.watch(iface, '1', handlers, log, opts)
        .then((s) => log.info(name + ' ' + (s && s.error ? 'error: ' + s.error : 'subscribed')));
    watch('de.bmw.infrastructure.EnvironmentalInformation', {
        ExteriorTemperature: (v) => { const a = sc('ambient', v.temperatureExterior); if (a !== null) live.ambient = a; },
    }, undefined, 'ambient');
    watch('de.bmw.infotainment.vehicle.Vehicle2', {
        statusCarSpeed2: (v) => {
            const k = v.speedVehicleCentreOfGravity;
            live.speed = k === 65535 || k == null ? null : k * 0.015625;
            onSpeed(live.speed);
        },
    }, undefined, 'speed');
    watch('de.bmw.infotainment.vehicle.CDS', {
        statusEngineSpeed2: (v) => { const r = sc('rpm', v.actualValueRPMEngineCrankshaft); if (r !== null && r >= 0 && r < 12000) onRpm(r); },
    }, undefined, 'rpm');
    watch('de.bmw.infotainment.climate.climatemaster.ClimateMaster', {
        statusClimateSystemOn: (v) => onClimate('climate', 'airConditioningOn', v),
        statusAirCondAC: (v) => onClimate('ac', 'acButton', v),
    }, { pollMs: 10000 }, 'climate');
    watch('de.bmw.infotainment.climate.Climate2', {
        statusACFront: onAircon,
        statusAirConditionDRStatus: onBlower,
    }, { pollMs: 10000 }, 'climate2');
    watch('de.bmw.infotainment.climate.Climate', {
        statusSeatHeatingDR: onSeat('DR', 'statusSeatHeaterDR'),
        statusSeatHeatingPS: onSeat('PS', 'statusSeatHeaterPS'),
        statusSeatHeatingDRR: onSeat('DRR', 'statusSeatHeaterDRR'),
        statusSeatHeatingPSR: onSeat('PSR', 'statusSeatHeaterPSR'),
    }, { pollMs: 15000 }, 'seat heating');
    watch('de.bmw.body.steeringwheelcomfort.SteeringWheelClimate', {
        heatingState: (v) => { const h = one(v, 'heating'); if (typeof h === 'boolean') live.wheel = h; },
    }, { pollMs: 15000 }, 'steering wheel');

    /* ---------- learning, at every charge reading ---------- */
    function onSoc(soc, now) {
        live.soc = soc; live.socT = now;
        const prev = st.lastSoc;
        const h = (now - (st.lastSocT || 0)) / 3600000;
        const held = isNum(prev) && Math.min(prev, soc) <= HOLD_TOP + 1;      // low-battery hybrid zone
        if (held) { /* the car manages the charge here: nothing to learn */ }
        else if (isNum(prev) && h < 2 / 60 && !seg.engine && now - live.rpmT < 5000) {
            model.learn(prev - soc, h, seg.km, live.ambient, kwhPerPct(), stretchClimate(), (seg.comfort + comfortKw()) / 2);
        } else if (isNum(prev) && h < 2 / 60 && seg.engine && seg.engineAll && now - live.rpmT < 5000) {
            model.learnEngine(prev - soc, h, seg.km);
        }
        seg.km = 0; seg.engine = isNum(live.rpm) && live.rpm > 400; seg.engineAll = seg.engine;
        seg.climate = live.climate; seg.climateMixed = false; seg.comfort = comfortKw();
        st.lastSoc = soc; st.lastSocT = now;
        if (now - savedAt > 120000) save();
    }
    function setSoh(v) { live.soh = v; live.sohT = Date.now(); st.soh = v; st.sohT = live.sohT; save(); }
    const sohDue = (days) => live.soh === null || Date.now() - live.sohT > days * 86400000;

    /* ---------- the range ---------- */
    /** Range of a full battery at tC: { lo, hi, mid } in km (no temperature: 10 C assumed). */
    function rangeAt(tC) {
        const k = settings.get('fullRange') / 50, c = RANGE_CURVE;
        const t = isNum(tC) ? tC : 10;
        let lo, hi;
        if (t >= c[c.length - 1][0]) { lo = c[c.length - 1][1]; hi = c[c.length - 1][2]; }
        else if (t <= c[0][0]) {
            const d = c[0][0] - t, sl = (c[1][1] - c[0][1]) / (c[1][0] - c[0][0]), sh = (c[1][2] - c[0][2]) / (c[1][0] - c[0][0]);
            lo = Math.max(15, c[0][1] - sl * d); hi = Math.max(18, c[0][2] - sh * d);
        } else {
            let i = 0;
            while (t > c[i + 1][0]) i++;
            const f = (t - c[i][0]) / (c[i + 1][0] - c[i][0]);
            lo = c[i][1] + (c[i + 1][1] - c[i][1]) * f; hi = c[i][2] + (c[i + 1][2] - c[i][2]) * f;
        }
        return { lo: lo * k, hi: hi * k, mid: (lo + hi) / 2 * k };
    }
    /** Range at charge soc: only the charge above the engine-start point counts (eDrive's estimate()). */
    function estimate(soc, tC, climate, pace, comfort) {
        const res = reserve(), span = Math.max(1, 100 - res), use = isNum(soc) ? Math.max(0, soc - res) : null;
        const k = kwhPerPct(), m = model.range(use, tC, k, climate, pace, comfort), aux = m ? m.aux : model.auxRate(tC, k, climate);
        const base = { res, auxKw: aux.rate * k, climate };
        if (m) return Object.assign(base, { mid: m.mid, kpp: m.kpp, learned: true, pace: m.pace, perKm: m.perKm });
        // before driving is learned: the temperature curve (it already holds typical climate use)
        const r = rangeAt(tC);
        let f = 1;
        if (climate === false) {
            const onPerKm = span / r.mid, climPerKm = (model.auxRate(tC, k).rate - aux.rate) / model.evSpeed();
            f = onPerKm / Math.max(onPerKm * 0.5, onPerKm - Math.max(0, climPerKm));
        } else if (climate === 'ac') {
            const onPerKm = span / r.mid, acPerKm = (aux.rate - model.auxRate(tC, k, true).rate) / model.evSpeed();
            f = onPerKm / (onPerKm + Math.max(0, acPerKm));
        }
        const kpp = r.mid / span * f;
        return Object.assign(base, { mid: use === null ? null : use * kpp, kpp, learned: false, pace: isNum(pace) ? pace : model.evSpeed() });
    }
    const now = (soc) => estimate(soc, live.ambient, live.climate, paceNow(), comfortKw());
    /** km at this charge, rounded; null if the charge is not known */
    const rangeKm = (soc) => { const e = isNum(soc) ? now(soc) : null; return e && isNum(e.mid) ? Math.round(e.mid) : null; };
    /** for the app's own screen */
    const info = (soc) => {
        const e = now(isNum(soc) ? soc : 100), s = settings.get('reserve');
        return { reserve: e.res, reserveAuto: s == null || s === 'auto', starts: (st.engineStarts || []).length, learned: e.learned,
            kpp: e.kpp, pace: e.pace, auxKw: e.auxKw, ambient: live.ambient, climate: live.climate, soh: live.soh };
    };
    return { onSoc, setSoh, sohDue, rangeKm, info, save };
};
