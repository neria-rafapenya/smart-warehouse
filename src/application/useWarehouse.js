import { warehouseRepository } from '../adapters/warehouseApiRepository'

export const warehouseService = {
  login: (email, password) => warehouseRepository.login(email, password),
  me: () => warehouseRepository.me(),
  loadAll: () => warehouseRepository.loadAll(),
  createOrder: payload => warehouseRepository.createOrder(payload),
  importOrders: file => warehouseRepository.importOrders(file),
  previewOrderImport: file => warehouseRepository.previewOrderImport(file),
  uploadInvoice: file => warehouseRepository.uploadInvoice(file),
  reconcileInvoice: invoiceNumber => warehouseRepository.reconcileInvoice(invoiceNumber),
  exportInvoice: invoiceNumber => warehouseRepository.exportInvoice(invoiceNumber),
  downloadAccountingExport: format => warehouseRepository.downloadAccountingExport(format),
  createStockMovement: payload => warehouseRepository.createStockMovement(payload),
  uploadProcedureDocument: (externalId, procedureCode, file) => warehouseRepository.uploadProcedureDocument(externalId, procedureCode, file),
  validateOrder: externalId => warehouseRepository.validateOrder(externalId),
  aiChat: message => warehouseRepository.aiChat(message),
  aiSuggestions: () => warehouseRepository.aiSuggestions(),
  aiAnomalies: () => warehouseRepository.aiAnomalies(),
  runAIAnomalies: () => warehouseRepository.runAIAnomalies(),
  syncIntegration: (code, direction) => warehouseRepository.syncIntegration(code, direction),
}
