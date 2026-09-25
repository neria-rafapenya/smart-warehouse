import { warehouseRepository } from '../adapters/warehouseApiRepository'

export const warehouseService = {
  loadAll: () => warehouseRepository.loadAll(),
  createOrder: payload => warehouseRepository.createOrder(payload),
  importOrders: file => warehouseRepository.importOrders(file),
  uploadInvoice: file => warehouseRepository.uploadInvoice(file),
  validateOrder: externalId => warehouseRepository.validateOrder(externalId),
}
