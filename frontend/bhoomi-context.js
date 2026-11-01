/* bhoomi-context.js
   Risk analysis for risk.html. Keyless data only (Open-Meteo).
   Exposes window.BHOOMI_CTX = { LEVELS, analyse(region) }.
   No default location: the caller must pass the saved farm point. */
(() => {
  const LEVELS = ['Low', 'Moderate', 'High'];

  /* Thresholds. Keep these in sync with the "How ratings are decided" table in risk.html. */
  const T = {
    heat:  { mod: 35, high: 40, hotDay: 38, hotDays: 3 },
    rain:  { modDay: 25, highDay: 50, modThree: 40, highThree: 80 },
    dry:   { past14: 10, fc7: 10, dryDays: 10, soilLow: 0.15 },
    wind:  { mod: 40, high: 60 },
    humid: { rh: 80, rain3: 5 },
    frost: { mod: 2, high: 0 },
  };

  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  const sum = (a) => a.reduce((s, x) => s + (num(x) ?? 0), 0);
  const r0 = (n) => Math.round(n);
  const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const nowKeyFor = (offsetSeconds) =>
    new Date(Date.now() + (offsetSeconds || 0) * 1000).toISOString().slice(0, 13) + ':00';

  /* Modelled soil moisture right now (m3/m3). Returns null if no layer is available. */
  async function loadSoil(lat, lon) {
    const layers = ['soil_moisture_9_to_27cm', 'soil_moisture_7_to_28cm'];
    for (const key of layers) {
      try {
        const p = new URLSearchParams({ latitude: lat, longitude: lon, hourly: key, forecast_days: 1, timezone: 'auto' });
        const res = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
        if (!res.ok) continue;
        const d = await res.json();
        const nowKey = nowKeyFor(d.utc_offset_seconds);
        let i = d.hourly.time.indexOf(nowKey);
        if (i < 0) i = 0;
        const v = num(d.hourly[key][i]);
        if (v !== null) return v;
      } catch (e) { /* try next layer */ }
    }
    return null;
  }

  function dayLabel(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
  }

  function cropWords() {
    let name = '';
    try { name = (window.BHOOMI && window.BHOOMI.cropName && window.BHOOMI.cropName()) || ''; } catch (e) { /* ignore */ }
    return name ? 'your ' + name.toLowerCase() : 'your crop';
  }

  async function analyse(region) {
    if (!region || !Number.isFinite(region.lat) || !Number.isFinite(region.lon)) {
      throw new Error('No farm location');
    }
    const { lat, lon } = region;
    const crop = cropWords();

    const p = new URLSearchParams({
      latitude: lat, longitude: lon,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
      hourly: 'relative_humidity_2m',
      past_days: 14, forecast_days: 7, timezone: 'auto',
    });
    const [f, soil] = await Promise.all([
      getJSON('https://api.open-meteo.com/v1/forecast?' + p),
      loadSoil(lat, lon),
    ]);

    const nowKey = nowKeyFor(f.utc_offset_seconds);
    const today = nowKey.slice(0, 10);
    const ti = f.daily.time.indexOf(today);
    if (ti < 0) throw new Error('Forecast does not include today');

    const D = f.daily;
    const days = D.time.slice(ti, ti + 7).map((t, k) => ({
      label: dayLabel(t),
      tmax: num(D.temperature_2m_max[ti + k]) ?? 0,
      tmin: num(D.temperature_2m_min[ti + k]) ?? 0,
      rain: num(D.precipitation_sum[ti + k]) ?? 0,
      wind: num(D.wind_speed_10m_max[ti + k]) ?? 0,
    }));
    if (!days.length) throw new Error('Empty forecast');

    const peak = (key, fn = Math.max) => {
      const v = fn(...days.map((d) => d[key]));
      return { v, day: days.find((d) => d[key] === v) };
    };

    /* ---------- Heat ---------- */
    const hotMax = peak('tmax');
    const n35 = days.filter((d) => d.tmax >= T.heat.mod).length;
    const n38 = days.filter((d) => d.tmax >= T.heat.hotDay).length;
    const heatLevel = (hotMax.v >= T.heat.high || n38 >= T.heat.hotDays) ? 2 : hotMax.v >= T.heat.mod ? 1 : 0;
    const heat = {
      id: 'heat', order: 1, label: 'Heat stress', level: heatLevel,
      finding: heatLevel
        ? `Hot spell ahead, up to ${r0(hotMax.v)}°C on ${hotMax.day.label}`
        : `No dangerous heat, highest ${r0(hotMax.v)}°C`,
      evidence: [`Highest maximum: ${r0(hotMax.v)}°C (${hotMax.day.label})`, `Days at ${T.heat.mod}°C or above: ${n35} of ${days.length}`],
      why: 'High temperatures dry the soil faster and can stress flowering and grain or tuber filling.',
      action: heatLevel
        ? `Irrigate in the early morning or evening, avoid spraying in the afternoon, and check ${crop} for wilting at midday.`
        : `Nothing to do for heat. Keep your normal irrigation for ${crop}.`,
      confidence: { label: 'Medium', note: 'Forecast temperatures are less certain after day 3.' },
    };

    /* ---------- Heavy rain ---------- */
    const rainMax = peak('rain');
    let three = 0;
    for (let k = 0; k <= days.length - 3; k++) {
      three = Math.max(three, sum(days.slice(k, k + 3).map((d) => d.rain)));
    }
    const rainLevel = (rainMax.v >= T.rain.highDay || three >= T.rain.highThree) ? 2
      : (rainMax.v >= T.rain.modDay || three >= T.rain.modThree) ? 1 : 0;
    const rain = {
      id: 'rain', order: 2, label: 'Heavy rain / waterlogging', level: rainLevel,
      finding: rainLevel
        ? `Heavy rain expected, ${r0(rainMax.v)} mm on ${rainMax.day.label}`
        : `No heavy rain, wettest day ${r1(rainMax.v)} mm`,
      evidence: [`Wettest day: ${r1(rainMax.v)} mm (${rainMax.day.label})`, `Wettest 3-day total: ${r0(three)} mm`],
      why: 'Standing water starves roots of air, and heavy rain can wash away fertiliser and damage standing crops.',
      action: rainLevel
        ? `Clear drainage channels before the rain, hold back irrigation, fertiliser and spraying, and harvest anything that is ready.`
        : `No action needed for rain.`,
      confidence: { label: 'Medium', note: 'Rain amounts vary a lot from field to field.' },
    };

    /* ---------- Dry spell ---------- */
    const past14 = sum(D.precipitation_sum.slice(Math.max(0, ti - 14), ti));
    const fc7 = sum(days.map((d) => d.rain));
    let dryDays = 0;
    for (let k = ti - 1; k >= 0 && (num(D.precipitation_sum[k]) ?? 0) < 1; k--) dryDays++;
    const pts = [
      past14 < T.dry.past14,
      fc7 < T.dry.fc7,
      dryDays >= T.dry.dryDays,
      soil !== null && soil < T.dry.soilLow,
    ];
    const points = pts.filter(Boolean).length;
    const dryLevel = points >= 3 ? 2 : points === 2 ? 1 : 0;
    const dry = {
      id: 'dry', order: 3, label: 'Dry spell / drought stress', level: dryLevel,
      finding: dryLevel
        ? `Dry conditions building, ${r0(past14)} mm in the last 14 days and ${r0(fc7)} mm forecast`
        : `Enough moisture for now, ${r0(past14)} mm in the last 14 days`,
      evidence: [
        `Rain in the last 14 days: ${r0(past14)} mm`,
        `Rain forecast for 7 days: ${r0(fc7)} mm`,
        `Days in a row without rain: ${dryDays}`,
        soil !== null ? `Modelled soil moisture: ${soil.toFixed(3)} m³/m³` : 'Modelled soil moisture: not available here',
        `Warning points: ${points} of ${soil !== null ? 4 : 3}`,
      ],
      why: 'A long dry stretch with little rain coming leaves the root zone short of water.',
      action: dryLevel
        ? `Plan irrigation for ${crop} in the next few days. Water in the early morning to lose less to evaporation.`
        : `No extra irrigation needed because of dryness. Check the soil by hand before you irrigate.`,
      confidence: soil !== null
        ? { label: 'Medium', note: 'Short-term signal from weather-model data, not a seasonal drought forecast.' }
        : { label: 'Low', note: 'Soil moisture was not available, so this uses rainfall only.' },
    };

    /* ---------- Wind ---------- */
    const windMax = peak('wind');
    const windLevel = windMax.v >= T.wind.high ? 2 : windMax.v >= T.wind.mod ? 1 : 0;
    const wind = {
      id: 'wind', order: 4, label: 'Strong wind', level: windLevel,
      finding: windLevel
        ? `Strong wind expected, up to ${r0(windMax.v)} km/h on ${windMax.day.label}`
        : `Wind stays moderate, up to ${r0(windMax.v)} km/h`,
      evidence: [`Highest wind: ${r0(windMax.v)} km/h (${windMax.day.label})`],
      why: 'Strong wind can lodge tall crops, damage young plants and make spraying drift off target.',
      action: windLevel
        ? `Do not spray on windy days, support tall crops where you can, and secure nets, sheets and tunnels.`
        : `Wind is fine for normal field work. For spraying, still choose a calm hour.`,
      confidence: { label: 'Medium', note: 'Gusts can be stronger than the daily maximum shown.' },
    };

    /* ---------- Humid, damp weather ---------- */
    const hi = f.hourly.time.indexOf(nowKey);
    let rhAvg = null;
    if (hi >= 0) {
      const v = f.hourly.relative_humidity_2m.slice(hi, hi + 48).map(num).filter((x) => x !== null);
      if (v.length) rhAvg = sum(v) / v.length;
    }
    const rain3 = sum(days.slice(0, 3).map((d) => d.rain));
    const humidOn = rhAvg !== null && rhAvg >= T.humid.rh && rain3 >= T.humid.rain3;
    const humid = {
      id: 'humid', order: 5, label: 'Humid, damp weather', level: humidOn ? 1 : 0,
      finding: humidOn
        ? `Damp weather ahead, ${r0(rhAvg)}% humidity with ${r0(rain3)} mm rain in 3 days`
        : rhAvg !== null ? `No damp-weather signal, average humidity ${r0(rhAvg)}%` : 'Humidity data not available',
      evidence: [
        rhAvg !== null ? `Average humidity, next 48 hours: ${r0(rhAvg)}%` : 'Average humidity: not available',
        `Rain in the next 3 days: ${r1(rain3)} mm`,
      ],
      why: 'Long wet, humid spells make it easier for fungal problems to start.',
      action: humidOn
        ? `Walk the field often and look at the undersides of leaves of ${crop}. Ask your local agriculture office before using any spray.`
        : `Nothing to do for humidity.`,
      confidence: { label: 'Low', note: 'This is a weather signal only, not a disease detection.' },
    };

    /* ---------- Cold / frost ---------- */
    const coldMin = peak('tmin', Math.min);
    const frostLevel = coldMin.v <= T.frost.high ? 2 : coldMin.v <= T.frost.mod ? 1 : 0;
    const frost = {
      id: 'frost', order: 6, label: 'Cold / frost', level: frostLevel,
      finding: frostLevel
        ? `Frost risk, night low of ${r0(coldMin.v)}°C on ${coldMin.day.label}`
        : `No frost, lowest night ${r0(coldMin.v)}°C`,
      evidence: [`Lowest minimum: ${r0(coldMin.v)}°C (${coldMin.day.label})`],
      why: 'Frost damages leaves and flowers, and cold nights slow growth.',
      action: frostLevel
        ? `Irrigate lightly in the evening before a cold night, since moist soil holds heat longer, and cover young plants if you can.`
        : `No frost protection needed.`,
      confidence: { label: 'Medium', note: 'Low-lying parts of a field can be colder than the forecast point.' },
    };

    const risks = [heat, rain, dry, wind, humid, frost];
    const top = Math.max(...risks.map((r) => r.level));
    const overall = top === 2 ? { key: 'attention', label: 'Needs attention' }
      : top === 1 ? { key: 'watch', label: 'Keep watch' }
      : { key: 'ok', label: 'All clear' };

    const quality = [
      { source: 'Farm location', status: 'ok', note: `Saved farm point for ${region.name || 'your farm'} (${lat.toFixed(3)}, ${lon.toFixed(3)}).` },
      { source: 'Open-Meteo forecast', status: 'ok', note: 'Daily temperature, rain and wind, and hourly humidity, from 14 days back to 7 days ahead.' },
      soil !== null
        ? { source: 'Soil moisture (modelled)', status: 'ok', note: 'Weather-model estimate for the root zone, not a sensor reading.' }
        : { source: 'Soil moisture (modelled)', status: 'missing', note: 'Not available for this point, so the dry-spell rating uses rainfall only.' },
    ];

    return { risks, overall, weather: { days }, quality };
  }

  window.BHOOMI_CTX = { LEVELS, analyse, THRESHOLDS: T };
})();
