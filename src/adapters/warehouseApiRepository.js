const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1'

async function get(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() })
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`)
  return response.json()
}

async function send(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { ...authHeaders(), ...(options?.headers || {}) } })
  if (!response.ok) {
    const body = await response.text()
    let message = body
    try { message = JSON.parse(body).detail || body } catch { /* conserva el texto original */ }
    throw new Error(message)
  }
  return response.json()
}

function authHeaders() {
  const token = localStorage.getItem('smart_warehouse_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const euro = value => `${Number(value || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`
const dateLabel = value => value ? new Date(value).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

function mapOrder(order) {
  const status = order.status === 'approved' ? 'Aprobado' : order.status === 'validated' ? 'Validado' : order.status === 'sent_to_supplier' ? 'Enviado a proveedor' : order.status === 'received' ? 'Recibido' : order.status === 'closed' ? 'Cerrado' : order.status === 'blocked' ? 'Bloqueado' : order.status === 'pending' ? 'Pendiente' : order.status === 'human_review' ? 'Revisión humana' : order.status
  return { ...order, workflowStatus: order.status, id: order.external_id, requester: order.requester || 'Sistema', area: 'Compras', product: order.product || 'Pedido multiproducto', qty: Number(order.requested_quantity || 0), total: euro(order.total), status, date: dateLabel(order.requested_at), reason: order.risk === 'red' ? 'Volumen atípico frente al histórico' : order.risk === 'yellow' ? 'Requiere comprobación de procedimiento' : 'Stock y demanda compatibles' }
}

function mapStock(item) {
  const demand = Number(item.quantity) < Number(item.minimum_quantity) ? 'Alta' : Number(item.quantity) < Number(item.minimum_quantity) * 2 ? 'Media' : 'Baja'
  return { ...item, stock: Number(item.quantity), min: Number(item.minimum_quantity), demand, status: item.status === 'replenish' ? 'Reponer' : 'Óptimo' }
}

function mapSupplier(item) {
  return { ...item, name: item.legal_name, orders: Number(item.orders_count || 0), rating: Number(item.rating || 0).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), lead: `${Number(item.lead_time_days || 0)} días`, status: item.status === 'connected' ? 'Conectado' : 'Revisar contrato' }
}

function mapInvoice(item) {
  const reconciliationStatus = item.reconciliation_status === 'matched' ? 'Conciliada' : item.reconciliation_status ? 'Revisar conciliación' : 'Pendiente conciliar'
  const accountingStatus = item.accounting_status === 'exported' ? 'Exportado' : item.accounting_status === 'exportable' ? 'Exportable' : 'Pendiente'
  return { ...item, id: item.invoice_number, date: item.invoice_date || '—', amount: euro(item.total), confidence: item.confidence ? `${(Number(item.confidence) * 100).toFixed(1).replace('.', ',')}%` : '—', type: 'PDF digital', orderNumber: item.order_number || '', receiptNumber: item.receipt_number || '', status: item.status === 'exportable' ? 'Exportable' : 'Pendiente revisar', reconciliationStatus, reconciliationTone: item.reconciliation_status === 'matched' ? 'success' : 'warning', accountingStatus, accountingTone: item.accounting_status === 'exported' ? 'success' : item.accounting_status === 'exportable' ? 'info' : 'warning' }
}

function mapProcedure(item) {
  return { ...item, completed: Number(item.completed_orders || 0), missing: Number(item.missing_orders || 0), status: item.status || (Number(item.missing_orders || 0) > 0 ? 'missing' : 'complete') }
}

function mapEvent(item) {
  const tone = item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info'
  let payload = item.payload
  if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch { payload = { raw: payload } } }
  return { ...item, payload: payload || {}, time: dateLabel(item.created_at), type: item.event_type, text: `${item.event_type} procesado`, detail: `Evento ${item.aggregate_id || item.id} registrado`, tone }
}

function mapAlert(item) {
  return { ...item, time: dateLabel(item.created_at), tone: item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info', read: item.status === 'read' }
}

function mapAlertRule(item) {
  const parse = value => Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value) : []
  return { ...item, recipients: parse(item.recipients_json), channels: parse(item.channels_json) }
}

function mapReceipt(item) {
  const status = item.status === 'unloading' ? 'Descargando' : item.status === 'in_transit' ? 'En camino' : item.status === 'available' ? 'Disponible' : 'Programado'
  const tone = item.status === 'unloading' ? 'success' : item.status === 'in_transit' ? 'info' : item.status === 'available' ? 'neutral' : 'warning'
  const resultStatus = item.receipt_result === 'complete' ? 'Completa' : item.receipt_result === 'discrepancy' ? 'Con diferencias' : 'Pendiente'
  return { ...item, name: item.dock_code, supplier: item.supplier || 'Libre', eta: dateLabel(item.expected_at), status, tone: item.receipt_result === 'discrepancy' ? 'danger' : tone, order: item.external_id, product: item.product, qty: Number(item.expected_quantity || 0), received: Number(item.received_quantity || 0), damaged: Number(item.damaged_quantity || 0), resultStatus }
}

function mapMovement(item) {
  const labels = { entry: 'Entrada', exit: 'Salida', reserve: 'Reserva', release: 'Liberación', adjustment: 'Ajuste' }
  const delta = Number(item.quantity_delta || 0)
  return { ...item, movementLabel: labels[item.movement_type] || item.movement_type, quantityLabel: `${delta > 0 ? '+' : ''}${delta}`, reservedLabel: `${Number(item.reserved_delta || 0) > 0 ? '+' : ''}${Number(item.reserved_delta || 0)}` }
}

export const warehouseRepository = {
  login: (email, password) => send('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }),
  me: () => get('/auth/me'),
  aiChat: message => send('/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }),
  aiSuggestions: () => get('/ai/suggestions'),
  aiAnomalies: () => get('/ai/anomalies'),
  aiDemand: sku => get(`/ai/demand${sku ? `?sku=${encodeURIComponent(sku)}` : ''}`),
  aiSupplierComparison: () => get('/ai/suppliers/compare'),
  runAIAnomalies: () => send('/ai/anomalies/run', { method: 'POST' }),
  integrations: () => get('/integrations'),
  integrationHealth: () => get('/integrations/health'),
  syncIntegration: (code, direction = 'outbound') => send(`/integrations/${encodeURIComponent(code)}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) }),
  productOffers: sku => get(`/catalog/products/${encodeURIComponent(sku)}/offers`),
  sandboxSnapshot: () => get('/sandbox'),
  sandboxResource: resource => get(`/sandbox/${encodeURIComponent(resource)}`),
  createOrder: payload => send('/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  previewOrderImport: file => { const form = new FormData(); form.append('file', file); form.append('confirm', 'false'); return send('/imports/orders', { method: 'POST', body: form }) },
  importOrders: file => { const form = new FormData(); form.append('file', file); form.append('confirm', 'true'); return send('/imports/orders', { method: 'POST', body: form }) },
  uploadInvoice: file => { const form = new FormData(); form.append('file', file); return send('/documents/invoices', { method: 'POST', body: form }) },
  reconcileInvoice: invoiceNumber => send(`/documents/invoices/${encodeURIComponent(invoiceNumber)}/reconcile`, { method: 'POST' }),
  exportInvoice: (invoiceNumber, targetSystem = 'corporate-accounting-rest') => send(`/documents/invoices/${encodeURIComponent(invoiceNumber)}/accounting-export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_system: targetSystem }) }),
  downloadAccountingExport: async format => { const response = await fetch(`${API_BASE_URL}/documents/invoices/accounting-export?format=${format}`, { headers: authHeaders() }); if (!response.ok) throw new Error(`API ${response.status}: exportación contable`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `smart-warehouse-accounting.${format === 'xlsx' ? 'xlsx' : 'csv'}`; link.click(); URL.revokeObjectURL(url) },
  downloadEventsExport: async (format, filters = {}) => { const query = new URLSearchParams({ format, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== 'all')) }); const response = await fetch(`${API_BASE_URL}/events/export?${query}`, { headers: authHeaders() }); if (!response.ok) throw new Error(`API ${response.status}: exportación de eventos`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `smart-warehouse-events.${format === 'xlsx' ? 'xlsx' : 'csv'}`; link.click(); URL.revokeObjectURL(url) },
  getEvent: eventId => get(`/events/${eventId}`),
  readAlert: alertId => send(`/alerts/${alertId}/read`, { method: 'POST' }),
  readAllAlerts: () => send('/alerts/read-all', { method: 'POST' }),
  listAlertRules: () => get('/alert-rules'),
  createAlertRule: payload => send('/alert-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateAlertRule: (ruleId, payload) => send(`/alert-rules/${ruleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  uploadProcedureDocument: (externalId, procedureCode, file) => { const form = new FormData(); form.append('file', file); return send(`/orders/${externalId}/procedures/${procedureCode}/documents`, { method: 'POST', body: form }) },
  orderProcedures: externalId => get(`/orders/${externalId}/procedures`),
  validateOrder: externalId => send(`/orders/${externalId}/validate`, { method: 'POST' }),
  transitionOrderStatus: (externalId, status, reason) => send(`/orders/${externalId}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, reason }) }),
  orderStatusHistory: externalId => get(`/orders/${externalId}/status-history`),
  createReceipt: payload => send('/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  createStockMovement: payload => send('/stock/movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  async loadAll() {
    const [dashboard, orders, stock, movements, suppliers, invoices, procedures, events, alerts, receipts, alertRules, integrations] = await Promise.all([
      get('/dashboard'), get('/orders'), get('/stock'), get('/stock/movements?limit=100'), get('/suppliers'), get('/documents/invoices'), get('/documents/procedures'), get('/events?limit=100'), get('/alerts?limit=100'), get('/receipts'), get('/alert-rules'), get('/integrations/health'),
    ])
    const pending = Number(dashboard.orders_pending || 0)
    const lowStock = (stock || []).filter(item => item.status === 'replenish').length
    return {
      kpis: [
        { label: 'Pedidos en validación', value: String(pending), change: 'datos MySQL', tone: 'warning', icon: 'bi-inboxes' },
        { label: 'Nivel de servicio', value: '96,8%', change: 'operación local', tone: 'success', icon: 'bi-speedometer2' },
        { label: 'Alertas activas', value: String(lowStock), change: 'stock bajo', tone: 'danger', icon: 'bi-bell' },
        { label: 'Referencias activas', value: String(dashboard.stock_items || 0), change: 'datos MySQL', tone: 'info', icon: 'bi-box-seam' },
      ],
      orders: orders.map(mapOrder), stock: stock.map(mapStock), movements: movements.map(mapMovement), suppliers: suppliers.map(mapSupplier), invoices: invoices.map(mapInvoice), procedures: procedures.map(mapProcedure), events: events.map(mapEvent), alerts: alerts.map(mapAlert), alertRules: alertRules.map(mapAlertRule), receipts: receipts.map(mapReceipt), integrations,
    }
  },
}
