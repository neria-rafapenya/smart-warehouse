import { warehouseRepository } from '../adapters/mockWarehouseRepository'

export const warehouseService = {
  loadDashboard: () => warehouseRepository.getDashboard(),
  loadOrders: () => warehouseRepository.getOrders(),
  loadStock: () => warehouseRepository.getStock(),
  loadSuppliers: () => warehouseRepository.getSuppliers(),
  loadInvoices: () => warehouseRepository.getInvoices(),
  loadEvents: () => warehouseRepository.getEvents(),
}
