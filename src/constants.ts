/**
 * Shared attachment constraints — the single source of truth for which file
 * types the SDK will upload. Both the public `Talk2View.uploadAttachment()`
 * guard and the bundled Composer derive from these, so partners with their own
 * composer get the same client-side validation as the built-in UI.
 */

/** MIME whitelist (mirrors the server). Also drives the file input's `accept`. */
export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

/** The same whitelist as a Set, for O(1) membership checks. */
export const ALLOWED_ATTACHMENT_MIME = new Set(ATTACHMENT_ACCEPT.split(','));

/** Human-readable form of the whitelist, shown in hints and error messages. */
export const ATTACHMENT_TYPES_LABEL = 'PNG, JPEG, WebP, GIF, or PDF';

/** True when `type` is an attachment MIME type the SDK (and server) accepts. */
export function isAllowedAttachmentType(type: string): boolean {
  return ALLOWED_ATTACHMENT_MIME.has(type);
}
