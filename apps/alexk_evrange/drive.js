'use strict';
/**
 * drive.js - the driving mode the car is in, as its FES service sends it (the table and the matching are
 * ported from Cluster Info's shared/data.js). Names are those the stock cluster uses: ADAPTIVE, HYBRID,
 * HYBRID ECO PRO, ELECTRIC, ELECTRIC INDIVIDUAL, SPORT, SPORT+, XTRABOOST, SPORT INDIVIDUAL ...
 */
const isNum = (v) => typeof v === 'number' && isFinite(v);

/*
 * The driving mode, as the car's FES service sends it: BMW's FES mode table (TAB_FES_MODUS_ARG in the G05's
 * body unit, BDC_G05), by name or number, shown as the stock cluster names them. A plug-in hybrid's modes
 * (PHEV_...) carry the eDrive mode in the name: HYBRID, ELECTRIC, BATTERY CONTROL.
 */
const FES_MODES = [
    [0x01, 'SPORT_DYNAMIC', 'SPORT'], [0x02, 'SPORT_EXPERT', 'SPORT+'], [0x03, 'SPORT_INDIVIDUAL', 'SPORT INDIVIDUAL'],
    [0x04, 'COMFORT', 'COMFORT'], [0x05, 'COMFORT_PLUS', 'COMFORT+'], [0x06, 'COMFORT_INDIVIDUAL', 'COMFORT INDIVIDUAL'],
    [0x07, 'ECO_PRO_EFFICIENT', 'ECO PRO'], [0x08, 'ECO_PRO_PLUS', 'ECO PRO+'], [0x09, 'ECO_PRO_INDIVIDUAL', 'ECO PRO INDIVIDUAL'],
    [0x0A, 'ADAPTIVE', 'ADAPTIVE'], [0x0B, 'OFFROAD_ICE', 'OFFROAD SNOW'], [0x0C, 'OFFROAD_SMOOTH', 'OFFROAD GRAVEL'],
    [0x0D, 'OFFROAD_GRIP', 'OFFROAD SAND'], [0x0E, 'OFFROAD_ROUGH', 'OFFROAD ROCK'],
    [0x0F, 'PHEV_SPORT_STANDARD', 'SPORT'], [0x10, 'PHEV_SPORT_INDIVIDUAL', 'SPORT INDIVIDUAL'],
    [0x11, 'PHEV_HYBRID_STANDARD', 'HYBRID'], [0x12, 'PHEV_HYBRID_ECO', 'HYBRID ECO PRO'], [0x13, 'PHEV_HYBRID_COMFORT', 'HYBRID COMFORT'],
    [0x14, 'PHEV_ELECTRIC_STANDARD', 'ELECTRIC'], [0x15, 'PHEV_ELECTRIC_INDIVIDUAL', 'ELECTRIC INDIVIDUAL'],
    [0x16, 'PHEV_BATTERY_CONTROL', 'BATTERY CONTROL'],
    // by name only (number not known): a plug-in hybrid's Sport Plus is its XtraBoost
    [-1, 'SPORT_PLUS', 'SPORT+'], [-1, 'PHEV_SPORT_PLUS', 'XTRABOOST'],
];
const norm = (str) => String(str).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Every leaf of a value: { key (its field name), v }. */
function leaves(v, out, key) {
    out = out || [];
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => leaves(v[k], out, k));
    else out.push({ key: key || '', v });
    return out;
}
/**
 * The mode a value names: an enum name from the table (the longest that matches, so PHEV_ELECTRIC_INDIVIDUAL
 * before ELECTRIC), else a number from it in a field named like a mode; null for none or an invalid value.
 * XtraBoost (a boost state some modes allow) is added when a string says it is active.
 * ice: a petrol or diesel car (Settings > Vehicle): its own modes only (Sport, Sport+, Comfort, Eco Pro,
 * Adaptive, the off-road ones), never a plug-in hybrid's names, and no XtraBoost.
 */
function modeOf(v, ice) {
    const ls = leaves(v);
    const TABLE = ice ? FES_MODES.filter((m) => !/^PHEV_/.test(m[1])) : FES_MODES;
    let best = null;
    ls.filter((l) => typeof l.v === 'string').forEach((l) => {
        const s = norm(l.v);
        if (/INVALID|UNGUELTIG|NOT_|_NOT|UNAVAILABLE|INITIALI/.test(s)) return;
        TABLE.forEach((m) => {
            const hit = s === m[1] || s.endsWith('_' + m[1]) || s.startsWith(m[1] + '_') || s.indexOf('_' + m[1] + '_') >= 0;
            if (hit && (!best || m[1].length > best[1].length)) best = m;
        });
    });
    if (!best) {
        const n = ls.find((l) => typeof l.v === 'number' && /mode|modus|switch|fes|programm|state|status|value/i.test(l.key) && TABLE.some((m) => m[0] === l.v));
        if (n) best = TABLE.find((m) => m[0] === n.v);
    }
    if (!best) return null;
    const boost = !ice && ls.some((l) => typeof l.v === 'string' && /XTRA_?BOOST|EXTRA_?BOOST/.test(norm(l.v)) && !/NOT|INACTIVE|OFF|INVALID/.test(norm(l.v)));
    return boost && !/XTRABOOST/.test(best[2]) ? best[2] + ' XTRABOOST' : best[2];
}

/** the setting each mode label belongs to (what the stock cluster calls it -> settings key) */
function keyOf(label) {
    if (!label) return null;
    if (/XTRABOOST/.test(label)) return 'modeXtraBoost';
    const m = {
        'ADAPTIVE': 'modeAdaptive', 'HYBRID': 'modeHybrid', 'HYBRID ECO PRO': 'modeHybridEco',
        'ELECTRIC': 'modeElectric', 'ELECTRIC INDIVIDUAL': 'modeElectricInd',
        'SPORT': 'modeSport', 'SPORT+': 'modeSportPlus', 'SPORT INDIVIDUAL': 'modeSportInd',
    };
    return m[label] || 'modeOther';
}

/**
 * Watches the car's driving mode. state: { label (as the stock cluster names it), raw (last value, for the
 * screen), key (the setting it belongs to) }. onChange() is called when the mode changes.
 */
function watchDriveMode(ctx, onChange) {
    const { log } = ctx;
    const state = { label: null, key: null, raw: '', from: '', at: 0 };
    const fes = (name) => (v) => {
        state.raw = name.replace(/^status/, '') + ': ' + JSON.stringify(v).slice(0, 80);
        const m = modeOf(v, false);
        const fromHmi = /HMI/.test(name);
        // the HMI's switch field is the one the stock cluster names; the other only while that one says nothing
        if (m && (fromHmi || state.from !== 'statusFESVehicleDynamicSwitchHMI' || Date.now() - state.at > 60000)) {
            if (m !== state.label) log.info('drive mode: ' + m);
            state.label = m; state.key = keyOf(m); state.from = name; state.at = Date.now();
            onChange();
        }
    };
    ctx.signals.watch('de.bmw.infotainment.drivingexcitement.FES', '1', {
        statusFESVehicleDynamicSwitchHMI: fes('statusFESVehicleDynamicSwitchHMI'),
        statusSwitchDriveDynamicSport2: fes('statusSwitchDriveDynamicSport2'),
    }, log).then((s) => log.info('drive mode ' + (s && s.error ? 'error: ' + s.error : 'subscribed')));
    return state;
}

module.exports = { watchDriveMode, keyOf, modeOf, FES_MODES };
