/**
 * Tags.js - pure. (Phase 12 B2 completes this module: normalising, search.)
 * System tags mark how a row was captured; they are hidden in the UI but stay searchable.
 */
export const SYSTEM_TAGS = ['auto-sms', 'auto-sync'];

const isSystem = (tag) => SYSTEM_TAGS.includes(String(tag || '').toLowerCase());

/** Tags to show on a row: user tags only, without a leading '#'. */
export const visibleTags = (tags) =>
  (Array.isArray(tags) ? tags : []).filter((g) => g && !isSystem(g)).map((g) => String(g).replace(/^#/, ''));
