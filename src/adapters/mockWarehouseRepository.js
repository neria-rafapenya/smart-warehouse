import { events, invoices, orders, stock, suppliers } from '../domain/mockData'

export const warehouseRepository = {
  getDashboard: async () => ({ orders, stock, events }),
  getOrders: async () => orders,
  getStock: async () => stock,
  getSuppliers: async () => suppliers,
  getInvoices: async () => invoices,
  getEvents: async () => events,
}
