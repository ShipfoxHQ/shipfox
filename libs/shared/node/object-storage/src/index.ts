export type {
  ObjectStorageS3BaseProfile,
  ObjectStorageS3Credentials,
  ObjectStorageS3Profile,
  ObjectStorageS3ProfileOverrides,
} from './config.js';
export {
  loadObjectStorageS3Profile,
  objectStorageConfigSchema,
  objectStorageS3Profile,
  resolveObjectStorageS3Profile,
} from './config.js';
export {
  ObjectStorageDeleteError,
  type ObjectStorageDeleteFailure,
  ObjectStorageScopeError,
  ObjectStorageUploadAbortedError,
} from './errors.js';
export type {
  AbortMultipartUploadParams,
  CompletedUploadPart,
  CompleteMultipartUploadParams,
  CreateMultipartUploadParams,
  CreateS3ObjectStoreOptions,
  PresignedObjectGet,
  PresignUploadPartParams,
  PutMultipartObjectParams,
  PutObjectBytesParams,
  StoredObjectBytes,
  StoredObjectHead,
  StoredObjectStream,
} from './store.js';
export {assertObjectStoragePrefix, createS3ObjectStore, S3ObjectStore} from './store.js';
