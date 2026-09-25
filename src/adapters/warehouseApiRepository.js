const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1'

async function get(path) {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`)
  return response.json()
}

const euro = value => `${Number(value || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`
const dateLabel = value => value ? new Date(value).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

function mapOrder(order) {
  const status = order.status === 'approved' ? 'Aprobado por IA' : order.status === 'blocked' ? 'Bloqueado' : order.status === 'pending' ? 'Revisión humana' : order.status
  return { ...order, id: order.external_id, requester: order.requester || 'Sistema', area: 'Compras', product: order.product || 'Pedido multiproducto', qty: Number(order.requested_quantity || 0), total: euro(order.total), status, date: dateLabel(order.requested_at), reason: order.risk === 'red' ? 'Volumen atípico frente al histórico' : order.risk === 'yellow' ? 'Requiere comprobación de procedimiento' : 'Stock y demanda compatibles' }
}

function mapStock(item) {
  const demand = Number(item.quantity) < Number(item.minimum_quantity) ? 'Alta' : Number(item.quantity) < Number(item.minimum_quantity) * 2 ? 'Media' : 'Baja'
  return { ...item, stock: Number(item.quantity), min: Number(item.minimum_quantity), demand, status: item.status === 'replenish' ? 'Reponer' : 'Óptimo' }
}

function mapSupplier(item) {
  return { ...item, name: item.legal_name, orders: Number(item.orders_count || 0), rating: Number(item.rating || 0).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), lead: `${Number(item.lead_time_days || 0)} días`, status: item.status === 'connected' ? 'Conectado' : 'Revisar contrato' }
}

function mapInvoice(item) {
  return { ...item, id: item.invoice_number, date: item.invoice_date || '—', amount: euro(item.total), confidence: item.confidence ? `${(Number(item.confidence) * 100).toFixed(1).replace('.', ',')}%` : '—', type: 'PDF digital', status: item.status === 'exportable' ? 'Exportable' : 'Pendiente revisar' }
}

function mapEvent(item) {
  const tone = item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info'
  return { ...item, time: dateLabel(item.created_at), type: item.event_type, text: `${item.event_type} procesado`, detail: `Evento ${item.aggregate_id || item.id} registrado`, tone }
}

function mapReceipt(item) {
  const status = item.status === 'unloading' ? 'Descargando' : item.status === 'in_transit' ? 'En camino' : item.status === 'available' ? 'Disponible' : 'Programado'
  const tone = item.status === 'unloading' ? 'success' : item.status === 'in_transit' ? 'info' : item.status === 'available' ? 'neutral' : 'warning'
  return { ...item, name: item.dock_code, supplier: item.supplier || 'Libre', eta: dateLabel(item.expected_at), status, tone, order: item.external_id, product: item.product, qty: Number(item.quantity || 0) }
}

export const warehouseRepository = {
  async loadAll() {
    const [dashboard, orders, stock, suppliers, invoices, events, receipts] = await Promise.all([
      get('/dashboard'), get('/orders'), get('/stock'), get('/suppliers'), get('/documents/invoices'), get('/events?limit=100'), get('/receipts'),
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
      orders: orders.map(mapOrder), stock: stock.map(mapStock), suppliers: suppliers.map(mapSupplier), invoices: invoices.map(mapInvoice), events: events.map(mapEvent), receipts: receipts.map(mapReceipt),
    }
  },
}
