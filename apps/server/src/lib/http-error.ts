import type { ApiError } from '@conbert/schemas';

/**
 * Error codes the API can return. Each maps to a three-part text
 * (`<key>.what`, `.cause`, `.action`) in @conbert/i18n.
 */
export const API_ERROR_KEYS = {
  NOT_FOUND: 'errors.notFound',
  BAD_REQUEST: 'errors.badRequest',
  INTERNAL: 'errors.internal',
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  SETUP_REQUIRED: 'errors.setupRequired',
  SETUP_DONE: 'errors.setupDone',
  INVALID_SETUP_CODE: 'errors.invalidSetupCode',
  INVALID_LOGIN: 'errors.invalidLogin',
  USERNAME_TAKEN: 'errors.usernameTaken',
  WEAK_PASSWORD: 'errors.weakPassword',
  WRONG_PASSWORD: 'errors.wrongPassword',
  LAST_ADMIN: 'errors.lastAdmin',
  CROSS_ORIGIN: 'errors.crossOrigin',
  FILE_TOO_LARGE: 'errors.fileTooLarge',
  QUEUE_UNAVAILABLE: 'errors.queueUnavailable',
  DOWNLOAD_RUNNING: 'errors.whisperDownloadRunning',
  BLENDER_RUNNING: 'errors.blenderRunning',
  BLENDER_UNSUPPORTED: 'errors.blenderUnsupported',
  INVALID_TOKEN: 'errors.invalidToken',
  CONVERSION_FAILED: 'errors.convertFailed',
  QUOTA_EXCEEDED: 'errors.quotaExceeded',
  TOKEN_NOT_ALLOWED: 'errors.tokenNotAllowed',
  NO_SERVER_ROUTE: 'errors.noServerRoute',
  ATTACHMENT_INVALID: 'errors.attachmentInvalid',
  RESULT_GONE: 'errors.resultGone',
  TOO_MANY_ATTEMPTS: 'errors.tooManyAttempts',
  INVALID_USERNAME: 'errors.invalidUsername',
  // Storage locations (NAS, SFTP, WebDAV, S3, local folders)
  STORAGE_AUTH: 'errors.storageAuth',
  STORAGE_UNREACHABLE: 'errors.storageUnreachable',
  STORAGE_NOT_FOUND: 'errors.storageNotFound',
  STORAGE_CERTIFICATE: 'errors.storageCertificate',
  STORAGE_DENIED: 'errors.storageDenied',
  STORAGE_FAILED: 'errors.storageFailed',
  STORAGE_SECRET_LOST: 'errors.storageSecretLost',
  STORAGE_TYPE_UNSUPPORTED: 'errors.storageTypeUnsupported',
  STORAGE_FIELD_MISSING: 'errors.storageFieldMissing',
  STORAGE_ADDRESS_INVALID: 'errors.storageAddressInvalid',
  STORAGE_ROOT_NOT_ALLOWED: 'errors.storageRootNotAllowed',
  STORAGE_PATH_INVALID: 'errors.storagePathInvalid',
  STORAGE_NOT_TARGET: 'errors.storageNotTarget',
  STORAGE_NOT_SOURCE: 'errors.storageNotSource',
  // Swipe game and media index
  MEDIA_NO_DEFAULT: 'errors.mediaNoDefault',
  MEDIA_SYNC_RUNNING: 'errors.mediaSyncRunning',
  MEDIA_ALREADY_SWIPED: 'errors.mediaAlreadySwiped',
  STORAGE_IS_FOLDER: 'errors.storageIsFolder',
  STORAGE_PREVIEW_TOO_LARGE: 'errors.storagePreviewTooLarge',
  // Social-media downloader
  DOWNLOAD_URL_INVALID: 'errors.downloadUrlInvalid',
  DOWNLOAD_PRIVATE_ADDRESS: 'errors.downloadPrivateAddress',
  DOWNLOAD_HOST_UNKNOWN: 'errors.downloadHostUnknown',
  DOWNLOAD_UNSUPPORTED: 'errors.downloadUnsupported',
  DOWNLOAD_LOGIN_REQUIRED: 'errors.downloadLoginRequired',
  DOWNLOAD_NOT_FOUND: 'errors.downloadNotFound',
  DOWNLOAD_RATE_LIMITED: 'errors.downloadRateLimited',
  DOWNLOAD_BLOCKED: 'errors.downloadBlocked',
  DOWNLOAD_NOTHING: 'errors.downloadNothing',
  DOWNLOAD_FAILED: 'errors.downloadFailed',
  DOWNLOAD_TOOL_MISSING: 'errors.downloadToolMissing',
  DOWNLOAD_UPDATE_FAILED: 'errors.downloadUpdateFailed',
  DOWNLOAD_COOKIES_INVALID: 'errors.downloadCookiesInvalid',
  DOWNLOAD_PIXIV_LOGIN: 'errors.downloadPixivLogin',
  PIXIV_CODE_INVALID: 'errors.pixivCodeInvalid',
  PIXIV_CODE_EXPIRED: 'errors.pixivCodeExpired',
  PIXIV_LOGIN_EXPIRED: 'errors.pixivLoginExpired',
  PIXIV_LOGIN_FAILED: 'errors.pixivLoginFailed',
  PIXIV_TOKEN_INVALID: 'errors.pixivTokenInvalid',
  DOWNLOAD_DEVIANTART_LOGIN: 'errors.downloadDeviantartLogin',
  DEVIANTART_APP_INVALID: 'errors.deviantartAppInvalid',
  DEVIANTART_APP_REFUSED: 'errors.deviantartAppRefused',
  DEVIANTART_APP_MISSING: 'errors.deviantartAppMissing',
  DEVIANTART_CODE_INVALID: 'errors.deviantartCodeInvalid',
  DEVIANTART_CODE_EXPIRED: 'errors.deviantartCodeExpired',
  DEVIANTART_LOGIN_EXPIRED: 'errors.deviantartLoginExpired',
  DEVIANTART_LOGIN_FAILED: 'errors.deviantartLoginFailed',
  // Booru
  BOORU_SITE_UNKNOWN: 'errors.booruSiteUnknown',
  BOORU_QUERY_REFUSED: 'errors.booruQueryRefused',
  BOORU_AUTH: 'errors.booruAuth',
  BOORU_NEEDS_ACCOUNT: 'errors.booruNeedsAccount',
  BOORU_USER_ID_INVALID: 'errors.booruUserIdInvalid',
  BOORU_ACCOUNTS_UNSUPPORTED: 'errors.booruAccountsUnsupported',
  FEED_INTERVAL_TOO_SHORT: 'errors.feedIntervalTooShort',
  FEED_NOT_SUBSCRIBABLE: 'errors.feedNotSubscribable',
  KEY_INVALID: 'errors.keyInvalid',
  KEY_NOT_LOCKED: 'errors.keyNotLocked',
  KEY_NO_RECIPIENTS: 'errors.keyNoRecipients',
  BOORU_RATE_LIMITED: 'errors.booruRateLimited',
  BOORU_BLOCKED: 'errors.booruBlocked',
  BOORU_TAG_LIMIT: 'errors.booruTagLimit',
  BOORU_PAGE_LIMIT: 'errors.booruPageLimit',
  BOORU_UNREACHABLE: 'errors.booruUnreachable',
  BOORU_FAILED: 'errors.booruFailed',
  BOORU_INSTANCE_INVALID: 'errors.booruInstanceInvalid',
  BOORU_AGE_REQUIRED: 'errors.booruAgeRequired',
  BOORU_PIN_WRONG: 'errors.booruPinWrong',
  BOORU_NOTHING: 'errors.booruNothing',
  BOORU_JOB_NOT_ACTIVE: 'errors.booruJobNotActive',
  // Workflows & notifications
  WORKFLOW_STEP_UNAVAILABLE: 'errors.workflowStepUnavailable',
  WORKFLOW_IMPORT_INVALID: 'errors.workflowImportInvalid',
  WORKFLOW_SAVE_FAILED: 'errors.workflowSaveFailed',
  NOTIFY_ADDRESS_INVALID: 'errors.notifyAddressInvalid',
  NOTIFY_FIELD_MISSING: 'errors.notifyFieldMissing',
  NOTIFY_FAILED: 'errors.notifyFailed',
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_KEYS;

/** An error with an HTTP status and a translatable message key. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    readonly details?: string,
  ) {
    super(details ? `${code}: ${details}` : code);
    this.name = 'HttpError';
  }
}

export function apiError(code: ApiErrorCode, details?: string): ApiError {
  const error: ApiError['error'] = { code, messageKey: API_ERROR_KEYS[code] };
  if (details !== undefined) error.details = details;
  return { error };
}
