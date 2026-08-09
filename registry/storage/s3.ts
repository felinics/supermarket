import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { ConditionalBlobBackend, StreamingBlobBackend } from './contracts'

export interface S3BlobBackendOptions {
  accountID: string
  accessKeyID: string
  secretAccessKey: string
  bucket: string
}

export class S3BlobBackend implements ConditionalBlobBackend, StreamingBlobBackend {
  private readonly client: S3Client

  constructor(private readonly options: S3BlobBackendOptions) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${options.accountID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: options.accessKeyID,
        secretAccessKey: options.secretAccessKey,
      },
    })
  }

  private async getObject(key: string) {
    try {
      return await this.client.send(new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      }))
    } catch (error) {
      const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (failure.name === 'NoSuchKey' || failure.$metadata?.httpStatusCode === 404) return null
      throw error
    }
  }

  async get(key: string) {
    const response = await this.getObject(key)
    return response?.Body
      ? new Uint8Array(await response.Body.transformToByteArray())
      : null
  }

  async getWithVersion(key: string) {
    const response = await this.getObject(key)
    if (!response?.Body) return null
    if (!response.ETag) throw new Error(`S3 object read without an ETag: ${key}`)
    return { value: new Uint8Array(await response.Body.transformToByteArray()), version: response.ETag }
  }

  async getStream(key: string) {
    const response = await this.getObject(key)
    if (!response?.Body) return null
    return {
      body: response.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      size: response.ContentLength,
    }
  }

  async put(key: string, value: Uint8Array) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: value,
    }))
  }

  async putConditional(key: string, value: Uint8Array, expectedVersion: string | null) {
    try {
      const response = await this.client.send(new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: value,
        ...(expectedVersion === null ? { IfNoneMatch: '*' } : { IfMatch: expectedVersion }),
      }))
      if (!response.ETag) throw new Error(`S3 conditional write completed without an ETag: ${key}`)
      return response.ETag
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 412) return null
      throw error
    }
  }

  async list(prefix: string) {
    const keys: string[] = []
    let continuationToken: string | undefined
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.options.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }))
      for (const item of response.Contents ?? []) {
        if (item.Key) keys.push(item.Key)
      }
      continuationToken = response.NextContinuationToken
    } while (continuationToken)
    return keys.sort()
  }

  async listPrefixes(prefix: string) {
    const prefixes: string[] = []
    let continuationToken: string | undefined
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.options.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken,
      }))
      for (const item of response.CommonPrefixes ?? []) {
        if (item.Prefix) prefixes.push(item.Prefix)
      }
      continuationToken = response.NextContinuationToken
    } while (continuationToken)
    return prefixes.sort()
  }
}
