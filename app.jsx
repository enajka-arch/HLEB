
// === React Dough Tracker (PWA prototype) ===
const { useEffect, useMemo, useRef, useState } = React;

// ---------- helpers ----------
const LSK = {
  SETTINGS: "doughtrack_settings_v1",
  BATCHES: "doughtrack_batches_v1",
  STARTER: "doughtrack_starter_v1",
};

function nowIso() { return new Date().toISOString(); }
function inHours(ms) { return ms / 3_600_000; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function loadLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

function q10Eta(baseHours, baseTemp, currentTemp) {
  if (!baseHours || !Number.isFinite(baseHours)) return null;
  const factor = Math.pow(2, (currentTemp - baseTemp) / 10);
  return baseHours / factor; // hours
}

function formatDuration(ms) {
  if (ms === null) return "—";
  const neg = ms < 0; const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000); const m = Math.floor((abs % 3_600_000) / 60_000);
  return `${neg ? "-" : ""}${h}ч ${String(m).padStart(2, "0")}м`;
}

function prettyDate(dt) {
  const d = new Date(dt);
  return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

function useTick(ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), ms); return () => clearInterval(id); }, [ms]);
}

// ---------- seeds ----------
const defaultSettings = {
  units: "metric",
  defaultTempC: 24,
  locale: undefined,
};

const defaultStarter = {
  name: "Закваска",
  hydration: 100,
  lastFeedAt: null, // ISO
  peakWindow_h: 4,
};

