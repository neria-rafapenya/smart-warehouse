import { createContext, useContext, useEffect, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { warehouseService } from "./application/useWarehouse";

const WarehouseContext = createContext(null);
const emptyData = {
  kpis: [],
  orders: [],
  stock: [],
  movements: [],
  suppliers: [],
  invoices: [],
  procedures: [],
  events: [],
  alerts: [],
  alertRules: [],
  receipts: [],
  integrations: [],
};
const useWarehouseData = () => useContext(WarehouseContext);

const ANOMALY_HISTORY_KEY = "smart_warehouse_anomaly_history";
const ANOMALY_CURRENT_KEY = "smart_warehouse_current_anomalies";
const LEGACY_RESOLVED_ANOMALIES_KEY = "smart_warehouse_resolved_anomalies";

const readStored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const anomalySlug = (value) =>
  String(value || "anomaly")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const anomalyFingerprint = (finding) =>
  finding.order_id || finding.sku || finding.product || "anomaly";

const anomalyBase = (finding) => anomalySlug(finding.sku || finding.order_id || finding.product);

const recordAnomalyAnalysis = (findings, forceNew = false) => {
  const current = readStored(ANOMALY_CURRENT_KEY, []);
  const history = readStored(ANOMALY_HISTORY_KEY, []);
  if (!forceNew && current.length) {
    const currentByFingerprint = new Map(
      current.map((record) => [anomalyFingerprint(record.finding), record]),
    );
    const records = findings.map((finding) => {
      const existing = currentByFingerprint.get(anomalyFingerprint(finding));
      return existing ? { ...existing, finding } : null;
    });
    if (records.every(Boolean)) {
      localStorage.setItem(ANOMALY_CURRENT_KEY, JSON.stringify(records));
      return records;
    }
  }

  const counts = history.reduce((accumulator, record) => {
    accumulator[record.base] = (accumulator[record.base] || 0) + 1;
    return accumulator;
  }, {});
  const legacyResolved = readStored(LEGACY_RESOLVED_ANOMALIES_KEY, {});
  const records = findings.map((finding) => {
    const base = anomalyBase(finding);
    counts[base] = (counts[base] || 0) + 1;
    const fingerprint = anomalyFingerprint(finding);
    return {
      id: `${base}-${counts[base]}`,
      base,
      finding,
      status: legacyResolved[fingerprint] ? "resolved" : "pending",
      createdAt: new Date().toISOString(),
    };
  });
  localStorage.setItem(ANOMALY_HISTORY_KEY, JSON.stringify([...history, ...records]));
  localStorage.setItem(ANOMALY_CURRENT_KEY, JSON.stringify(records));
  return records;
};

const updateAnomalyStatus = (id, status = "resolved") => {
  const update = (record) =>
    record.id === id ? { ...record, status, resolvedAt: new Date().toISOString() } : record;
  const history = readStored(ANOMALY_HISTORY_KEY, []).map(update);
  const current = readStored(ANOMALY_CURRENT_KEY, []).map(update);
  localStorage.setItem(ANOMALY_HISTORY_KEY, JSON.stringify(history));
  localStorage.setItem(ANOMALY_CURRENT_KEY, JSON.stringify(current));
  return history.find((record) => record.id === id) || null;
};

const findAnomalyRecord = (id) =>
  readStored(ANOMALY_HISTORY_KEY, []).find((record) => record.id === id);

const nav = [
  { to: "/", label: "Resumen IA", icon: "bi-grid-1x2-fill", end: true },
  { to: "/anomalias", label: "Anomalías", icon: "bi-exclamation-triangle" },
  { to: "/demanda", label: "Demanda", icon: "bi-graph-up-arrow" },
  { to: "/integraciones", label: "Integraciones", icon: "bi-diagram-3" },
];

function App() {
  const [copilot, setCopilot] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [data, setData] = useState(emptyData);
  const loadData = () =>
    warehouseService
      .loadAll()
      .then(setData)
      .catch((error) => console.error("No se pudo cargar la API", error));
  useEffect(() => {
    if (localStorage.getItem("smart_warehouse_token"))
      warehouseService
        .me()
        .then(setSession)
        .catch(() => localStorage.removeItem("smart_warehouse_token"))
        .finally(() => setAuthChecking(false));
    else setAuthChecking(false);
  }, []);
  useEffect(() => {
    if (session) loadData();
  }, [session]);
  if (authChecking)
    return <div className="auth-loading">Comprobando sesión…</div>;
  if (!session) return <LoginScreen onLogin={(user) => setSession(user)} />;
  return (
    <WarehouseContext.Provider
      value={{
        ...data,
        session,
        refresh: loadData,
        logout: () => {
          localStorage.removeItem("smart_warehouse_token");
          setSession(null);
        },
      }}
    >
      <div className="app-shell">
        <main className="main-area">
          <Header
            onCopilot={() => setCopilot(true)}
            onGuide={() => setGuideOpen(true)}
            session={session}
          />
          <div className="page-content container-fluid">
            <Routes>
              <Route
                path="/"
                element={
                  <IntelligenceDashboard onCopilot={() => setCopilot(true)} />
                }
              />
              <Route path="/anomalias" element={<AnomaliesPage />} />
              <Route path="/anomalias/:id" element={<AnomalyDetailPage />} />
              <Route path="/demanda" element={<DemandPage />} />
              <Route path="/integraciones" element={<Integrations />} />
              <Route path="/faqs" element={<FaqPage />} />
            </Routes>
          </div>
        </main>
        {copilot && <Copilot onClose={() => setCopilot(false)} />}
        {guideOpen && <DemoGuide onClose={() => setGuideOpen(false)} />}
      </div>
    </WarehouseContext.Provider>
  );
}

function LoginScreen({ onLogin }) {
  const [form, setForm] = useState({
    email: "laura.martin@smartwarehouse.local",
    password: "demo1234",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await warehouseService.login(form.email, form.password);
      localStorage.setItem("smart_warehouse_token", result.access_token);
      onLogin(result.user);
    } catch (err) {
      setError(
        "No se pudo iniciar sesión. Comprueba el usuario y la contraseña.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">
          <i className="bi bi-boxes" />
        </div>
        <h1>
          smart<span>warehouse</span>
        </h1>
        <p>Acceso al centro de control</p>
        <label className="form-label">Correo corporativo</label>
        <input
          className="form-control"
          type="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          required
        />
        <label className="form-label mt-3">Contraseña</label>
        <input
          className="form-control"
          type="password"
          value={form.password}
          onChange={(event) =>
            setForm({ ...form, password: event.target.value })
          }
          required
        />
        {error && <div className="alert alert-danger mt-3">{error}</div>}
        <button className="btn-main w-100 mt-4" disabled={saving}>
          {saving ? "Entrando…" : "Entrar"}
        </button>
        <small className="text-muted d-block mt-3">
          Demo local: laura.martin@smartwarehouse.local · demo1234
        </small>
      </form>
    </div>
  );
}

function Header({ onCopilot, onGuide, session }) {
  const location = useLocation();
  const { logout } = useWarehouseData();
  const title =
    nav.find((x) => x.to === location.pathname)?.label ||
    "Detalle de operación";
  const moreActive = nav
    .slice(4)
    .some((item) => location.pathname.startsWith(item.to));
  return (
    <header className={`topbar ${location.pathname === "/" ? "dashboard-topbar" : ""}`}>
      <div className="container-fluid topbar-inner">
        <NavLink to="/" className="top-brand">
          <span className="brand-mark"><i className="bi bi-boxes" /></span>
          <span>
            <strong>smart<span>warehouse</span></strong>
            <small>{session?.role || "INTELLIGENCE PLATFORM"}</small>
          </span>
        </NavLink>
        <div className="top-context">
          <span>Smart Warehouse</span>
          <i className="bi bi-chevron-right" />
          <strong>{title}</strong>
        </div>
        <nav className="top-menu nav nav-pills">
          {nav.slice(0, 4).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
              <i className={`bi ${item.icon}`} />
              <span>{item.label}</span>
              {item.count && <em>{item.count}</em>}
            </NavLink>
          ))}
          <details className={`top-dropdown ${moreActive ? "active" : ""}`}>
            <summary className="nav-link"><i className="bi bi-three-dots" /><span>Más</span><i className="bi bi-chevron-down dropdown-chevron" /></summary>
            <div className="dropdown-menu show">
              {nav.slice(4).map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "dropdown-item active" : "dropdown-item"}>
                  <i className={`bi ${item.icon}`} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}
                </NavLink>
              ))}
            </div>
          </details>
        </nav>
        <div className="top-actions">
          <button className="icon-btn" title="Abrir guía de la demo" onClick={onGuide}><i className="bi bi-question-circle" /></button>
          <button className="icon-btn notification" title="Notificaciones"><i className="bi bi-bell" /><b>3</b></button>
          <button className="copilot-btn" onClick={onCopilot}><i className="bi bi-stars" /> Copilot</button>
          <button className="icon-btn" title="Cerrar sesión" onClick={logout}><i className="bi bi-box-arrow-right" /></button>
        </div>
      </div>
    </header>
  );
}

const PageTitle = ({ eyebrow, title, children }) => (
  <div className="page-title">
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
    </div>
    <div className="page-actions">{children}</div>
  </div>
);
const Button = ({ children, primary = false, ...props }) => (
  <button className={primary ? "btn-main" : "btn-ghost"} {...props}>
    {children}
  </button>
);
const Risk = ({ risk }) => (
  <span className={`risk risk-${risk}`}>
    <i className="bi bi-circle-fill" />
  </span>
);
const Status = ({ children, tone = "neutral" }) => (
  <span className={`status status-${tone}`}>{children}</span>
);

function IntelligenceDashboard({ onCopilot }) {
  const { orders, stock, integrations } = useWarehouseData();
  const [ai, setAi] = useState({
    anomalies: [],
    suggestions: [],
    demand: null,
    suppliers: [],
    sandbox: null,
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    Promise.allSettled([
      warehouseService.aiAnomalies(),
      warehouseService.aiSuggestions(),
      warehouseService.aiDemand(),
      warehouseService.aiSupplierComparison?.(),
      warehouseService.sandboxSnapshot(),
    ])
      .then((results) => {
        const value = (index) =>
          results[index].status === "fulfilled" ? results[index].value : null;
        const anomalyRecords = recordAnomalyAnalysis(value(0)?.findings || []);
        setAi({
          anomalies: anomalyRecords.map((record) => ({
            ...record.finding,
            anomalyId: record.id,
            anomalyStatus: record.status,
          })),
          suggestions: value(1)?.suggestions || [],
          demand: value(2),
          suppliers: value(3)?.ranking || [],
          sandbox: value(4),
        });
      })
      .finally(() => setLoading(false));
  }, []);
  const runAnomalies = async () => {
    setLoading(true);
    try {
      const result = await warehouseService.runAIAnomalies();
      const anomalyRecords = recordAnomalyAnalysis(result.findings || [], true);
      setAi((current) => ({
        ...current,
        anomalies: anomalyRecords.map((record) => ({
          ...record.finding,
          anomalyId: record.id,
          anomalyStatus: record.status,
        })),
      }));
      setMessage("Análisis ejecutado y registrado en auditoría.");
    } catch (error) {
      setMessage(error.message || "No se pudo ejecutar el análisis");
    } finally {
      setLoading(false);
    }
  };
  const connected = integrations.filter(
    (item) => item.health?.status === "available",
  ).length;
  return (
    <div className="intelligence-shell">
      <main className="intelligence-main">
        <PageTitle eyebrow="INTELIGENCIA OPERATIVA" title="Resumen IA">
          <Button onClick={runAnomalies} disabled={loading}>
            <i className="bi bi-stars" />{" "}
              {loading ? "Analizando…" : "Analizar ahora"}
          </Button>
          <Button primary onClick={onCopilot}>
            <i className="bi bi-chat-dots" /> Abrir Copilot
          </Button>
        </PageTitle>
        <section className="demo-summary-intro">
          <div className="demo-summary-icon">
            <i className="bi bi-stars" />
          </div>
          <div>
            <strong>Qué estás viendo en esta demo</strong>
            <p>
              Una capa de inteligencia que se conecta a un ERP o WMS existente
              para interpretar su operación. Los datos proceden de la sandbox
              local, que simula productos, inventario, ventas, pedidos y
              proveedores mediante la API <code>/api/v1/sandbox</code>.
            </p>
            <p className="mb-0">
              La aplicación no sustituye al sistema de almacén ni modifica sus
              datos: analiza la información, detecta anomalías, calcula
              previsiones y propone recomendaciones explicables para que un
              usuario las revise.
            </p>
          </div>
        </section>
        {message && <div className="alert alert-info">{message}</div>}
        <section className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-icon danger">
              <i className="bi bi-exclamation-triangle" />
            </div>
            <div>
              <span>Anomalías detectadas</span>
              <strong>{ai.anomalies.length}</strong>
              <small>explicables y auditadas</small>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon warning">
              <i className="bi bi-lightbulb" />
            </div>
            <div>
              <span>Recomendaciones</span>
              <strong>{ai.suggestions.length}</strong>
              <small>pendientes de revisión</small>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon info">
              <i className="bi bi-graph-up-arrow" />
            </div>
            <div>
              <span>Previsión próxima</span>
              <strong>{ai.demand?.forecast_quantity || 0}</strong>
              <small>unidades · próximos 30 días</small>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon success">
              <i className="bi bi-plug" />
            </div>
            <div>
              <span>Conectores activos</span>
              <strong>{connected}</strong>
              <small>
                {ai.sandbox
                  ? "sandbox local disponible"
                  : "comprobando conexión"}
              </small>
            </div>
          </div>
        </section>
        <section className="panel intelligence-anomalies-panel">
            <PanelHead
              title="Anomalías prioritarias"
              subtitle="Qué se desvía, por qué ocurre y qué conviene revisar"
            />
            {ai.anomalies.slice(0, 5).map((item) => (
              <NavLink className="anomaly-row anomaly-detail-link" key={item.anomalyId} to={`/anomalias/${encodeURIComponent(item.anomalyId || item.order_id || item.sku)}`}>
                <div className="anomaly-summary">
                  <Risk risk={item.risk} />
                  <div>
                  <strong>{item.product || item.sku}</strong>
                  <span>
                    {item.order_id} · {item.reasons?.[0]}
                  </span>
                  </div>
                </div>
                <div className="anomaly-recommendation">
                  <small>Sugerencia de IA</small>
                  <span>{item.suggestion || "Revisar antes de aprobar."}</span>
                </div>
                <Status tone={item.severity === "critical" ? "danger" : "warning"}>
                    {item.severity === "critical" ? "Crítica" : "Revisar"}
                </Status>
              </NavLink>
            ))}
            {!loading && !ai.anomalies.length && (
              <p className="text-muted mb-0">
                No se han detectado anomalías con los datos actuales.
              </p>
            )}
        </section>
        <section className="panel">
          <PanelHead
            title="Capa de integración"
            subtitle="Datos recibidos desde el software externo simulado"
          />
          <div className="detail-metrics">
            <div>
              <span>Productos sincronizados</span>
              <strong>{ai.sandbox?.products?.length || stock.length}</strong>
            </div>
            <div>
              <span>Inventario</span>
              <strong>
                {ai.sandbox?.inventory?.length || stock.length} referencias
              </strong>
            </div>
            <div>
              <span>Pedidos importados</span>
              <strong>
                {ai.sandbox?.purchase_orders?.length || orders.length}
              </strong>
            </div>
            <div>
              <span>Contrato API</span>
              <strong>/api/v1/sandbox</strong>
            </div>
          </div>
          <p className="text-muted mb-0 mt-3">
            Esta aplicación no sustituye al ERP/WMS: interpreta sus datos y
            devuelve alertas y recomendaciones.
          </p>
        </section>
      </main>
      <DemoSidebar />
    </div>
  );
}

function AnomaliesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const load = async (run) => {
    setLoading(true);
    try {
      const result = run
        ? await warehouseService.runAIAnomalies()
        : await warehouseService.aiAnomalies();
      setItems(recordAnomalyAnalysis(result.findings || [], run));
      if (run) setMessage("Análisis ejecutado y guardado en auditoría.");
    } catch (error) {
      setMessage(error.message || "No se pudieron cargar las anomalías");
    } finally {
      setLoading(false);
    }
  };
  const resolve = (record) => {
    updateAnomalyStatus(record.id);
    setItems((current) =>
      current.map((item) =>
        item.id === record.id
          ? { ...item, status: "resolved", resolvedAt: new Date().toISOString() }
          : item,
      ),
    );
  };
  useEffect(() => {
    load(false);
  }, []);
  return (
    <>
      <PageTitle eyebrow="INTELIGENCIA / DETECCIÓN" title="Anomalías">
        <Button primary onClick={() => load(true)} disabled={loading}>
          <i className="bi bi-stars" />{" "}
          {loading ? "Analizando…" : "Analizar ahora"}
        </Button>
      </PageTitle>
      <div className="alert alert-info">
        <i className="bi bi-info-circle me-2" />
        Detectamos desviaciones de volumen, precio y demanda. La IA explica cada
        hallazgo; la decisión sigue siendo humana.
      </div>
      {message && <div className="alert alert-success">{message}</div>}
      <section className="panel table-panel">
        <div className="table-meta">
          <span>
            <strong>{items.length}</strong> anomalías encontradas ·{" "}
            <strong>{items.filter((item) => item.status === "resolved").length}</strong> resueltas
          </span>
          <span className="muted">Motor local determinista</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>SEVERIDAD</th>
              <th>PRODUCTO</th>
              <th>PEDIDO</th>
              <th>QUÉ HA DETECTADO LA IA</th>
              <th>PROPUESTA</th>
              <th>ESTADO</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((record) => {
              const item = record.finding;
              const key = record.id;
              const isResolved = record.status === "resolved";
              return <tr key={key} className={`anomaly-table-row ${isResolved ? "anomaly-resolved" : ""}`} onClick={() => navigate(`/anomalias/${encodeURIComponent(key)}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") navigate(`/anomalias/${encodeURIComponent(key)}`); }} tabIndex="0" role="link">
                <td>
                  <Status
                    tone={item.severity === "critical" ? "danger" : "warning"}
                  >
                    {item.severity === "critical" ? "Crítica" : "Aviso"}
                  </Status>
                </td>
                <td>
                  <NavLink className="anomaly-detail-link" to={`/anomalias/${encodeURIComponent(key)}`}><strong>{item.product || item.sku}</strong></NavLink>
                  <small>{item.sku}</small>
                </td>
                <td>{item.order_id}</td>
                <td>
                  {item.reasons?.map((reason) => (
                    <small className="d-block" key={reason}>
                      {reason}
                    </small>
                  ))}
                </td>
                <td>{item.suggestion}</td>
                <td><Status tone={isResolved ? "success" : "warning"}>{isResolved ? "Resuelta" : "Pendiente"}</Status></td>
                <td>{!isResolved && <button className="text-link anomaly-resolve-button" onClick={(event) => { event.stopPropagation(); resolve(record); }}>Resolver</button>}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {!loading && !items.length && (
          <p className="text-muted p-3 mb-0">
            No hay anomalías con los datos actuales.
          </p>
        )}
      </section>
    </>
  );
}

function AnomalyDetailPage() {
  const { id } = useParams();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const key = decodeURIComponent(id);
  useEffect(() => {
    setRecord(findAnomalyRecord(key) || null);
    setLoading(false);
  }, [key]);
  const resolve = () => {
    const updated = updateAnomalyStatus(key);
    if (updated) setRecord(updated);
  };
  if (loading) return <section className="panel"><h3>Cargando detalle de la anomalía…</h3></section>;
  if (!record) return <section className="panel"><NavLink to="/anomalias"><i className="bi bi-arrow-left" /> Volver a anomalías</NavLink><h3 className="mt-4">Anomalía no encontrada</h3><p className="text-muted">Esta ficha histórica puede no existir en este navegador o se ha borrado su almacenamiento local.</p></section>;
  const item = record.finding;
  const resolved = record.status === "resolved";
  const severity = item.severity === "critical" ? "Crítica" : "Aviso";
  return <><div className="detail-back"><NavLink to="/anomalias"><i className="bi bi-arrow-left" /> Volver a anomalías</NavLink></div><PageTitle eyebrow="INTELIGENCIA / ANOMALÍA" title={item.product || item.sku}>{!resolved && <Button primary onClick={resolve}><i className="bi bi-check2-circle" /> Resolver</Button>}<Status tone={resolved ? "success" : item.severity === "critical" ? "danger" : "warning"}>{resolved ? "Resuelta" : severity}</Status></PageTitle><div className="alert alert-info"><i className="bi bi-info-circle me-2" />Esta ficha histórica permanece disponible aunque la anomalía se resuelva. Si vuelve a detectarse en otro análisis, se creará otra ficha con otro identificador. La IA no modifica el ERP/WMS.</div><div className="detail-grid"><section className="panel"><PanelHead title="Qué ha detectado la IA" subtitle="Comparación con el comportamiento esperado" /><div className="anomaly-detail-reasons">{(item.reasons || []).map(reason => <div key={reason}><i className="bi bi-exclamation-triangle" /><span>{reason}</span></div>)}</div><div className="detail-metrics mt-4"><div><span>Identificador</span><strong>{record.id}</strong></div><div><span>Producto</span><strong>{item.product || "—"}</strong></div><div><span>SKU</span><strong>{item.sku || "—"}</strong></div><div><span>Pedido</span><strong>{item.order_id || "—"}</strong></div><div><span>Severidad</span><Status tone={item.severity === "critical" ? "danger" : "warning"}>{severity}</Status></div></div></section><section className="panel"><PanelHead title="Interpretación y siguiente paso" subtitle="La recomendación debe revisarse antes de actuar" /><div className="anomaly-detail-callout"><i className="bi bi-lightbulb" /><div><strong>Sugerencia de IA</strong><p>{item.suggestion || "Revisar el pedido antes de aprobarlo."}</p></div></div><h4 className="mt-4">Qué debería comprobar el usuario</h4><ul className="anomaly-detail-list"><li>Confirmar que el volumen solicitado es necesario.</li><li>Comparar el precio con el histórico y las ofertas del proveedor.</li><li>Revisar la previsión de demanda y el stock disponible.</li><li>Resolver la anomalía solo cuando la decisión haya sido atendida.</li></ul></section></div><section className="panel"><PanelHead title="Datos utilizados" subtitle="Origen y límites del análisis" /><p className="mb-2">El hallazgo se calcula con datos recibidos desde la sandbox local: pedidos, productos, inventario, demanda histórica y proveedores.</p><p className="text-muted mb-0">Motor actual: análisis determinista local. En producción podrá sustituirse por otro proveedor de IA sin cambiar esta ficha.</p></section></>;
}

function DemandPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    warehouseService
      .aiDemand()
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="INTELIGENCIA / PLANIFICACIÓN"
        title="Predicción de demanda"
      >
        <Button
          onClick={() => {
            setLoading(true);
            warehouseService
              .aiDemand()
              .then(setResult)
              .finally(() => setLoading(false));
          }}
          disabled={loading}
        >
          <i className="bi bi-arrow-repeat" /> Actualizar previsión
        </Button>
      </PageTitle>
      <div className="alert alert-info">
        <i className="bi bi-lightbulb me-2" />
        La previsión se calcula con los datos sincronizados del ERP/WMS y
        muestra el método utilizado.
      </div>
      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon info">
            <i className="bi bi-graph-up-arrow" />
          </div>
          <div>
            <span>Próximos 30 días</span>
            <strong>{result?.forecast_quantity || 0}</strong>
            <small>unidades previstas</small>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon success">
            <i className="bi bi-cpu" />
          </div>
          <div>
            <span>Método</span>
            <strong>Local</strong>
            <small>sin modelo externo</small>
          </div>
        </div>
      </section>
      <section className="panel">
        <PanelHead
          title="Cómo se ha calculado"
          subtitle={result?.method || "Cargando…"}
        />
        <p className="mb-0">
          {result?.explanation ||
            "Estamos obteniendo la previsión desde la capa de integración."}
        </p>
      </section>
      <section className="panel table-panel">
        <div className="table-meta">
          <strong>Histórico utilizado</strong>
          <span className="muted">Mes · unidades solicitadas</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>MES</th>
              <th>UNIDADES</th>
            </tr>
          </thead>
          <tbody>
            {(result?.historical_months || []).map((item) => (
              <tr key={item.month}>
                <td>{item.month}</td>
                <td>
                  <strong>{item.quantity}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function RecommendationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    warehouseService
      .aiSuggestions()
      .then((result) => setItems(result.suggestions || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <PageTitle eyebrow="INTELIGENCIA / DECISIONES" title="Recomendaciones">
        <Button
          onClick={() => {
            setLoading(true);
            warehouseService
              .aiSuggestions()
              .then((result) => setItems(result.suggestions || []))
              .finally(() => setLoading(false));
          }}
          disabled={loading}
        >
          <i className="bi bi-arrow-repeat" /> Actualizar
        </Button>
      </PageTitle>
      <div className="alert alert-warning">
        <i className="bi bi-person-check me-2" />
        Estas propuestas no ejecutan cambios automáticamente. Un usuario debe
        revisarlas y aprobarlas.
      </div>
      <section className="panel">
        <PanelHead
          title="Pendientes de revisión"
          subtitle={`${items.length} recomendaciones generadas por la IA`}
        />
        {items.map((item, index) => (
          <div className="receiving-row" key={`${item.sku}-${index}`}>
            <div className="validation-icon warning">
              <i className="bi bi-lightbulb" />
            </div>
            <div>
              <strong>{item.sku || "Operación general"}</strong>
              <span>{item.message}</span>
              <small className="d-block text-muted">
                Motivo: {item.reason}
              </small>
            </div>
            <button className="btn-ghost">Revisar</button>
          </div>
        ))}
        {!loading && !items.length && (
          <p className="text-muted mb-0">No hay recomendaciones pendientes.</p>
        )}
      </section>
    </>
  );
}

function DemoGuide({ onClose }) {
  return (
    <ModalShell
      title="Cómo funciona esta demo"
      icon="bi-question-circle"
      onClose={onClose}
      footer={
        <button className="btn-main" onClick={onClose}>
          Empezar recorrido
        </button>
      }
    >
      <div className="demo-guide">
        <div className="alert alert-info">
          <strong>Smart Warehouse Intelligence</strong>
          <p className="mb-0 mt-1">
            Esta aplicación añade inteligencia a un ERP o WMS existente. No
            pretende sustituirlo.
          </p>
        </div>
        <div className="demo-guide-step">
          <span>1</span>
          <div>
            <strong>Conecta los datos</strong>
            <p>
              La sandbox simula el software de almacén y expone productos,
              inventario, ventas, pedidos y proveedores.
            </p>
            <code>GET /api/v1/sandbox</code>
          </div>
        </div>
        <div className="demo-guide-step">
          <span>2</span>
          <div>
            <strong>Analiza la operación</strong>
            <p>
              En <b>Anomalías</b> busca desviaciones de volumen, precio y
              demanda. En <b>Demanda</b> calcula una previsión usando el
              histórico local.
            </p>
          </div>
        </div>
        <div className="demo-guide-step">
          <span>3</span>
          <div>
            <strong>Pregunta al Copilot</strong>
            <p>
              Consulta inventario, proveedores, alertas y riesgos con datos
              reales de la sandbox. Las respuestas indican sus fuentes.
            </p>
          </div>
        </div>
        <div className="demo-guide-note">
          <i className="bi bi-arrow-repeat" />
          <div>
            <strong>Recorrido recomendado</strong>
            <span>
              Resumen IA → Anomalías → Demanda → Integraciones
            </span>
          </div>
        </div>
        <small className="text-muted d-block mt-3">
          Para probarlo localmente: arranca FastAPI en el puerto 8000, inicia el
          frontend y pulsa “Analizar ahora”.
        </small>
      </div>
    </ModalShell>
  );
}

function DemoSidebar() {
  return (
    <aside className="demo-sidebar">
      <div className="demo-sidebar-head">
        <div className="ai-spark">
          <i className="bi bi-compass" />
        </div>
        <div>
          <strong>Guía rápida</strong>
        </div>
      </div>
      <div className="demo-action">
        <div className="demo-action-button">
          <i className="bi bi-stars" />
          <span>
            <strong>Analizar ahora</strong>
            <small>
              Revisa los datos sincronizados y busca patrones anómalos de
              volumen, precio, stock y demanda.
            </small>
          </span>
        </div>
      </div>
      <div className="demo-action">
        <div className="demo-action-button">
          <i className="bi bi-chat-dots" />
          <span>
            <strong>Abrir Copilot</strong>
            <small>
              Consulta la operación con preguntas en lenguaje natural y recibe
              respuestas con sus fuentes.
            </small>
          </span>
        </div>
      </div>
      <div className="demo-sitemap">
        <strong>Sitemap de la demo</strong>
        <div>
          <i className="bi bi-grid-1x2" />
          <span>
            <strong>Resumen IA</strong>
            <small>
              Vista ejecutiva del estado general, riesgos, recomendaciones y
              conexiones activas.
            </small>
          </span>
        </div>
        <div>
          <i className="bi bi-exclamation-triangle" />
          <span>
            <strong>Anomalías</strong>
            <small>
              Explica qué se desvía del comportamiento esperado y por qué
              requiere revisión.
            </small>
          </span>
        </div>
        <div>
          <i className="bi bi-graph-up-arrow" />
          <span>
            <strong>Demanda</strong>
            <small>
              Estima qué puede ocurrir próximamente usando el histórico
              disponible.
            </small>
          </span>
        </div>
        <div>
          <i className="bi bi-diagram-3" />
          <span>
            <strong>Integraciones</strong>
            <small>
              Indica de dónde vienen los datos y si el ERP/WMS está disponible.
            </small>
          </span>
        </div>
      </div>
      <div className="demo-faqs">
        <div className="demo-faqs-heading">
          <i className="bi bi-question-circle" />
          <strong>FAQs de la integración</strong>
        </div>
        <p>
          Respuestas rápidas sobre el origen de los datos y la conexión con el
          ERP/WMS.
        </p>
        <NavLink className="demo-faq-link" to="/faqs">
          Ver preguntas frecuentes <i className="bi bi-arrow-right" />
        </NavLink>
      </div>
      <div className="demo-sidebar-foot">
        <i className="bi bi-shield-check" />
        <span>
          La IA recomienda. El usuario decide y el ERP/WMS sigue siendo la
          fuente oficial.
        </span>
      </div>
    </aside>
  );
}

function FaqPage() {
  const faqs = [
    {
      question: "¿De dónde proceden los datos de esta demo?",
      answer:
        "Proceden de una sandbox local que simula un ERP/WMS: productos, inventario, ventas, pedidos, proveedores y movimientos. Se consultan mediante la API de ejemplo /api/v1/sandbox.",
    },
    {
      question: "¿Cómo se conecta la aplicación al ERP?",
      answer:
        "La capa de inteligencia consume un conector con contrato API. En esta demo el conector apunta a FastAPI en localhost; en producción se sustituye por el endpoint, credenciales y formato del ERP o WMS de cada empresa.",
    },
    {
      question: "¿La aplicación modifica el stock o los pedidos?",
      answer:
        "No. La aplicación lee y normaliza datos, calcula análisis y presenta alertas explicables. El ERP/WMS sigue siendo la fuente oficial y cualquier acción debe confirmarla un usuario o integrarse explícitamente mediante una operación autorizada.",
    },
    {
      question: "¿Qué ocurre cuando conectemos un ERP real?",
      answer:
        "Se mantiene la misma interfaz de inteligencia. Solo cambia el adaptador de entrada: puede ser una API REST, una exportación programada, un webhook o un conector específico. Los datos se transforman al modelo normalizado antes del análisis.",
    },
    {
      question: "¿La IA usa datos reales o de prueba?",
      answer:
        "En esta demo usa datos de prueba locales y un motor determinista para que el resultado sea reproducible. Más adelante se puede conectar un proveedor de IA a demanda, manteniendo la trazabilidad de los datos utilizados.",
    },
  ];
  return (
    <>
      <PageTitle eyebrow="GUÍA / INTEGRACIÓN" title="Preguntas frecuentes" />
      <div className="alert alert-info">
        <i className="bi bi-info-circle me-2" />
        Esta sección explica cómo entra la información en la aplicación y qué
        límites tiene la demo frente a un ERP o WMS corporativo.
      </div>
      <section className="panel faq-panel">
        {faqs.map((faq) => (
          <article className="faq-item" key={faq.question}>
            <h3>{faq.question}</h3>
            <p>{faq.answer}</p>
          </article>
        ))}
      </section>
    </>
  );
}

function Dashboard({ onNewOrder }) {
  const { kpis, orders, events } = useWarehouseData();
  const primaryOrder =
    orders.find((order) => order.risk === "red") || orders[0];
  return (
    <>
      <PageTitle
        eyebrow="CENTRO DE CONTROL · 25 SEP 2025"
        title="Vista general"
      >
        <Button>
          <i className="bi bi-calendar3" /> Hoy, 25 sep 2025
        </Button>
        <Button primary onClick={onNewOrder}>
          <i className="bi bi-plus-lg" /> Nuevo pedido
        </Button>
      </PageTitle>
      <section className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi-card" key={k.label}>
            <div className={`kpi-icon ${k.tone}`}>
              <i className={`bi ${k.icon}`} />
            </div>
            <div>
              <span>{k.label}</span>
              <strong>{k.value}</strong>
              <small
                className={k.tone === "danger" ? "text-danger" : "text-success"}
              >
                <i
                  className={`bi ${k.tone === "danger" ? "bi-exclamation-circle" : "bi-arrow-up-right"}`}
                />{" "}
                {k.change}
              </small>
            </div>
          </div>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel panel-orders">
          <PanelHead
            title="Cola de validación"
            subtitle="Pedidos que requieren decisión"
            action="Ver todos"
          />
          {orders.slice(0, 4).map((order) => (
            <OrderRow order={order} key={order.id} />
          ))}
        </section>
        <section className="panel health-panel">
          <PanelHead
            title="Salud operativa"
            subtitle="Estado del almacén en tiempo real"
          />
          <div className="health-score">
            <div className="score-ring">
              <strong>94</strong>
              <span>/100</span>
            </div>
            <div>
              <strong>Operación saludable</strong>
              <p>Sin bloqueos críticos en el flujo</p>
            </div>
          </div>
          <div className="health-bars">
            <Metric
              label="Pedidos a tiempo"
              value="96,8%"
              width="96%"
              tone="success"
            />
            <Metric
              label="Precisión de stock"
              value="99,1%"
              width="99%"
              tone="info"
            />
            <Metric
              label="Documentación completa"
              value="82,4%"
              width="82%"
              tone="warning"
            />
          </div>
        </section>
      </div>
      <div className="dashboard-grid lower">
        <section className="panel">
          <PanelHead
            title="Actividad reciente"
            subtitle="Eventos del sistema y del motor IA"
            action="Ver registro"
          />{" "}
          <div className="event-list">
            {events.slice(0, 4).map((e) => (
              <EventRow event={e} key={e.time} />
            ))}
          </div>
        </section>
        <section className="panel insight-panel">
          <div className="insight-head">
            <div className="ai-spark">
              <i className="bi bi-stars" />
            </div>
            <div>
              <div className="eyebrow">INSIGHT DEL COPILOT</div>
              <h3>Hay una decisión pendiente</h3>
            </div>
          </div>
          <p>
            {primaryOrder ? (
              <>
                El pedido <strong>{primaryOrder.id}</strong> presenta una señal
                que requiere revisión: {primaryOrder.reason}.
              </>
            ) : (
              "Sin decisiones pendientes en este momento."
            )}
          </p>
          <button className="text-link">
            Revisar recomendación <i className="bi bi-arrow-right" />
          </button>
        </section>
      </div>
    </>
  );
}

function PanelHead({ title, subtitle, action }) {
  return (
    <div className="panel-head">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button className="text-link">
          {action} <i className="bi bi-arrow-up-right" />
        </button>
      )}
    </div>
  );
}
function OrderRow({ order }) {
  return (
    <div className="order-row">
      <Risk risk={order.risk} />
      <div className="order-main">
        <strong>{order.id}</strong>
        <span>{order.product}</span>
      </div>
      <div className="order-requester">
        {order.requester}
        <small>
          {order.qty} uds. · {order.total}
        </small>
      </div>
      <Status
        tone={
          order.risk === "green"
            ? "success"
            : order.risk === "red"
              ? "danger"
              : "warning"
        }
      >
        {order.status}
      </Status>
      <i className="bi bi-chevron-right row-chevron" />
    </div>
  );
}
function Metric({ label, value, width, tone }) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="progress">
        <div className={`progress-bar bg-${tone}`} style={{ width }} />
      </div>
    </div>
  );
}
function EventRow({ event, onOpen }) {
  return (
    <div className="event-row">
      <span className={`event-dot ${event.tone}`} />
      <div>
        <div>
          <strong>{event.text}</strong>
          <small>
            {event.time} · {event.type}
          </small>
        </div>
        <p>{event.detail}</p>
      </div>
      {onOpen && (
        <button className="text-link" onClick={() => onOpen(event)}>
          Detalle
        </button>
      )}
    </div>
  );
}

function Orders({ onNewOrder, onImport, onCompleteProcedure }) {
  const { orders, refresh } = useWarehouseData();
  useEffect(() => {
    refresh().catch(() => {});
  }, []);
  return (
    <>
      <PageTitle eyebrow="OPERACIONES / COMPRAS" title="Pedidos y validación">
        <Button onClick={onImport}>
          <i className="bi bi-file-earmark-spreadsheet" /> Importar plantilla
        </Button>
        <Button primary onClick={onNewOrder}>
          <i className="bi bi-plus-lg" /> Crear pedido
        </Button>
      </PageTitle>
      <div className="filter-bar">
        <div className="search-field">
          <i className="bi bi-search" />
          <input placeholder="Buscar por pedido, producto o empleado..." />
        </div>
        <button>
          Todos los estados <i className="bi bi-chevron-down" />
        </button>
        <button>
          Últimos 30 días <i className="bi bi-chevron-down" />
        </button>
        <span className="filter-spacer" />
        <span className="view-toggle active">
          <i className="bi bi-list" />
        </span>
        <span className="view-toggle">
          <i className="bi bi-grid" />
        </span>
      </div>
      <section className="panel table-panel">
        <div className="table-meta">
          <span>
            <strong>{orders.length}</strong> pedidos en cola
          </span>
          <span className="legend">
            <Risk risk="green" /> Aprobado <Risk risk="yellow" /> Revisar{" "}
            <Risk risk="red" /> Bloqueado
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>RIESGO</th>
              <th>PEDIDO / PRODUCTO</th>
              <th>SOLICITANTE</th>
              <th>IMPORTE</th>
              <th>ESTADO</th>
              <th>FECHA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Risk risk={o.risk} />
                </td>
                <td>
                  <NavLink className="order-link" to={`/pedidos/${o.id}`}>
                    <strong>
                      {o.id}
                      {o.title ? ` · ${o.title}` : ""}
                    </strong>
                    <small>{o.product}</small>
                  </NavLink>
                </td>
                <td>
                  {o.requester}
                  <small>{o.area}</small>
                </td>
                <td>
                  <strong>{o.total}</strong>
                  <small>{o.qty} unidades</small>
                </td>
                <td>
                  <Status
                    tone={
                      o.risk === "green"
                        ? "success"
                        : o.risk === "red"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {o.status}
                  </Status>
                  <small className="reason">{o.reason}</small>
                </td>
                <td className="muted">{o.date}</td>
                <td>
                  <button
                    className="more"
                    title="Completar documento obligatorio"
                    onClick={() => onCompleteProcedure(o)}
                  >
                    <i className="bi bi-three-dots" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function OrderDetail({ onCompleteProcedure, procedureRefreshKey }) {
  const { orders, refresh } = useWarehouseData();
  const { id } = useParams();
  const [validating, setValidating] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [history, setHistory] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [proceduresLoaded, setProceduresLoaded] = useState(false);
  const [workflowModal, setWorkflowModal] = useState("");
  const order = orders.find((item) => item.id === id);
  useEffect(() => {
    if (order)
      warehouseService
        .orderStatusHistory(id)
        .then(setHistory)
        .catch(() => setHistory([]));
  }, [id, order?.workflowStatus]);
  useEffect(() => {
    setProceduresLoaded(false);
    if (order)
      warehouseService
        .orderProcedures(id)
        .then((items) => {
          setProcedures(items);
          setProceduresLoaded(true);
        })
        .catch(() => {
          setProcedures([]);
          setProceduresLoaded(true);
        });
  }, [id, order?.workflowStatus, procedureRefreshKey]);
  if (!order)
    return (
      <section className="panel">
        <h3>Cargando pedido...</h3>
      </section>
    );
  const nextStatuses = {
    pending: "validated",
    human_review: "validated",
    blocked: "pending",
    validated: "approved",
    approved: "sent_to_supplier",
    sent_to_supplier: "received",
    received: "closed",
  };
  const nextStatus = nextStatuses[order.workflowStatus];
  const allProceduresComplete =
    proceduresLoaded && procedures.every((item) => item.status === "complete");
  const canValidate =
    ["pending", "human_review"].includes(order.workflowStatus) &&
    allProceduresComplete;
  const workflowSteps = [
    { key: "pending", label: "Pendiente" },
    { key: "validated", label: "Validado" },
    { key: "approved", label: "Aprobado" },
    { key: "sent_to_supplier", label: "Enviado a proveedor" },
    { key: "received", label: "Recibido" },
    { key: "closed", label: "Cerrado" },
  ];
  const currentStepIndex = workflowSteps.findIndex(
    (step) => step.key === order.workflowStatus,
  );
  const completedProcedures = procedures.filter(
    (item) => item.status === "complete",
  ).length;
  const labels = {
    validated: "Marcar validado",
    approved: "Aprobar pedido",
    sent_to_supplier: "Enviar a proveedor",
    received: "Marcar recibido",
    closed: "Cerrar pedido",
    pending: "Reabrir pedido",
  };
  const validate = async () => {
    setValidating(true);
    setDecisionMessage("");
    try {
      const result = await warehouseService.validateOrder(id);
      setDecisionMessage(
        `Decisión persistida: ${result.status} · riesgo ${result.risk}.`,
      );
      await refresh();
    } catch (error) {
      setWorkflowModal(error.message || "No se pudo persistir la decisión");
    } finally {
      setValidating(false);
    }
  };
  const transition = async () => {
    setTransitioning(true);
    try {
      const result = await warehouseService.transitionOrderStatus(
        id,
        nextStatus,
        "Cambio realizado desde el centro de control",
      );
      setDecisionMessage(`Pedido actualizado: ${result.status}.`);
      await refresh();
    } catch (error) {
      setWorkflowModal(error.message || "No se pudo cambiar el estado");
    } finally {
      setTransitioning(false);
    }
  };
  return (
    <>
      <div className="detail-back">
        <NavLink to="/pedidos">
          <i className="bi bi-arrow-left" /> Volver a pedidos
        </NavLink>
      </div>
      <PageTitle
        eyebrow={`PEDIDO / ${order.id}`}
        title="Detalle y flujo operativo"
      >
        <Button>
          <i className="bi bi-download" /> Exportar ficha
        </Button>
        {canValidate && (
          <Button onClick={validate} disabled={validating}>
            <i className="bi bi-stars" />{" "}
            {validating ? "Validando..." : "Ejecutar validación"}
          </Button>
        )}
        {(order.workflowStatus === "pending" ||
          order.workflowStatus === "validated" ||
          order.workflowStatus === "human_review") &&
        !allProceduresComplete ? (
          <Button primary onClick={() => onCompleteProcedure?.(order)}>
            <i className="bi bi-shield-plus" /> Completar procedimiento
          </Button>
        ) : (
          order.workflowStatus !== "pending" &&
          nextStatus && (
            <Button primary onClick={transition} disabled={transitioning}>
              <i className="bi bi-arrow-right-circle" />{" "}
              {transitioning ? "Actualizando…" : labels[nextStatus]}
            </Button>
          )
        )}
      </PageTitle>
      <div className="detail-grid">
        <section className="panel">
          <div className="detail-order-head">
            <div className={`risk risk-large risk-${order.risk}`}>
              <i className="bi bi-circle-fill" />
            </div>
            <div>
              <h3>{order.product}</h3>
              <span>
                {order.id}
                {order.title ? ` · ${order.title}` : ""} · creado por{" "}
                {order.requester} · {order.date}
              </span>
            </div>
            <Status
              tone={
                order.workflowStatus === "closed"
                  ? "success"
                  : order.workflowStatus === "blocked"
                    ? "danger"
                    : "warning"
              }
            >
              {order.status}
            </Status>
          </div>
          <div className="detail-metrics">
            <div>
              <span>Cantidad solicitada</span>
              <strong>{order.qty} uds.</strong>
            </div>
            <div>
              <span>Importe total</span>
              <strong>{order.total}</strong>
            </div>
            <div>
              <span>Proveedor</span>
              <strong>{order.supplier || "—"}</strong>
            </div>
            <div>
              <span>Estado de flujo</span>
              <strong>{order.status}</strong>
            </div>
          </div>
          <div className="decision-note">
            <i className="bi bi-info-circle" />
            <div>
              <strong>Estado persistido en MySQL</strong>
              <p>{decisionMessage || order.reason}</p>
            </div>
          </div>
        </section>
        <section className="panel validation-panel">
          <PanelHead
            title="Flujo completo"
            subtitle="Transiciones controladas por API"
          />
          <div className="workflow-documents">
            <div>
              <strong>Documentación obligatoria</strong>
              <span>
                {procedures.length
                  ? `${completedProcedures}/${procedures.length} completados`
                  : proceduresLoaded
                    ? "Sin documentos requeridos"
                    : "Cargando…"}
              </span>
            </div>
            <div className="workflow-document-bar">
              <div
                style={{
                  width: `${procedures.length ? (completedProcedures / procedures.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          {workflowSteps.map((step, index) => (
            <ValidationRow
              key={step.key}
              icon={
                index < currentStepIndex
                  ? "bi-check-circle-fill"
                  : index === currentStepIndex
                    ? "bi-record-circle"
                    : "bi-circle"
              }
              title={step.label}
              value={
                index < currentStepIndex
                  ? "Completado"
                  : index === currentStepIndex
                    ? "Paso actual"
                    : "Pendiente"
              }
              status={
                index < currentStepIndex
                  ? "success"
                  : index === currentStepIndex
                    ? "warning"
                    : "info"
              }
              detail={
                index === currentStepIndex
                  ? "Completa la acción indicada arriba"
                  : index < currentStepIndex
                    ? "Registrado en el historial"
                    : "Se habilitará al completar el paso anterior"
              }
            />
          ))}
        </section>
      </div>
      <section className="panel timeline-panel">
        <PanelHead
          title="Historial del pedido"
          subtitle="Cambios de estado y trazabilidad"
        />
        {history.map((item) => (
          <div className="receiving-row" key={item.id}>
            <div className="time-block">
              <strong>{item.to_status}</strong>
              <small>
                {item.created_at
                  ? new Date(item.created_at).toLocaleString("es-ES")
                  : "—"}
              </small>
            </div>
            <div>
              <strong>
                {item.from_status || "Inicio"} → {item.to_status}
              </strong>
              <span>{item.reason || "Sin motivo"}</span>
            </div>
            <span className="muted">{item.created_by || "Sistema"}</span>
          </div>
        ))}
      </section>
      <WorkflowNoticeModal
        message={workflowModal}
        onClose={() => setWorkflowModal("")}
      />
    </>
  );
}
function ValidationRow({ icon, title, value, status, detail }) {
  const purposes = {
    Pendiente:
      "Pedido creado; aquí se completa la documentación seleccionada antes de validar.",
    Validado:
      "Las reglas y documentos han sido comprobados; ya se puede autorizar la compra.",
    Aprobado:
      "La compra ha sido autorizada por un responsable y puede enviarse al proveedor.",
    "Enviado a proveedor":
      "La orden se ha comunicado al proveedor; ahora esperamos la entrega física.",
    Recibido:
      "La mercancía ha sido comprobada en almacén; queda conciliar la factura.",
    Cerrado:
      "Pedido, recepción y factura están conciliados; el ciclo ha terminado.",
  };
  return (
    <div className="validation-row">
      <div className={`validation-icon ${status}`}>
        <i className={`bi ${icon}`} />
      </div>
      <div>
        <strong>{title}</strong>
        <span>{purposes[title] || detail}</span>
      </div>
      <div className="validation-result">
        <Status tone={status}>{value}</Status>
        <Risk
          risk={
            status === "success"
              ? "green"
              : status === "danger"
                ? "red"
                : "yellow"
          }
        />
      </div>
    </div>
  );
}
function WorkflowNoticeModal({ message, onClose }) {
  if (!message) return null;
  return (
    <ModalShell
      title="Paso no disponible"
      icon="bi-shield-exclamation"
      onClose={onClose}
      footer={
        <button className="btn-main" onClick={onClose}>
          Entendido
        </button>
      }
    >
      <div className="alert alert-warning mb-0">
        <i className="bi bi-info-circle me-2" />
        {message}
      </div>
      <p className="text-muted mt-3 mb-0">
        Completa el paso anterior del circuito y vuelve a intentarlo.
      </p>
    </ModalShell>
  );
}

function Stock() {
  const { stock, movements, refresh } = useWarehouseData();
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("all");
  const lowStock = stock.filter((item) => item.status === "Reponer").length;
  const filteredMovements = movements.filter(
    (item) => sku === "all" || item.sku === sku,
  );
  return (
    <>
      <PageTitle
        eyebrow="OPERACIONES / INVENTARIO"
        title="Stock y disponibilidad"
      >
        <Button>
          <i className="bi bi-upload" /> Importar plantilla
        </Button>
        <Button primary onClick={() => setOpen(true)}>
          <i className="bi bi-arrow-left-right" /> Registrar movimiento
        </Button>
      </PageTitle>
      <div className="stock-summary">
        <div>
          <span>Referencias activas</span>
          <strong>{stock.length}</strong>
          <small>datos MySQL</small>
        </div>
        <div>
          <span>Movimientos registrados</span>
          <strong>{movements.length}</strong>
          <small>histórico API</small>
        </div>
        <div>
          <span>Por debajo de mínimo</span>
          <strong className="danger-number">{lowStock}</strong>
          <small>calculado por API</small>
        </div>
        <div>
          <span>Exactitud inventario</span>
          <strong>—</strong>
          <small>pendiente de inventario físico</small>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-meta">
          <span>
            <strong>Inventario principal</strong> · {stock.length} referencias
          </span>
          <div className="search-field compact">
            <i className="bi bi-search" />
            <input placeholder="Filtrar SKU..." />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>PRODUCTO</th>
              <th>CATEGORÍA</th>
              <th>STOCK</th>
              <th>DEMANDA</th>
              <th>UBICACIÓN</th>
              <th>ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => (
              <tr key={s.sku}>
                <td>
                  <strong className="sku">{s.sku}</strong>
                </td>
                <td>
                  <strong>{s.product}</strong>
                  <small>Origen: MySQL</small>
                </td>
                <td>{s.category}</td>
                <td>
                  <strong>{s.stock.toLocaleString("es-ES")}</strong>
                  <small>Mín. {s.min}</small>
                </td>
                <td>
                  <span className={`demand demand-${s.demand.toLowerCase()}`}>
                    <i className="bi bi-graph-up" /> {s.demand}
                  </span>
                </td>
                <td className="muted">
                  <i className="bi bi-geo-alt" /> {s.location}
                </td>
                <td>
                  <Status tone={s.status === "Óptimo" ? "success" : "warning"}>
                    {s.status}
                  </Status>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel table-panel">
        <div className="table-meta">
          <span>
            <strong>Historial de movimientos</strong> ·{" "}
            {filteredMovements.length} registros
          </span>
          <select value={sku} onChange={(event) => setSku(event.target.value)}>
            <option value="all">Todos los SKU</option>
            {stock.map((item) => (
              <option value={item.sku} key={item.sku}>
                {item.sku}
              </option>
            ))}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>FECHA</th>
              <th>SKU</th>
              <th>TIPO</th>
              <th>CANTIDAD</th>
              <th>RESERVA</th>
              <th>STOCK RESULTANTE</th>
              <th>REFERENCIA</th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.slice(0, 20).map((item) => (
              <tr key={item.id}>
                <td className="muted">
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString("es-ES")
                    : "—"}
                </td>
                <td>
                  <strong className="sku">{item.sku}</strong>
                </td>
                <td>
                  <Status
                    tone={
                      item.movement_type === "exit"
                        ? "danger"
                        : item.movement_type === "reserve"
                          ? "warning"
                          : "success"
                    }
                  >
                    {item.movementLabel}
                  </Status>
                </td>
                <td>{item.quantityLabel}</td>
                <td>{item.reservedLabel}</td>
                <td>
                  <strong>{item.resulting_quantity}</strong>{" "}
                  <small>({item.resulting_reserved_quantity} reservadas)</small>
                </td>
                <td>{item.reference_id || item.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {open && (
        <StockMovementModal
          stock={stock}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function StockMovementModal({ stock, onClose, onSaved }) {
  const [form, setForm] = useState({
    sku: "",
    movement_type: "entry",
    quantity: 1,
    adjustment_quantity: "",
    reference_type: "",
    reference_id: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await warehouseService.createStockMovement({
        ...form,
        quantity: Number(form.quantity),
        adjustment_quantity:
          form.movement_type === "adjustment"
            ? Number(form.adjustment_quantity)
            : null,
      });
      await onSaved();
    } catch (err) {
      setError(err.message || "No se pudo registrar el movimiento");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Registrar movimiento de stock"
      icon="bi-arrow-left-right"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-main" form="movement-form" disabled={saving}>
            {saving ? "Guardando…" : "Registrar movimiento"}
          </button>
        </>
      }
    >
      <form id="movement-form" onSubmit={submit}>
        <div className="row g-3">
          <div className="col-md-7">
            <label className="form-label">SKU</label>
            <select
              className="form-select"
              name="sku"
              value={form.sku}
              onChange={update}
              required
            >
              <option value="">Selecciona referencia</option>
              {stock.map((item) => (
                <option value={item.sku} key={item.sku}>
                  {item.sku} · {item.product}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-5">
            <label className="form-label">Operación</label>
            <select
              className="form-select"
              name="movement_type"
              value={form.movement_type}
              onChange={update}
            >
              <option value="entry">Entrada</option>
              <option value="exit">Salida</option>
              <option value="reserve">Reserva</option>
              <option value="release">Liberación de reserva</option>
              <option value="adjustment">Ajuste</option>
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">Cantidad</label>
            <input
              className="form-control"
              type="number"
              min="0.001"
              step="0.001"
              name="quantity"
              value={form.quantity}
              onChange={update}
              required
            />
          </div>
          {form.movement_type === "adjustment" && (
            <div className="col-md-6">
              <label className="form-label">Delta del ajuste</label>
              <input
                className="form-control"
                type="number"
                step="0.001"
                name="adjustment_quantity"
                value={form.adjustment_quantity}
                onChange={update}
                required
              />
            </div>
          )}
          <div className="col-md-6">
            <label className="form-label">Tipo de referencia</label>
            <input
              className="form-control"
              name="reference_type"
              value={form.reference_type}
              onChange={update}
              placeholder="recepción, pedido…"
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Referencia</label>
            <input
              className="form-control"
              name="reference_id"
              value={form.reference_id}
              onChange={update}
            />
          </div>
          <div className="col-12">
            <label className="form-label">Motivo</label>
            <textarea
              className="form-control"
              name="reason"
              value={form.reason}
              onChange={update}
              placeholder="Motivo operativo del movimiento"
            />
          </div>
        </div>
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
      </form>
    </ModalShell>
  );
}

function Receiving() {
  return (
    <>
      <PageTitle eyebrow="OPERACIONES / LOGÍSTICA" title="Recepción y almacén">
        <Button>
          <i className="bi bi-printer" /> Imprimir etiquetas
        </Button>
        <Button primary>
          <i className="bi bi-box-arrow-in-down" /> Nueva recepción
        </Button>
      </PageTitle>
      <div className="receiving-grid">
        <section className="panel">
          <PanelHead
            title="Muelles de recepción"
            subtitle="Estado actual · 25 septiembre"
          />
          <div className="dock-grid">
            <Dock
              name="Muelle 01"
              supplier="Saltoki Suministros"
              eta="09:30"
              status="Descargando"
              tone="success"
            />
            <Dock
              name="Muelle 02"
              supplier="General Cable"
              eta="10:15"
              status="En camino"
              tone="info"
            />
            <Dock
              name="Muelle 03"
              supplier="Roca Sanitario"
              eta="11:00"
              status="Programado"
              tone="warning"
            />
            <Dock
              name="Muelle 04"
              supplier="Libre"
              eta="—"
              status="Disponible"
              tone="neutral"
            />
          </div>
        </section>
        <section className="panel capacity">
          <PanelHead
            title="Capacidad del almacén"
            subtitle="Ocupación por zona"
          />
          <div className="warehouse-map">
            <div className="zone zone-a">
              A <small>78%</small>
            </div>
            <div className="zone zone-b">
              B <small>64%</small>
            </div>
            <div className="zone zone-c">
              C <small>91%</small>
            </div>
            <div className="zone zone-d">
              D <small>42%</small>
            </div>
          </div>
          <div className="map-legend">
            <span>
              <i className="legend-dot green" /> Disponible
            </span>
            <span>
              <i className="legend-dot yellow" /> Atención
            </span>
            <span>
              <i className="legend-dot red" /> Saturada
            </span>
          </div>
        </section>
      </div>
      <section className="panel timeline-panel">
        <PanelHead
          title="Próximas recepciones"
          subtitle="Pedidos confirmados con proveedor"
          action="Ver agenda"
        />
        {[
          "PED-2025-00481 · Tubo multicapa PEX 16 mm",
          "PED-2025-00476 · Cable RZ1-K 3G2.5",
          "PED-2025-00470 · Panel LED 60×60 40W",
        ].map((x, i) => (
          <div className="receiving-row" key={x}>
            <div className="time-block">
              <strong>{["09:30", "10:15", "11:00"][i]}</strong>
              <small>HOY</small>
            </div>
            <div>
              <strong>{x.split(" · ")[0]}</strong>
              <span>{x.split(" · ")[1]}</span>
            </div>
            <Status tone={i === 0 ? "success" : "info"}>
              {["Descargando", "En camino", "Programado"][i]}
            </Status>
            <span className="muted">
              {["Muelle 01", "Muelle 02", "Muelle 03"][i]}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
function ReceivingFromApi() {
  const { receipts, orders, refresh } = useWarehouseData();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageTitle eyebrow="OPERACIONES / LOGÍSTICA" title="Recepción y almacén">
        <Button>
          <i className="bi bi-printer" /> Imprimir etiquetas
        </Button>
        <Button primary onClick={() => setOpen(true)}>
          <i className="bi bi-box-arrow-in-down" /> Nueva recepción
        </Button>
      </PageTitle>
      <div className="receiving-grid">
        <section className="panel">
          <PanelHead
            title="Muelles de recepción"
            subtitle="Datos recibidos desde FastAPI"
          />
          <div className="dock-grid">
            {receipts.slice(0, 4).map((receipt) => (
              <Dock
                key={receipt.receipt_number}
                name={receipt.name}
                supplier={receipt.supplier}
                eta={receipt.eta}
                status={receipt.status}
                tone={receipt.tone}
              />
            ))}
          </div>
        </section>
        <section className="panel capacity">
          <PanelHead
            title="Capacidad del almacén"
            subtitle="Ocupación por zona"
          />
          <div className="warehouse-map">
            <div className="zone zone-a">
              A <small>78%</small>
            </div>
            <div className="zone zone-b">
              B <small>64%</small>
            </div>
            <div className="zone zone-c">
              C <small>91%</small>
            </div>
            <div className="zone zone-d">
              D <small>42%</small>
            </div>
          </div>
          <div className="map-legend">
            <span>
              <i className="legend-dot green" /> Disponible
            </span>
            <span>
              <i className="legend-dot yellow" /> Atención
            </span>
            <span>
              <i className="legend-dot red" /> Saturada
            </span>
          </div>
        </section>
      </div>
      <section className="panel timeline-panel">
        <PanelHead
          title="Recepciones registradas"
          subtitle="Comparación pedido vs mercancía recibida"
        />
        {receipts.slice(0, 8).map((receipt) => (
          <div className="receiving-row" key={receipt.receipt_number}>
            <div className="time-block">
              <strong>{receipt.eta}</strong>
              <small>{receipt.receipt_number}</small>
            </div>
            <div>
              <strong>{receipt.order || receipt.receipt_number}</strong>
              <span>
                {receipt.product || receipt.supplier} · pedido {receipt.qty} ·
                recibido {receipt.received} · dañado {receipt.damaged}
              </span>
            </div>
            <Status tone={receipt.tone}>{receipt.resultStatus}</Status>
            <span className="muted">{receipt.name}</span>
          </div>
        ))}
      </section>
      {open && (
        <NewReceiptModal
          orders={orders}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function NewReceiptModal({ orders, onClose, onSaved }) {
  const [form, setForm] = useState({
    order_external_id: "",
    dock_code: "Muelle 01",
    sku: "",
    received_quantity: "",
    damaged_quantity: "0",
    damage_reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const order = orders.find((item) => item.id === form.order_external_id);
  const updateOrder = (event) => {
    const selected = orders.find((item) => item.id === event.target.value);
    setForm((current) => ({
      ...current,
      order_external_id: event.target.value,
      sku: selected?.sku || "",
    }));
  };
  const update = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await warehouseService.createReceipt({
        order_external_id: form.order_external_id,
        dock_code: form.dock_code,
        lines: [
          {
            sku: form.sku,
            received_quantity: Number(form.received_quantity),
            damaged_quantity: Number(form.damaged_quantity),
            damage_reason: form.damage_reason || null,
          },
        ],
      });
      await onSaved();
    } catch (err) {
      setError(err.message || "No se pudo registrar la recepción");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Registrar recepción"
      icon="bi-box-arrow-in-down"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn-main"
            form="receipt-form"
            disabled={saving || !form.order_external_id}
          >
            {saving ? "Registrando…" : "Registrar entrada"}
          </button>
        </>
      }
    >
      <form id="receipt-form" onSubmit={submit}>
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label">Pedido de compra</label>
            <select
              className="form-select"
              value={form.order_external_id}
              onChange={updateOrder}
              required
            >
              <option value="">Selecciona un pedido</option>
              {orders.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.id} · {item.product} · solicitado {item.qty}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">Muelle</label>
            <select
              className="form-select"
              name="dock_code"
              value={form.dock_code}
              onChange={update}
            >
              <option>Muelle 01</option>
              <option>Muelle 02</option>
              <option>Muelle 03</option>
              <option>Muelle 04</option>
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">SKU</label>
            <input className="form-control" value={form.sku} readOnly />
          </div>
          <div className="col-md-6">
            <label className="form-label">Cantidad recibida</label>
            <input
              className="form-control"
              type="number"
              min="0"
              step="0.001"
              name="received_quantity"
              value={form.received_quantity}
              onChange={update}
              required
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Cantidad dañada</label>
            <input
              className="form-control"
              type="number"
              min="0"
              step="0.001"
              name="damaged_quantity"
              value={form.damaged_quantity}
              onChange={update}
            />
          </div>
          <div className="col-12">
            <label className="form-label">
              Motivo / observaciones del daño
            </label>
            <textarea
              className="form-control"
              name="damage_reason"
              value={form.damage_reason}
              onChange={update}
              placeholder="Ej.: embalaje golpeado, pieza rota…"
            />
          </div>
        </div>
        {order && (
          <div className="alert alert-info mt-3 mb-0">
            Pedido: <strong>{order.qty} unidades</strong>. La API comparará
            automáticamente solicitado, recibido y dañado.
          </div>
        )}
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
      </form>
    </ModalShell>
  );
}
function Dock({ name, supplier, eta, status, tone }) {
  return (
    <div className="dock-card">
      <div className="dock-number">
        <i className="bi bi-truck" />
      </div>
      <div>
        <strong>{name}</strong>
        <span>{supplier}</span>
        <small>ETA {eta}</small>
      </div>
      <Status tone={tone}>{status}</Status>
    </div>
  );
}

function Suppliers() {
  const { suppliers } = useWarehouseData();
  return (
    <>
      <PageTitle eyebrow="MAESTROS / PARTNERS" title="Proveedores">
        <Button>
          <i className="bi bi-download" /> Exportar
        </Button>
        <Button primary>
          <i className="bi bi-plus-lg" /> Añadir proveedor
        </Button>
      </PageTitle>
      <div className="supplier-cards">
        <div>
          <i className="bi bi-building" />
          <strong>{suppliers.length}</strong>
          <span>Proveedores activos</span>
        </div>
        <div>
          <i className="bi bi-link-45deg" />
          <strong>
            {suppliers.filter((item) => item.status === "Conectado").length}
          </strong>
          <span>Conectados por API</span>
        </div>
        <div>
          <i className="bi bi-star" />
          <strong>
            {suppliers.length
              ? (
                  suppliers.reduce(
                    (sum, item) => sum + Number(item.rating.replace(",", ".")),
                    0,
                  ) / suppliers.length
                )
                  .toFixed(1)
                  .replace(".", ",")
              : "—"}{" "}
            / 5
          </strong>
          <span>Valoración media</span>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-meta">
          <span>
            <strong>Red de proveedores</strong>
          </span>
          <div className="search-field compact">
            <i className="bi bi-search" />
            <input placeholder="Buscar proveedor..." />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>PROVEEDOR</th>
              <th>CATEGORÍA</th>
              <th>PEDIDOS YTD</th>
              <th>VALORACIÓN</th>
              <th>PLAZO MEDIO</th>
              <th>ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.name}>
                <td>
                  <div className="supplier-name">
                    <div className="supplier-avatar">
                      {s.name.slice(0, 2).toUpperCase()}
                    </div>
                    <strong>{s.name}</strong>
                  </div>
                </td>
                <td>{s.category}</td>
                <td>{s.orders}</td>
                <td>
                  <span className="rating">
                    <i className="bi bi-star-fill" /> {s.rating}
                  </span>
                </td>
                <td>{s.lead}</td>
                <td>
                  <Status
                    tone={s.status === "Conectado" ? "success" : "warning"}
                  >
                    {s.status}
                  </Status>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function OrderDetailPage(props) {
  const { orders } = useWarehouseData();
  const { id } = useParams();
  const order = orders.find((item) => item.id === id);
  return (
    <>
      <OrderDetail {...props} />
      {order?.workflowStatus === "received" && (
        <div className="panel mt-3">
          <strong>Factura pendiente de conciliación</strong>
          <p className="mb-2 text-muted">
            Relaciona la factura con este pedido y comprueba proveedor,
            cantidades, impuestos, total y recepción.
          </p>
          <NavLink
            className="btn-main"
            to={`/documentos?order=${encodeURIComponent(order.id)}`}
          >
            <i className="bi bi-file-earmark-check" /> Conciliar factura de este
            pedido
          </NavLink>
        </div>
      )}
    </>
  );
}

function InvoiceDetail() {
  const { invoices, refresh } = useWarehouseData();
  const { id } = useParams();
  const invoice = invoices.find((item) => item.id === id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!invoice)
    return (
      <section className="panel">
        <NavLink to="/documentos">
          <i className="bi bi-arrow-left" /> Volver a facturas
        </NavLink>
        <h3 className="mt-4">Factura no encontrada</h3>
      </section>
    );
  const reconcile = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await warehouseService.reconcileInvoice(invoice.id);
      setMessage(
        result.status === "matched"
          ? "Conciliación correcta."
          : "La conciliación requiere revisión.",
      );
      await refresh();
    } catch (error) {
      setMessage(error.message || "No se pudo conciliar la factura");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="detail-back">
        <NavLink to="/documentos">
          <i className="bi bi-arrow-left" /> Volver a facturas
        </NavLink>
      </div>
      <PageTitle eyebrow="CONTROL DOCUMENTAL / FACTURA" title={invoice.id}>
        <NavLink className="btn-ghost" to="/documentos">
          <i className="bi bi-list" /> Listado de facturas
        </NavLink>
        {invoice.accountingStatus !== "Exportado" && (
          <Button primary onClick={reconcile} disabled={busy}>
            {busy ? "Conciliando…" : "Conciliar factura"}
          </Button>
        )}
      </PageTitle>
      {message && <div className="alert alert-info">{message}</div>}
      <div className="detail-grid">
        <section className="panel">
          <PanelHead
            title="Datos de la factura"
            subtitle="Documento interpretado y persistido"
          />
          <div className="detail-metrics">
            <div>
              <span>Número</span>
              <strong>{invoice.id}</strong>
            </div>
            <div>
              <span>Proveedor</span>
              <strong>{invoice.supplier || "Pendiente identificar"}</strong>
            </div>
            <div>
              <span>Fecha</span>
              <strong>{invoice.date}</strong>
            </div>
            <div>
              <span>Importe total</span>
              <strong>{invoice.amount}</strong>
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHead
            title="Conciliación"
            subtitle="Factura · pedido · recepción"
          />
          <div className="procedure-status-list">
            <div>
              <span>Estado</span>
              <Status tone={invoice.reconciliationTone}>
                {invoice.reconciliationStatus}
              </Status>
            </div>
            <div>
              <span>Pedido asociado</span>
              <strong>
                {invoice.orderNumber || "Pendiente de identificar"}
              </strong>
            </div>
            <div>
              <span>Recepción asociada</span>
              <strong>
                {invoice.receiptNumber || "Pendiente de identificar"}
              </strong>
            </div>
            <div>
              <span>Contabilidad</span>
              <Status tone={invoice.accountingTone}>
                {invoice.accountingStatus}
              </Status>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Documents({ onUploadInvoice, onUploadProcedure }) {
  const { invoices, procedures, refresh } = useWarehouseData();
  const [searchParams] = useSearchParams();
  const selectedOrder = searchParams.get("order");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const missing = procedures.reduce(
    (sum, item) => sum + Number(item.missing || 0),
    0,
  );
  const visibleInvoices = selectedOrder
    ? invoices.filter((invoice) => invoice.orderNumber === selectedOrder)
    : invoices;
  const reconcile = async (invoice) => {
    setBusy(invoice.id);
    setMessage("");
    try {
      const result = await warehouseService.reconcileInvoice(invoice.id);
      setMessage(
        `${invoice.id}: ${result.status === "matched" ? "conciliación correcta" : "requiere revisión"} · pedido ${result.order || "no identificado"}`,
      );
      await refresh();
    } catch (error) {
      setMessage(error.message || "No se pudo conciliar la factura");
    } finally {
      setBusy("");
    }
  };
  const exportInvoice = async (invoice) => {
    setBusy(invoice.id);
    setMessage("");
    try {
      await warehouseService.exportInvoice(invoice.id);
      setMessage(`${invoice.id}: exportada al adaptador contable REST.`);
      await refresh();
    } catch (error) {
      setMessage(error.message || "No se pudo exportar la factura");
    } finally {
      setBusy("");
    }
  };
  const download = async (format) => {
    setBusy(`download-${format}`);
    try {
      await warehouseService.downloadAccountingExport(format);
      setMessage(`Exportación ${format.toUpperCase()} descargada.`);
    } catch (error) {
      setMessage(error.message || "No se pudo generar la exportación");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageTitle eyebrow="CONTROL DOCUMENTAL" title="Facturas y documentos">
        <Button onClick={onUploadInvoice}>
          <i className="bi bi-file-earmark-arrow-up" /> Subir factura PDF
        </Button>
        <Button
          onClick={() => download("csv")}
          disabled={busy.startsWith("download-")}
        >
          <i className="bi bi-filetype-csv" /> CSV contable
        </Button>
        <Button
          primary
          onClick={() => download("xlsx")}
          disabled={busy.startsWith("download-")}
        >
          <i className="bi bi-file-earmark-spreadsheet" /> Excel contable
        </Button>
        <Button onClick={onUploadProcedure}>
          <i className="bi bi-shield-plus" /> Completar procedimiento
        </Button>
      </PageTitle>
      {selectedOrder && (
        <div className="alert alert-info">
          <i className="bi bi-link-45deg me-2" />
          Pedido seleccionado: <strong>{selectedOrder}</strong>. Se muestran sus
          facturas asociadas.
        </div>
      )}
      <div className="document-banner">
        <div className="ai-spark">
          <i className="bi bi-stars" />
        </div>
        <div>
          <strong>Interpretación, conciliación y exportación activa</strong>
          <p>
            La operación contrasta factura, pedido, impuestos, total y recepción
            antes de exportar a contabilidad.
          </p>
        </div>
        <span className="confidence">{missing} controles pendientes</span>
      </div>
      {message && <div className="alert alert-info">{message}</div>}
      <section className="panel table-panel">
        <div className="table-meta">
          <span>
            <strong>Facturas recibidas</strong> · {visibleInvoices.length}{" "}
            documentos
          </span>
          <span className="muted">Estados contables persistidos en MySQL</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>DOCUMENTO</th>
              <th>PROVEEDOR</th>
              <th>PEDIDO</th>
              <th>FECHA</th>
              <th>IMPORTE</th>
              <th>CONCILIACIÓN</th>
              <th>CONTABILIDAD</th>
              <th>ESTADO</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleInvoices.map((x) => (
              <tr key={x.id}>
                <td>
                  <NavLink
                    className="order-link"
                    to={`/documentos/facturas/${encodeURIComponent(x.id)}`}
                  >
                    <div className="doc-name">
                      <i className="bi bi-file-earmark-pdf" />
                      <div>
                        <strong>{x.id}</strong>
                        <small>{x.type}</small>
                      </div>
                    </div>
                  </NavLink>
                </td>
                <td>{x.supplier || "Pendiente identificar"}</td>
                <td>{x.orderNumber || "—"}</td>
                <td>{x.date}</td>
                <td>
                  <strong>{x.amount}</strong>
                </td>
                <td>
                  <Status tone={x.reconciliationTone}>
                    {x.reconciliationStatus}
                  </Status>
                </td>
                <td>
                  <Status tone={x.accountingTone}>{x.accountingStatus}</Status>
                </td>
                <td>
                  <Status
                    tone={x.status === "Exportable" ? "success" : "warning"}
                  >
                    {x.status}
                  </Status>
                </td>
                <td>
                  <NavLink
                    className="text-link"
                    to={`/documentos/facturas/${encodeURIComponent(x.id)}`}
                  >
                    Abrir
                  </NavLink>
                  {x.accountingStatus === "Exportable" && (
                    <button
                      className="text-link"
                      onClick={() => exportInvoice(x)}
                      disabled={busy === x.id}
                    >
                      {busy === x.id ? "Enviando…" : "Enviar"}
                    </button>
                  )}
                  {x.accountingStatus !== "Exportado" &&
                    x.accountingStatus !== "Exportable" && (
                      <button
                        className="text-link"
                        onClick={() => reconcile(x)}
                        disabled={busy === x.id}
                      >
                        {busy === x.id ? "Conciliando…" : "Conciliar"}
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel procedure-panel">
        <div className="procedure-icon">
          <i className="bi bi-shield-check" />
        </div>
        <div>
          <h3>Documentación obligatoria del proceso</h3>
          <div className="procedure-status-list">
            {procedures.map((item) => (
              <div key={item.code}>
                <span>{item.name}</span>
                <Status tone={item.missing ? "warning" : "success"}>
                  {item.missing ? `${item.missing} pendientes` : "Completo"}
                </Status>
              </div>
            ))}
          </div>
        </div>
        <button className="text-link" onClick={onUploadProcedure}>
          Gestionar procedimientos <i className="bi bi-arrow-right" />
        </button>
      </section>
    </>
  );
}

function Events() {
  const { events, alerts, alertRules, refresh } = useWarehouseData();
  const [severity, setSeverity] = useState("all");
  const [type, setType] = useState("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const filteredAlerts = alerts.filter(
    (alert) =>
      (severity === "all" || alert.severity === severity) &&
      (type === "all" || alert.event_type === type),
  );
  const filteredEvents = events.filter(
    (event) =>
      (severity === "all" || event.severity === severity) &&
      (type === "all" || event.event_type === type),
  );
  const critical = filteredAlerts.filter(
    (item) => item.tone === "danger",
  ).length;
  const warnings = filteredAlerts.filter(
    (item) => item.tone === "warning",
  ).length;
  const markRead = async (id) => {
    try {
      await warehouseService.readAlert(id);
      await refresh();
    } catch (error) {
      setMessage(error.message || "No se pudo marcar la alerta");
    }
  };
  const markAll = async () => {
    try {
      const result = await warehouseService.readAllAlerts();
      setMessage(`${result.marked_read} alertas marcadas como leídas.`);
      await refresh();
    } catch (error) {
      setMessage(error.message || "No se pudieron marcar las alertas");
    }
  };
  const download = async (format) => {
    try {
      await warehouseService.downloadEventsExport(format, {
        severity,
        event_type: type,
      });
      setMessage(`Registro ${format.toUpperCase()} descargado.`);
    } catch (error) {
      setMessage(error.message || "No se pudo exportar el registro");
    }
  };
  return (
    <>
      <PageTitle eyebrow="OBSERVABILIDAD / AUDITORÍA" title="Eventos y alertas">
        <Button onClick={markAll}>
          <i className="bi bi-check2-all" /> Marcar leídas
        </Button>
        <Button onClick={() => download("csv")}>
          <i className="bi bi-filetype-csv" /> Exportar CSV
        </Button>
        <Button primary onClick={() => download("xlsx")}>
          <i className="bi bi-file-earmark-spreadsheet" /> Exportar Excel
        </Button>
        <Button onClick={() => setSettingsOpen(true)}>
          <i className="bi bi-sliders" /> Configurar alertas
        </Button>
      </PageTitle>
      {message && <div className="alert alert-info">{message}</div>}
      <div className="filter-bar">
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="all">Todas las gravedades</option>
          <option value="critical">Crítica</option>
          <option value="warning">Aviso</option>
          <option value="info">Información</option>
        </select>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">Todos los tipos</option>
          {[
            ...new Set(events.map((event) => event.event_type).filter(Boolean)),
          ].map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="muted">
          {filteredEvents.length} eventos · {filteredAlerts.length} alertas
          visibles
        </span>
      </div>
      <div className="alert-cards">
        <div className="alert-critical">
          <i className="bi bi-exclamation-octagon" />
          <div>
            <strong>{critical}</strong>
            <span>Alertas críticas pendientes</span>
          </div>
        </div>
        <div className="alert-warning">
          <i className="bi bi-exclamation-triangle" />
          <div>
            <strong>{warnings}</strong>
            <span>Requieren atención</span>
          </div>
        </div>
        <div className="alert-ok">
          <i className="bi bi-check-circle" />
          <div>
            <strong>{filteredEvents.length}</strong>
            <span>Eventos filtrados</span>
          </div>
        </div>
      </div>
      {filteredAlerts.length > 0 && (
        <section className="panel event-log alert-log">
          <div className="table-meta">
            <span>
              <strong>Alertas pendientes</strong>
            </span>
            <span className="muted">notifications + audit_events</span>
          </div>
          {filteredAlerts.slice(0, 12).map((alert, index) => (
            <div className="event-row" key={alert.id || index}>
              <span className={`event-dot ${alert.tone}`} />
              <div>
                <div>
                  <strong>{alert.title}</strong>
                  <small>
                    {alert.time} · {alert.event_type}
                  </small>
                </div>
                <p>{alert.body}</p>
              </div>
              <button className="text-link" onClick={() => markRead(alert.id)}>
                Marcar leída
              </button>
            </div>
          ))}
        </section>
      )}
      {settingsOpen && (
        <AlertRulesModal
          rules={alertRules}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => {
            setSettingsOpen(false);
            await refresh();
          }}
        />
      )}
      {selected && (
        <EventDetailModal event={selected} onClose={() => setSelected(null)} />
      )}
      <section className="panel event-log">
        <div className="table-meta">
          <span>
            <strong>Registro de actividad</strong>
          </span>
          <span className="muted">Payload completo disponible por evento</span>
        </div>
        {filteredEvents.slice(0, 50).map((event, index) => (
          <EventRow
            event={event}
            onOpen={setSelected}
            key={event.id || index}
          />
        ))}
      </section>
    </>
  );
}

function Integrations() {
  const { integrations, refresh } = useWarehouseData();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const sync = async (integration) => {
    setBusy(integration.code);
    setMessage("");
    try {
      const result = await warehouseService.syncIntegration(
        integration.code,
        integration.configuration?.direction === "bidirectional"
          ? "bidirectional"
          : "outbound",
      );
      setMessage(`${integration.name}: sincronización ${result.status}.`);
      await refresh();
    } catch (error) {
      setMessage(error.message || "No se pudo ejecutar la sincronización");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageTitle eyebrow="ARQUITECTURA / CORPORATIVO" title="Integraciones">
        <Button
          onClick={async () => {
            setBusy("health");
            await refresh();
            setBusy("");
          }}
        >
          <i className="bi bi-arrow-repeat" /> Probar conexiones
        </Button>
      </PageTitle>
      {message && <div className="alert alert-info">{message}</div>}
      <div className="integration-grid">
        {integrations.map((item) => (
          <section className="panel integration-card" key={item.code}>
            <div className="integration-icon">
              <i
                className={`bi ${item.kind === "edi" ? "bi-file-earmark-code" : item.kind === "accounting" ? "bi-calculator" : item.kind === "supplier" ? "bi-building" : "bi-diagram-3"}`}
              />
            </div>
            <div className="integration-head">
              <div>
                <h3>{item.name}</h3>
                <p>
                  {item.protocol} · {item.endpoint}
                </p>
              </div>
              <Status
                tone={
                  item.health?.status === "available" ? "success" : "warning"
                }
              >
                {item.health?.status === "available"
                  ? "Disponible"
                  : item.status}
              </Status>
            </div>
            <div className="integration-meta">
              <span>
                <strong>{item.kind.toUpperCase()}</strong>
              </span>
              <span>Secret local: {item.secret_reference}</span>
            </div>
            <button
              className="btn-ghost w-100"
              onClick={() => sync(item)}
              disabled={busy === item.code}
            >
              {busy === item.code ? "Sincronizando…" : "Probar sincronización"}
            </button>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="insight-head">
          <div className="ai-spark">
            <i className="bi bi-shield-check" />
          </div>
          <div>
            <div className="eyebrow">DISEÑO PREPARADO</div>
            <h3>Conectores aislados del dominio</h3>
          </div>
        </div>
        <p>
          La demo usa adaptadores locales deterministas. En producción se
          sustituirán por REST, SOAP, EDI/AS2 o conectores nativos de cada
          ERP/WMS sin cambiar los casos de uso.
        </p>
      </section>
    </>
  );
}

function EventDetailModal({ event, onClose }) {
  return (
    <ModalShell
      title="Detalle del evento"
      icon="bi-braces"
      onClose={onClose}
      footer={
        <button className="btn-ghost" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="detail-metrics">
        <div>
          <span>ID</span>
          <strong>{event.id}</strong>
        </div>
        <div>
          <span>Tipo</span>
          <strong>{event.event_type}</strong>
        </div>
        <div>
          <span>Gravedad</span>
          <strong>{event.severity}</strong>
        </div>
        <div>
          <span>Agregado</span>
          <strong>
            {event.aggregate_type} · {event.aggregate_id}
          </strong>
        </div>
      </div>
      <pre
        className="mt-4 p-3 bg-light rounded"
        style={{ fontSize: "12px", maxHeight: "360px", overflow: "auto" }}
      >
        {JSON.stringify(event.payload, null, 2)}
      </pre>
    </ModalShell>
  );
}

function AlertRulesModal({ rules, onClose, onSaved }) {
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    event_type: "ai.validation",
    severity: "warning",
    recipients: "",
    channels: "in_app",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await warehouseService.createAlertRule({
        ...form,
        recipients: form.recipients
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        channels: form.channels
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      await onSaved();
    } catch (err) {
      setError(err.message || "No se pudo crear la regla");
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (rule) => {
    try {
      await warehouseService.updateAlertRule(rule.id, {
        code: rule.code,
        name: rule.name,
        description: rule.description,
        event_type: rule.event_type,
        severity: rule.severity,
        enabled: !rule.enabled,
        recipients: rule.recipients,
        channels: rule.channels,
      });
      await onSaved();
    } catch (err) {
      setError(err.message || "No se pudo actualizar la regla");
    }
  };
  return (
    <ModalShell
      title="Configuración de alertas"
      icon="bi-sliders"
      onClose={onClose}
      footer={
        <button className="btn-ghost" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="mb-4">
        <h6>Reglas activas</h6>
        {rules.map((rule) => (
          <div
            className="d-flex align-items-center justify-content-between border-bottom py-2"
            key={rule.id}
          >
            <div>
              <strong>{rule.name}</strong>
              <small className="d-block text-muted">
                {rule.event_type} · {rule.severity} ·{" "}
                {rule.recipients.join(", ") || "sin destinatarios"}
              </small>
            </div>
            <button className="text-link" onClick={() => toggle(rule)}>
              {rule.enabled ? "Desactivar" : "Activar"}
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={submit}>
        <h6>Nueva regla</h6>
        <div className="row g-2">
          <div className="col-md-4">
            <input
              className="form-control"
              name="code"
              placeholder="Código"
              value={form.code}
              onChange={update}
              required
            />
          </div>
          <div className="col-md-8">
            <input
              className="form-control"
              name="name"
              placeholder="Nombre de la regla"
              value={form.name}
              onChange={update}
              required
            />
          </div>
          <div className="col-md-6">
            <input
              className="form-control"
              name="event_type"
              placeholder="Tipo de evento"
              value={form.event_type}
              onChange={update}
              required
            />
          </div>
          <div className="col-md-3">
            <select
              className="form-select"
              name="severity"
              value={form.severity}
              onChange={update}
            >
              <option value="info">Información</option>
              <option value="warning">Aviso</option>
              <option value="critical">Crítica</option>
            </select>
          </div>
          <div className="col-md-3">
            <input
              className="form-control"
              name="channels"
              placeholder="Canales"
              value={form.channels}
              onChange={update}
            />
          </div>
          <div className="col-12">
            <input
              className="form-control"
              name="recipients"
              placeholder="Destinatarios separados por coma"
              value={form.recipients}
              onChange={update}
              required
            />
          </div>
          <div className="col-12">
            <textarea
              className="form-control"
              name="description"
              placeholder="Descripción"
              value={form.description}
              onChange={update}
            />
          </div>
        </div>
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        <button className="btn-main mt-3" disabled={saving}>
          {saving ? "Guardando…" : "Crear regla"}
        </button>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, icon, onClose, children, footer }) {
  return (
    <div className="modal-backdrop-custom">
      <div className="modal d-block" tabIndex="-1" role="dialog">
        <div className="modal-dialog modal-dialog-centered modal-lg">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                <i className={`bi ${icon}`} /> {title}
              </h5>
              <button
                type="button"
                className="btn-close"
                aria-label="Cerrar"
                onClick={onClose}
              />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewOrderModal({ open, onClose, onSaved }) {
  const { stock, procedures } = useWarehouseData();
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState({
    title: "",
    sku: "",
    quantity: 1,
    unit_price: "",
    supplier_code: "",
    supplier_sku: "",
    external_order_id: "",
    required_procedures: [
      "PURCHASE_APPROVAL",
      "RECEIVING_CHECK",
      "INVOICE_MATCH",
    ],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const updateProduct = async (event) => {
    const sku = event.target.value;
    setForm((current) => ({
      ...current,
      sku,
      supplier_code: "",
      supplier_sku: "",
      unit_price: "",
    }));
    setOffers([]);
    if (sku) {
      try {
        setOffers(await warehouseService.productOffers(sku));
      } catch (err) {
        setError(err.message || "No se pudieron cargar las ofertas");
      }
    }
  };
  const updateSupplier = (event) => {
    const supplier_code = event.target.value;
    const offer = offers.find((item) => item.supplier_code === supplier_code);
    setForm((current) => ({
      ...current,
      supplier_code,
      supplier_sku: offer?.supplier_sku || "",
      unit_price: offer?.unit_cost || "",
    }));
  };
  const update = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const toggleProcedure = (code) =>
    setForm((current) => ({
      ...current,
      required_procedures: current.required_procedures.includes(code)
        ? current.required_procedures.filter((item) => item !== code)
        : [...current.required_procedures, code],
    }));
  const selectedOffer = offers.find(
    (item) => item.supplier_code === form.supplier_code,
  );
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await warehouseService.createOrder({
        ...form,
        quantity: Number(form.quantity),
        unit_price: Number(form.unit_price),
      });
      setForm({
        title: "",
        sku: "",
        quantity: 1,
        unit_price: "",
        supplier_code: "",
        supplier_sku: "",
        external_order_id: "",
        required_procedures: [
          "PURCHASE_APPROVAL",
          "RECEIVING_CHECK",
          "INVOICE_MATCH",
        ],
      });
      onSaved();
    } catch (err) {
      setError(err.message || "No se pudo crear el pedido");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Nuevo pedido"
      icon="bi-cart-plus"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn-main"
            form="new-order-form"
            disabled={saving || !selectedOffer}
          >
            {saving ? "Guardando..." : "Crear pedido"}
          </button>
        </>
      }
    >
      <form id="new-order-form" onSubmit={submit}>
        <div className="row g-3">
          <div className="col-md-8">
            <label className="form-label">Producto / SKU interno</label>
            <select
              className="form-select"
              name="sku"
              value={form.sku}
              onChange={updateProduct}
              required
            >
              <option value="">Selecciona una referencia</option>
              {stock.map((item) => (
                <option value={item.sku} key={item.sku}>
                  {item.sku} · {item.product}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Cantidad</label>
            <input
              className="form-control"
              type="number"
              min="1"
              name="quantity"
              value={form.quantity}
              onChange={update}
              required
            />
          </div>
          <div className="col-12">
            <label className="form-label">Título del pedido</label>
            <input
              className="form-control"
              name="title"
              value={form.title}
              onChange={update}
              maxLength="180"
              placeholder="Ej.: Reposición cableado almacén Madrid"
              required
            />
          </div>
          <div className="col-12">
            <label className="form-label">Documentación requerida</label>
            <div className="required-procedure-grid">
              {procedures.map((item) => (
                <label className="required-procedure-option" key={item.code}>
                  <input
                    type="checkbox"
                    checked={form.required_procedures.includes(item.code)}
                    onChange={() => toggleProcedure(item.code)}
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="form-text">
              Los tres documentos aparecen seleccionados por defecto; puedes
              ajustar los requisitos de este pedido.
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label">Proveedor</label>
            <select
              className="form-select"
              name="supplier_code"
              value={form.supplier_code}
              onChange={updateSupplier}
              required
              disabled={!offers.length}
            >
              <option value="">
                {offers.length
                  ? "Selecciona proveedor"
                  : "Selecciona primero el producto"}
              </option>
              {offers.map((item) => (
                <option value={item.supplier_code} key={item.supplier_code}>
                  {item.supplier} · {Number(item.unit_cost).toFixed(2)} €
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label">Precio unitario (€)</label>
            <input
              className="form-control"
              value={form.unit_price}
              readOnly
              placeholder="Se obtiene del catálogo"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label">Referencia proveedor</label>
            <input
              className="form-control"
              value={form.supplier_sku}
              readOnly
              placeholder="Se obtiene del catálogo"
            />
          </div>
          <div className="col-12">
            <label className="form-label">Referencia externa del pedido</label>
            <input
              className="form-control"
              name="external_order_id"
              value={form.external_order_id}
              onChange={update}
              placeholder="Opcional"
            />
          </div>
        </div>
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        <div className="alert alert-info mt-4 mb-0">
          <i className="bi bi-database-check me-2" />
          Precio y referencia derivados de la oferta proveedor-producto. El
          backend vuelve a validarlos antes de guardar.
        </div>
      </form>
    </ModalShell>
  );
}

function ImportOrdersModal({ open, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const preview = async (event) => {
    event.preventDefault();
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      setResult(await warehouseService.previewOrderImport(file));
    } catch (err) {
      setError(err.message || "No se pudo validar la plantilla");
    } finally {
      setSaving(false);
    }
  };
  const confirm = async () => {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const response = await warehouseService.importOrders(file);
      setResult(response);
      if (response.error_count === 0) setTimeout(onSaved, 600);
    } catch (err) {
      setError(err.message || "No se pudo importar la plantilla");
    } finally {
      setSaving(false);
    }
  };
  const downloadErrors = () => {
    const rows = result?.errors || [];
    const csv = [
      "fila,campo,mensaje",
      ...rows.map(
        (item) =>
          `${item.row},${item.field || ""},"${String(item.message).replaceAll('"', '""')}"`,
      ),
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    link.download = "informe-errores-importacion.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <ModalShell
      title="Importar pedidos"
      icon="bi-file-earmark-spreadsheet"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          {!result ? (
            <button
              className="btn-main"
              form="import-orders-form"
              disabled={!file || saving}
            >
              {saving ? "Validando..." : "Vista previa"}
            </button>
          ) : (
            <button
              className="btn-main"
              onClick={confirm}
              disabled={!result.valid_count || saving}
            >
              {saving
                ? "Importando..."
                : `Importar ${result.valid_count} filas válidas`}
            </button>
          )}
        </>
      }
    >
      <form id="import-orders-form" onSubmit={preview}>
        <div className="import-dropzone">
          <i className="bi bi-cloud-arrow-up" />
          <strong>Selecciona la plantilla de pedidos</strong>
          <span>Formatos admitidos: .csv y .xlsx</span>
          <input
            className="form-control mt-3"
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setResult(null);
            }}
          />
        </div>
        <div className="template-columns mt-3">
          <strong>Columnas obligatorias</strong>
          <code>sku · quantity · unit_price · supplier_code</code>
          <small className="d-block mt-2">
            La vista previa valida columnas, filas inválidas y duplicados antes
            de escribir en MySQL.
          </small>
        </div>
        {result && (
          <>
            <div
              className={`alert ${result.error_count ? "alert-warning" : "alert-success"} mt-3 mb-0`}
            >
              Vista previa: <strong>{result.preview_count}</strong> filas ·
              Válidas: <strong>{result.valid_count}</strong> · Errores:{" "}
              <strong>{result.error_count}</strong>
              {result.error_count > 0 && (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 ms-2"
                  onClick={downloadErrors}
                >
                  Descargar informe de errores
                </button>
              )}
            </div>
            <div
              className="table-responsive mt-3"
              style={{ maxHeight: "180px" }}
            >
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>SKU</th>
                    <th>Cantidad</th>
                    <th>Precio</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows?.slice(0, 8).map((row) => (
                    <tr key={row._row}>
                      <td>{row._row}</td>
                      <td>{row.sku}</td>
                      <td>{row.quantity}</td>
                      <td>{row.unit_price}</td>
                      <td>
                        {result.errors?.some((error) => error.row === row._row)
                          ? "Revisar"
                          : "Válida"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
      </form>
    </ModalShell>
  );
}

function InvoiceModal({ open, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const submit = async (event) => {
    event.preventDefault();
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const response = await warehouseService.uploadInvoice(file);
      setResult(response);
      if (response.status === "exportable") setTimeout(onSaved, 700);
    } catch (err) {
      setError(err.message || "No se pudo procesar la factura");
    } finally {
      setSaving(false);
    }
  };
  const reviewText = result?.ocr_applied
    ? "Se ha aplicado OCR. Los campos reconocidos quedan con confianza reducida y requieren revisión humana."
    : "Faltan datos fiables o no se ha identificado el proveedor.";
  return (
    <ModalShell
      title="Subir factura PDF"
      icon="bi-file-earmark-pdf"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          <button
            className="btn-main"
            form="invoice-form"
            disabled={!file || saving}
          >
            {saving ? "Interpretando..." : "Procesar factura"}
          </button>
        </>
      }
    >
      <form id="invoice-form" onSubmit={submit}>
        <div className="import-dropzone">
          <i className="bi bi-file-earmark-pdf" />
          <strong>Selecciona una factura PDF</strong>
          <span>Se extraerán proveedor, número, fecha, impuestos y total</span>
          <input
            className="form-control mt-3"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setResult(null);
            }}
          />
        </div>
        {result && (
          <div
            className={`alert ${result.status === "exportable" ? "alert-success" : "alert-warning"} mt-3 mb-0`}
          >
            Factura <strong>{result.invoice_number}</strong>:{" "}
            {result.status === "exportable"
              ? "lista para exportar a contabilidad."
              : reviewText}
            {result.low_confidence_fields?.length > 0 && (
              <small className="d-block mt-2">
                Campos a revisar: {result.low_confidence_fields.join(", ")}
              </small>
            )}
          </div>
        )}
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        <div className="alert alert-info mt-4 mb-0">
          <i className="bi bi-shield-check me-2" />
          El documento queda guardado en almacenamiento local, auditado en
          eventos y preparado para revisión humana.
        </div>
      </form>
    </ModalShell>
  );
}

function ProcedureDocumentModal({ open, onClose, onSaved }) {
  const { orders, procedures } = useWarehouseData();
  const [form, setForm] = useState({ externalId: "", procedureCode: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const update = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    if (!file || !form.externalId || !form.procedureCode) {
      setError(
        "Selecciona el pedido, el procedimiento y adjunta el documento justificativo.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await warehouseService.uploadProcedureDocument(
        form.externalId,
        form.procedureCode,
        file,
      );
      setForm({ externalId: "", procedureCode: "" });
      setFile(null);
      onSaved();
    } catch (err) {
      setError(err.message || "No se pudo completar el procedimiento");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Completar procedimiento"
      icon="bi-shield-plus"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          <button
            className="btn-main"
            form="procedure-document-form"
            disabled={saving}
          >
            {saving ? "Guardando..." : "Marcar como completo"}
          </button>
        </>
      }
    >
      <form id="procedure-document-form" onSubmit={submit}>
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label">Pedido</label>
            <select
              className="form-select"
              name="externalId"
              value={form.externalId}
              onChange={update}
              required
            >
              <option value="">Selecciona un pedido</option>
              {orders.map((order) => (
                <option value={order.id} key={order.id}>
                  {order.id} · {order.product}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Procedimiento obligatorio</label>
            <select
              className="form-select"
              name="procedureCode"
              value={form.procedureCode}
              onChange={update}
              required
            >
              <option value="">Selecciona un procedimiento</option>
              {procedures.map((item) => (
                <option value={item.code} key={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Documento justificativo</label>
            <input
              className="form-control"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              required
            />
            <div className="form-text">
              Se guardará, vinculará al pedido y se registrará en auditoría.
            </div>
          </div>
        </div>
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        <div className="alert alert-info mt-4 mb-0">
          <i className="bi bi-info-circle me-2" />
          Al completar el procedimiento, el control pasará a estado{" "}
          <strong>complete</strong>.
        </div>
      </form>
    </ModalShell>
  );
}

function Copilot({ onClose }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const ask = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSending(true);
    try {
      const result = await warehouseService.aiChat(query);
      setAnswer(
        result.answer || result.message || "No hay una respuesta disponible.",
      );
    } catch (error) {
      setAnswer("No se pudo consultar el Copilot: " + error.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="copilot-overlay" onClick={onClose}>
      <aside className="copilot-panel" onClick={(e) => e.stopPropagation()}>
        <div className="copilot-header">
          <div className="copilot-title">
            <div className="ai-spark">
              <i className="bi bi-stars" />
            </div>
            <div>
              <strong>Warehouse Copilot</strong>
              <span>IA local · datos y eventos reales</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="copilot-body">
          <div className="copilot-welcome">
            <div className="ai-spark large">
              <i className="bi bi-stars" />
            </div>
            <h3>¿En qué puedo ayudarte?</h3>
            <p>
              Consulto pedidos, stock, proveedores, documentos y eventos de tu
              operación.
            </p>
          </div>
          <div className="suggestions">
            <button
              onClick={() =>
                setQuery("¿Qué pedidos necesitan revisión humana?")
              }
            >
              Pedidos para revisar <i className="bi bi-arrow-up-right" />
            </button>
            <button
              onClick={() =>
                setQuery("¿Qué referencias están por debajo del mínimo?")
              }
            >
              Stock crítico <i className="bi bi-arrow-up-right" />
            </button>
            <button onClick={() => setQuery("Resume las alertas de hoy")}>
              Alertas de hoy <i className="bi bi-arrow-up-right" />
            </button>
          </div>
          {answer && (
            <div className="chat-answer">
              <small>WAREHOUSE COPILOT · API IA LOCAL</small>
              <p>{answer}</p>
            </div>
          )}
        </div>
        <form className="copilot-input" onSubmit={ask}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pregunta sobre tu operación..."
          />
          <button disabled={sending}>
            <i className="bi bi-arrow-up" />
          </button>
        </form>
      </aside>
    </div>
  );
}

function ProcedureDocumentModalPreset({ open, preset, onClose, onSaved }) {
  const { orders, procedures } = useWarehouseData();
  const [form, setForm] = useState({
    externalId: preset?.externalId || "",
    procedureCode: "",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setForm({ externalId: preset?.externalId || "", procedureCode: "" });
      setFile(null);
      setError("");
    }
  }, [open, preset?.externalId]);
  if (!open) return null;
  const update = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    if (!file || !form.externalId || !form.procedureCode) {
      setError(
        "Selecciona el procedimiento y adjunta el documento justificativo.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await warehouseService.uploadProcedureDocument(
        form.externalId,
        form.procedureCode,
        file,
      );
      onSaved();
    } catch (err) {
      setError(err.message || "No se pudo completar el procedimiento");
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Completar procedimiento"
      icon="bi-shield-plus"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          <button
            className="btn-main"
            form="procedure-document-preset-form"
            disabled={saving}
          >
            {saving ? "Guardando..." : "Marcar como completo"}
          </button>
        </>
      }
    >
      <form id="procedure-document-preset-form" onSubmit={submit}>
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label">Pedido</label>
            <select
              className="form-select"
              name="externalId"
              value={form.externalId}
              onChange={update}
              required
              disabled={Boolean(preset?.externalId)}
            >
              <option value="">Selecciona un pedido</option>
              {orders.map((order) => (
                <option value={order.id} key={order.id}>
                  {order.id} · {order.product}
                </option>
              ))}
            </select>
            {preset?.externalId && (
              <div className="form-text">
                Pedido fijado desde la ficha del pedido.
              </div>
            )}
          </div>
          <div className="col-12">
            <label className="form-label">Procedimiento obligatorio</label>
            <select
              className="form-select"
              name="procedureCode"
              value={form.procedureCode}
              onChange={update}
              required
            >
              <option value="">Selecciona un procedimiento</option>
              {procedures.map((item) => (
                <option value={item.code} key={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Documento justificativo</label>
            <input
              className="form-control"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              required
            />
          </div>
        </div>
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        <div className="alert alert-info mt-4 mb-0">
          <i className="bi bi-info-circle me-2" />
          El pedido ya está seleccionado. Solo falta indicar el procedimiento y
          adjuntar el documento.
        </div>
      </form>
    </ModalShell>
  );
}

function OrdersWithProcedure({ onNewOrder, onImport, onCompleteProcedure }) {
  return (
    <Orders
      onNewOrder={onNewOrder}
      onImport={onImport}
      onCompleteProcedure={onCompleteProcedure}
    />
  );
}

export default App;
