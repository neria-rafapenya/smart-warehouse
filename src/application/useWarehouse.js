import { warehouseRepository } from '../adapters/warehouseApiRepository'

export const warehouseService = {
  loadAll: () => warehouseRepository.loadAll(),
  createOrder: payload => warehouseRepository.createOrder(payload),
  importOrders: file => warehouseRepository.importOrders(file),
  uploadInvoice: file => warehouseRepository.uploadInvoice(file),
  reconcileInvoice: invoiceNumber => warehouseRepository.reconcileInvoice(invoiceNumber),
  exportInvoice: invoiceNumber => warehouseRepository.exportInvoice(invoiceNumber),
  downloadAccountingExport: format => warehouseRepository.downloadAccountingExport(format),
  uploadProcedureDocument: (externalId, procedureCode, file) => warehouseRepository.uploadProcedureDocument(externalId, procedureCode, file),
  validateOrder: externalId => warehouseRepository.validateOrder(externalId),
}
