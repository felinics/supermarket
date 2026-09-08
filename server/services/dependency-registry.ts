import { createRuntimeStoreResolver } from './runtime-store'
import { DependencyRegistryStore } from '#registry/dependencies/store'
import { R2BlobBackend } from '#registry/storage/r2'

export const getDependencyRegistryStore = createRuntimeStoreResolver({
  remote: (bucket) => new DependencyRegistryStore(new R2BlobBackend(bucket)),
  local: () => import('#registry/storage/local').then(({ LocalBlobBackend }) =>
    new DependencyRegistryStore(new LocalBlobBackend(process.env.REGISTRY_DATA_DIR || `${process.cwd()}/.data/registries`))),
})
