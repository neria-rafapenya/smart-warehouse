export const kpis = [
  { label: 'Pedidos en validación', value: '24', change: '+8,4%', tone: 'warning', icon: 'bi-inboxes' },
  { label: 'Nivel de servicio', value: '96,8%', change: '+2,1%', tone: 'success', icon: 'bi-speedometer2' },
  { label: 'Alertas activas', value: '07', change: '3 críticas', tone: 'danger', icon: 'bi-bell' },
  { label: 'Ahorro estimado', value: '18.420 €', change: 'este mes', tone: 'info', icon: 'bi-graph-up-arrow' },
]

export const orders = [
  { id: 'PED-2025-00482', requester: 'Laura Martín', area: 'Compras', product: 'Grifo Roca monomando cromado', qty: 250, total: '17.800 €', status: 'Revisión humana', risk: 'red', date: 'Hoy, 09:42', reason: 'Volumen 10× superior a la media histórica' },
  { id: 'PED-2025-00481', requester: 'Javier Soler', area: 'Reposición', product: 'Tubo multicapa PEX 16 mm', qty: 840, total: '4.536 €', status: 'Aprobado por IA', risk: 'green', date: 'Hoy, 09:18', reason: 'Stock y demanda compatibles' },
  { id: 'PED-2025-00480', requester: 'Marta Gil', area: 'Obra Madrid Norte', product: 'Cable RZ1-K 0,6/1 kV 3G2.5', qty: 1200, total: '3.960 €', status: 'Revisión humana', risk: 'yellow', date: 'Hoy, 08:56', reason: 'Procedimiento de obra pendiente de adjuntar' },
  { id: 'PED-2025-00479', requester: 'David Cano', area: 'Reposición', product: 'Llave de paso esfera 1/2"', qty: 60, total: '318 €', status: 'Aprobado por IA', risk: 'green', date: 'Ayer, 17:22', reason: 'Patrón recurrente confirmado' },
  { id: 'PED-2025-00478', requester: 'Ana Ruiz', area: 'Compras', product: 'Bomba de achique 750 W', qty: 18, total: '1.422 €', status: 'Pendiente', risk: 'yellow', date: 'Ayer, 16:48', reason: 'Proveedor alternativo detectado' },
]

export const stock = [
  { sku: 'ROCA-A5A3', product: 'Grifo Roca monomando cromado', category: 'Fontanería', stock: 86, min: 50, demand: 'Alta', location: 'A-01-04', status: 'Óptimo' },
  { sku: 'PEX-16-ML', product: 'Tubo multicapa PEX 16 mm', category: 'Fontanería', stock: 1240, min: 400, demand: 'Media', location: 'B-04-02', status: 'Óptimo' },
  { sku: 'RZ1-3G25', product: 'Cable RZ1-K 3G2.5', category: 'Electricidad', stock: 2140, min: 1000, demand: 'Alta', location: 'C-02-01', status: 'Óptimo' },
  { sku: 'BOM-750W', product: 'Bomba de achique 750 W', category: 'Fontanería', stock: 7, min: 12, demand: 'Alta', location: 'A-08-03', status: 'Reponer' },
  { sku: 'LLV-12-ESF', product: 'Llave de paso esfera 1/2"', category: 'Fontanería', stock: 340, min: 90, demand: 'Baja', location: 'A-03-06', status: 'Óptimo' },
  { sku: 'LED-PL-24', product: 'Panel LED 60×60 40W', category: 'Electricidad', stock: 42, min: 80, demand: 'Media', location: 'C-05-04', status: 'Reponer' },
]

export const suppliers = [
  { name: 'Roca Sanitario, S.A.', category: 'Fontanería', orders: 42, rating: '4,8', lead: '3 días', status: 'Conectado' },
  { name: 'Saltoki Suministros', category: 'Fontanería / Electricidad', orders: 68, rating: '4,6', lead: '2 días', status: 'Conectado' },
  { name: 'General Cable', category: 'Electricidad', orders: 24, rating: '4,4', lead: '5 días', status: 'Revisar contrato' },
  { name: 'Sonepar Ibérica', category: 'Electricidad', orders: 31, rating: '4,7', lead: '2 días', status: 'Conectado' },
]

export const events = [
  { time: '09:42:18', type: 'IA · ALERTA', tone: 'danger', text: 'PED-2025-00482 derivado a revisión humana', detail: 'Volumen atípico: 250 uds. vs. media 24 uds.' },
  { time: '09:41:51', type: 'DOCUMENTO', tone: 'info', text: 'Factura FAC-2025-0198 interpretada', detail: '18 líneas · confianza 98,7%' },
  { time: '09:38:04', type: 'STOCK', tone: 'success', text: 'Entrada confirmada en ubicación B-04-02', detail: '840 uds. tubo multicapa PEX 16 mm' },
  { time: '09:35:22', type: 'IA · SUGERENCIA', tone: 'warning', text: 'Alternativa detectada para BOM-750W', detail: 'Proveedor Saltoki: -6,2% coste unitario' },
  { time: '09:18:45', type: 'PEDIDO', tone: 'success', text: 'PED-2025-00481 aprobado automáticamente', detail: 'Todas las reglas de validación superadas' },
]

export const invoices = [
  { id: 'FAC-2025-0198', supplier: 'Saltoki Suministros', date: '25 sep 2025', amount: '12.480,60 €', confidence: '98,7%', status: 'Conciliada', type: 'PDF digital' },
  { id: 'FAC-2025-0197', supplier: 'General Cable', date: '25 sep 2025', amount: '8.925,00 €', confidence: '94,2%', status: 'Pendiente revisar', type: 'Escaneada' },
  { id: 'FAC-2025-0196', supplier: 'Roca Sanitario, S.A.', date: '24 sep 2025', amount: '17.800,00 €', confidence: '99,1%', status: 'Exportable', type: 'PDF digital' },
]
