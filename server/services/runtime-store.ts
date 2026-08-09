export interface RuntimeStoreEvent {
  req: { runtime?: unknown }
}

type RuntimeBucket = NonNullable<ApiEnv['SKILL_REGISTRY_BUCKET']>

export function createRuntimeStoreResolver<Store>(options: {
  remote(bucket: RuntimeBucket): Store
  local(): Promise<Store>
}) {
  let localStore: Promise<Store> | undefined
  const remoteStores = new WeakMap<object, Store>()

  return async (event?: RuntimeStoreEvent): Promise<Store> => {
    const runtime = event?.req.runtime as { cloudflare?: { env?: Partial<ApiEnv> } } | undefined
    const cloudflare = runtime?.cloudflare
    if (!cloudflare) {
      localStore ??= options.local()
      return localStore
    }
    const bucket = cloudflare.env?.SKILL_REGISTRY_BUCKET
    if (!bucket || typeof bucket !== 'object') {
      throw new Error('Cloudflare runtime is missing the SKILL_REGISTRY_BUCKET R2 binding')
    }
    let store = remoteStores.get(bucket)
    if (!store) {
      store = options.remote(bucket)
      remoteStores.set(bucket, store)
    }
    return store
  }
}
