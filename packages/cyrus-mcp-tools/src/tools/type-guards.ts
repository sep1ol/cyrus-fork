/**
 * Type guards for upload_file tool arguments
 */

export interface UploadFileArgs {
  filePath: string;
  filename?: string;
  contentType?: string;
  makePublic?: boolean;
}

export function isUploadFileArgs(args: unknown): args is UploadFileArgs {
  if (typeof args !== 'object' || args === null) {
    return false;
  }

  const obj = args as any;

  // Required field
  if (typeof obj.filePath !== 'string') {
    return false;
  }

  // Optional fields
  if (obj.filename !== undefined && typeof obj.filename !== 'string') {
    return false;
  }

  if (obj.contentType !== undefined && typeof obj.contentType !== 'string') {
    return false;
  }

  if (obj.makePublic !== undefined && typeof obj.makePublic !== 'boolean') {
    return false;
  }

  return true;
}
