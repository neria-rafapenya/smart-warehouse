import { warehouseRepository } from '../adapters/warehouseApiRepository'

export const warehouseService = {
  loadAll: () => warehouseRepository.loadAll(),
}
