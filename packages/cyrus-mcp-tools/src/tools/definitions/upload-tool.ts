import type { MCPToolDefinition } from '../../types.js';

/**
 * Tool for uploading files to Linear.
 * This tool handles the complete upload process:
 * 1. Requests a pre-signed upload URL from Linear
 * 2. Uploads the file to Linear's cloud storage
 * 3. Returns the asset URL for use in issues/comments
 */
export const uploadFileToolDefinition: MCPToolDefinition = {
  name: 'linear_upload_file',
  description: 'Upload a file to Linear. Returns an asset URL that can be used in issue descriptions or comments.',
  input_schema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The absolute path to the file to upload'
      },
      filename: {
        type: 'string',
        description: 'The filename to use in Linear (optional, defaults to basename of filePath)'
      },
      contentType: {
        type: 'string',
        description: 'MIME type of the file (optional, auto-detected if not provided)'
      },
      makePublic: {
        type: 'boolean',
        description: 'Whether to make the file publicly accessible (default: false)'
      }
    },
    required: ['filePath']
  },
  output_schema: {
    type: 'object',
    properties: {
      assetUrl: {
        type: 'string',
        description: 'The URL of the uploaded file that can be used in Linear'
      },
      filename: {
        type: 'string',
        description: 'The filename used for the upload'
      },
      size: {
        type: 'number',
        description: 'The size of the uploaded file in bytes'
      },
      contentType: {
        type: 'string',
        description: 'The MIME type of the uploaded file'
      }
    }
  }
};