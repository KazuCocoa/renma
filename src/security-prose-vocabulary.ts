/**
 * Exact lexical sources shared by prose-oriented security detectors.
 *
 * Detector structure, distance bounds, flags, and capture behavior stay with
 * each owning detector. Similar-looking supersets and subsets intentionally
 * remain local to their classifier.
 */
export const EXTERNAL_UPLOAD_ACTION_TERMS = String.raw`upload|send|post|share|attach|submit|sync|push|publish`;

export const EXTERNAL_UPLOAD_DESTINATION_TERMS = String.raw`external|remote|third[- ]party|pastebin|gist|slack|discord|s3|gcs|cloud|storage|bucket|drive|dropbox|notion|jira|github`;

export const CLOUD_UPLOAD_ACTION_TERMS = String.raw`upload|sync|copy|send|push|publish`;

export const CLOUD_UPLOAD_DESTINATION_TERMS = String.raw`s3|gcs|cloud storage|bucket|drive|dropbox|box|onedrive|blob storage|azure storage|storage`;

export const WORKFLOW_SCOPE_TERMS = String.raw`(?:this|the)\s+(?:workflow|task|process|run|operation)`;

export const BODY_SECRET_TARGET_TERMS = String.raw`secrets?|credentials?|tokens?|passwords?|private keys?|\.env files?`;