function Section({ title, children, right }) {
  return (
    <div className="rounded-2xl shadow p-4 bg-white/70 dark:bg-zinc-900/60 backdrop-blur border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

function useStore() {
  const [settings, setSettings] = useState(() => loadLS(LSK.SETTINGS, defaultSettings));
  const [batches, setBatches] = useState(() => loadLS(LSK.BATCHES, []));
  const [starter, setStarter] = useState(() => loadLS(LSK.STARTER, defaultStarter));

  useEffect(() => saveLS(LSK.SETTINGS, settings), [settings]);
  useEffect(() => saveLS(LSK.BATCHES, batches), [batches]);
  useEffect(() => saveLS(LSK.STARTER, starter), [starter]);

  return { settings, setSettings, batches, setBatches, starter, setStarter };
}

function AppShell() {
  const { settings, setSettings, batches, setBatches, starter, setStarter } = useStore();
  const [tab, setTab] = useState("home");
  const active = useMemo(() => batches.find(b => b.status === "active"), [batches]);

  useEffect(() => {
    document.title = "Дрожжевое — трекер";
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-rose-50 dark:from-zinc-950 dark:to-black text-zinc-900 dark:text-zinc-100">
      <div className="max-w-3xl mx-auto p-4 pb-24">
        <header className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-gradient-to-b from-amber-50/90 to-rose-50/60 dark:from-zinc-950/90 dark:to-black/60 backdrop-blur border-b border-zinc-200/60 dark:border-zinc-800/60">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">🥖 Дрожжевое</h1>
            <nav className="flex gap-2">
              {[
                { id: "home", label: "Домой" },
                { id: "new", label: "Новая партия" },
                { id: "starter", label: "Закваска" },
                { id: "settings", label: "Настройки" },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-full text-sm border ${tab === t.id ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent" : "bg-white/60 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800"}`}>
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <main className="mt-4 space-y-4">
          {tab === "home" && (
            <HomeTab active={active} batches={batches} setBatches={setBatches} settings={settings} />
          )}
          {tab === "new" && (
            <NewBatchTab settings={settings} onCreate={b => setBatches([b, ...batches])} />
          )}
          {tab === "starter" && (
            <StarterTab starter={starter} setStarter={setStarter} />
          )}
          {tab === "settings" && (
            <SettingsTab settings={settings} setSettings={setSettings} />
          )}
        </main>
      </div>

      <footer className="fixed bottom-0 inset-x-0 p-3 text-center text-xs text-zinc-500 bg-gradient-to-t from-white/80 to-transparent dark:from-black/60">
        Сделано с любовью к клейковине · офлайн-хранилище · v0.1
      </footer>
    </div>
  );
}

function HomeTab({ active, batches, setBatches, settings }) {
  useTick(1000);
  const now = Date.now();

  const finishAt = React.useMemo(() => {
    if (!active) return null;
    const baseH = Number(active.baseTime_h);
    const etaH = q10Eta(baseH, Number(active.baseTempC), Number(active.currentTempC));
    if (!etaH) return null;

    // Refine ETA by rise logs if at least 2 points
    let refinedEtaH = etaH;
    if (active.riseLogs && active.riseLogs.length >= 2) {
      const logs = [...active.riseLogs].sort((a, b) => new Date(a.at) - new Date(b.at));
      const t0 = new Date(logs[0].at).getTime();
      const t1 = new Date(logs[logs.length - 1].at).getTime();
      const p0 = logs[0].pct; const p1 = logs[logs.length - 1].pct;
      const dp = Math.max(1, p1 - p0);
      const dt = inHours(t1 - t0);
      const rate = dp / dt; // pct per hour, rough
      const remaining = Math.max(0, Number(active.targetRise_pct) - p1);
      refinedEtaH = dt + (remaining / rate);
    }
    return new Date(new Date(active.startedAt).getTime() + refinedEtaH * 3_600_000).getTime();
  }, [active]);

  function updateActive(patch) {
    setBatches(prev => prev.map(b => b.id === active.id ? { ...b, ...patch } : b));
  }

  function markDone(id) { setBatches(prev => prev.map(b => b.id === id ? { ...b, status: "done" } : b)); }
  function deleteBatch(id) { setBatches(prev => prev.filter(b => b.id !== id)); }

  const nextFoldEveryMin = 30; // simple heuristic for bulk first half

  const nextAction = React.useMemo(() => {
    if (!active || !finishAt) return null;
    const total = finishAt - new Date(active.startedAt).getTime();
    const elapsed = now - new Date(active.startedAt).getTime();
    const half = total / 2;
    if (elapsed < half) {
      const sinceLast = active.lastFoldAt ? (now - new Date(active.lastFoldAt).getTime()) : Infinity;
      const dueIn = Math.max(0, nextFoldEveryMin * 60_000 - sinceLast);
      return { label: dueIn === 0 ? "Сложить сейчас" : `Сложить через ${Math.round(dueIn / 60_000)} мин`, at: now + dueIn };
    }
    return { label: "Ждём целевого подъёма", at: finishAt };
  }, [active, finishAt, now]);

  return (
    <div className="space-y-4">
      {!active ? (
        <Section title="Нет активной партии">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Создайте новую партию на вкладке «Новая партия». Уверяю, тесто не обидится.</p>
          <div className="mt-3">
            {batches.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Завершённые</div>
                <div className="grid gap-2">
                  {batches.filter(b => b.status !== "active").map(b => (
                    <div key={b.id} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{b.name || `Партия ${b.id}`}</div>
                        <div className="text-xs text-zinc-500">Старт: {prettyDate(b.startedAt)} · Цель: {b.targetRise_pct}%</div>
                      </div>
                      <button onClick={() => deleteBatch(b.id)} className="text-xs px-2 py-1 border rounded-lg">Удалить</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Section>
      ) : (
        <>
          <Section title={active.name || "Активная партия"} right={
            <div className="flex gap-2">
              <button onClick={() => updateActive({ status: "paused" })} className="text-xs px-2 py-1 border rounded-lg">Пауза</button>
              <button onClick={() => markDone(active.id)} className="text-xs px-2 py-1 border rounded-lg">Готово</button>
            </div>
          }>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Старт" value={prettyDate(active.startedAt)} />
              <Stat label="Температура" value={`${active.currentTempC} °C`} hint={`База ${active.baseTempC} °C`} />
              <Stat label="Цель подъёма" value={`${active.targetRise_pct}%`} hint={`База ${active.baseTime_h} ч`} />
              <Stat label="Осталось" value={finishAt ? formatDuration(finishAt - Date.now()) : "—"} hint={finishAt ? `ETA: ${prettyDate(finishAt)}` : ""} />
            </div>
            {nextAction && (
              <div className="mt-4 p-3 rounded-xl bg-amber-100/70 dark:bg-amber-900/30 border border-amber-300/60 dark:border-amber-800/60">
                <div className="text-sm font-medium">{nextAction.label}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">до {new Date(nextAction.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="p-3 rounded-xl border bg-white/60 dark:bg-zinc-900/60">
                <div className="text-sm font-semibold mb-2">Отметить подъём</div>
                <RiseLogger active={active} updateActive={updateActive} />
              </div>
              <div className="p-3 rounded-xl border bg-white/60 dark:bg-zinc-900/60">
                <div className="text-sm font-semibold mb-2">Действия</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => updateActive({ lastFoldAt: nowIso() })} className="px-3 py-1.5 border rounded-lg text-sm">Сложил(а)</button>
                  <button onClick={() => updateActive({ currentTempC: Number(active.currentTempC) + 1 })} className="px-3 py-1.5 border rounded-lg text-sm">+1 °C</button>
                  <button onClick={() => updateActive({ currentTempC: Number(active.currentTempC) - 1 })} className="px-3 py-1.5 border rounded-lg text-sm">-1 °C</button>
                  <button onClick={() => updateActive({ notes: (active.notes || "") + `\\n${prettyDate(nowIso())}: заметка` })} className="px-3 py-1.5 border rounded-lg text-sm">Заметка</button>
                </div>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function RiseLogger({ active, updateActive }) {
  const [pct, setPct] = useState(50);
  return (
    <div>
      <label className="text-xs text-zinc-500">Процент подъёма</label>
      <input type="range" min={0} max={200} value={pct} onChange={e => setPct(Number(e.target.value))} className="w-full" />
      <div className="flex items-center justify-between text-sm mb-2"><span>0%</span><span>{pct}%</span><span>200%</span></div>
      <button onClick={() => {
        const log = { at: nowIso(), pct: Number(pct) };
        const prev = active.riseLogs || [];
        updateActive({ riseLogs: [...prev, log] });
      }} className="px-3 py-1.5 border rounded-lg text-sm">Добавить отметку</button>

      <div className="mt-2 space-y-1 max-h-32 overflow-auto">
        {(active.riseLogs || []).slice().reverse().map((r, i) => (
          <div key={i} className="text-xs text-zinc-600 dark:text-zinc-400 flex justify-between">
            <span>{prettyDate(r.at)}</span>
            <span>{r.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewBatchTab({ settings, onCreate }) {
  const [form, setForm] = useState({
    name: "Партия",
    flour_g: 500, water_g: 350, salt_g: 10, starter_g: 100,
    baseTempC: settings.defaultTempC || 24,
    baseTime_h: 6,
    currentTempC: settings.defaultTempC || 24,
    targetRise_pct: 90,
    vesselVolume_ml: 2000,
  });

  const etaH = q10Eta(Number(form.baseTime_h), Number(form.baseTempC), Number(form.currentTempC));

  function handleSubmit(e) {
    e.preventDefault();
    const id = Math.random().toString(36).slice(2, 8);
    const batch = {
      id,
      name: form.name,
      startedAt: nowIso(),
      ...form,
      riseLogs: [],
      status: "active",
      notes: "",
    };
    onCreate(batch);
  }

  function setField(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  return (
    <Section title="Новая партия">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Название">
          <input className="w-full px-3 py-2 border rounded-xl" value={form.name} onChange={e => setField("name", e.target.value)} />
        </Field>
        <Field label="Температура базовая (°C)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.baseTempC} onChange={e => setField("baseTempC", Number(e.target.value))} />
        </Field>
        <Field label="Время при базовой T (ч)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.baseTime_h} onChange={e => setField("baseTime_h", Number(e.target.value))} />
        </Field>
        <Field label="Текущая температура (°C)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.currentTempC} onChange={e => setField("currentTempC", Number(e.target.value))} />
        </Field>
        <Field label="Целевой подъём (%)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.targetRise_pct} onChange={e => setField("targetRise_pct", Number(e.target.value))} />
        </Field>
        <Field label="Ёмкость (мл)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.vesselVolume_ml} onChange={e => setField("vesselVolume_ml", Number(e.target.value))} />
        </Field>
        <Field label="Мука (г)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.flour_g} onChange={e => setField("flour_g", Number(e.target.value))} />
        </Field>
        <Field label="Вода (г)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.water_g} onChange={e => setField("water_g", Number(e.target.value))} />
        </Field>
        <Field label="Соль (г)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.salt_g} onChange={e => setField("salt_g", Number(e.target.value))} />
        </Field>
        <Field label="Закваска (г)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={form.starter_g} onChange={e => setField("starter_g", Number(e.target.value))} />
        </Field>

        <div className="sm:col-span-2 mt-2 p-3 rounded-xl border bg-white/60 dark:bg-zinc-900/60">
          <div className="text-sm">Прогноз при {form.currentTempC} °C: <b>{etaH ? `${etaH.toFixed(1)} ч` : "—"}</b> до целевого подъёма</div>
        </div>

        <div className="sm:col-span-2 flex gap-2 mt-2">
          <button className="px-4 py-2 rounded-xl border bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">Старт!</button>
          <button type="button" onClick={() => setForm({
            name: "Партия (быстрый старт)", flour_g: 500, water_g: 350, salt_g: 10, starter_g: 100,
            baseTempC: 24, baseTime_h: 6, currentTempC: 24, targetRise_pct: 90, vesselVolume_ml: 2000,
          })} className="px-4 py-2 rounded-xl border">Сбросить к дефолту</button>
        </div>
      </form>
    </Section>
  );
}

function StarterTab({ starter, setStarter }) {
  const [feedAmount, setFeedAmount] = useState(50);
  const nextPeakAt = useMemo(() => starter.lastFeedAt ? new Date(new Date(starter.lastFeedAt).getTime() + starter.peakWindow_h * 3_600_000) : null, [starter]);

  return (
    <div className="space-y-3">
      <Section title="Мой стартер">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Название" value={starter.name} />
          <Stat label="Гидратация" value={`${starter.hydration}%`} />
          <Stat label="Пик активности" value={`${starter.peakWindow_h} ч`} />
          <Stat label="Последняя подкормка" value={starter.lastFeedAt ? prettyDate(starter.lastFeedAt) : "—"} hint={nextPeakAt ? `Пик ~ ${prettyDate(nextPeakAt)}` : ""} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 items-end">
          <Field label="Гидратация (%)">
            <input type="number" className="w-full px-3 py-2 border rounded-xl" value={starter.hydration} onChange={e => setStarter({ ...starter, hydration: Number(e.target.value) })} />
          </Field>
          <Field label="Окно пика (ч)">
            <input type="number" className="w-full px-3 py-2 border rounded-xl" value={starter.peakWindow_h} onChange={e => setStarter({ ...starter, peakWindow_h: Number(e.target.value) })} />
          </Field>
          <Field label="Количество подкормки (г)">
            <input type="number" className="w-full px-3 py-2 border rounded-xl" value={feedAmount} onChange={e => setFeedAmount(Number(e.target.value))} />
          </Field>
          <button onClick={() => setStarter({ ...starter, lastFeedAt: nowIso() })} className="px-4 py-2 rounded-xl border bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">Подкормил(а)</button>
        </div>
      </Section>

      <Section title="Подсказки">
        <ul className="list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300 space-y-1">
          <li>На пике — используем для замеса. Если прошёл пик и началось оседание — увеличивайте долю стартера или снижайте температуру.</li>
          <li>Если в комнате жарко, окно пика сдвигается раньше; если прохладно — позже.</li>
        </ul>
      </Section>
    </div>
  );
}

function SettingsTab({ settings, setSettings }) {
  return (
    <Section title="Настройки">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Единицы">
          <select className="w-full px-3 py-2 border rounded-xl" value={settings.units} onChange={e => setSettings({ ...settings, units: e.target.value })}>
            <option value="metric">Метрические</option>
            <option value="imperial">Имперские</option>
          </select>
        </Field>
        <Field label="Температура по умолчанию (°C)">
          <input type="number" className="w-full px-3 py-2 border rounded-xl" value={settings.defaultTempC} onChange={e => setSettings({ ...settings, defaultTempC: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="mt-3 text-xs text-zinc-500">Данные хранятся только на устройстве (localStorage). Можно смело месить и офлайн.</div>
    </Section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs text-zinc-500">{label}</div>
      {children}
    </label>
  );
}

function App() {
  return <AppShell />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
