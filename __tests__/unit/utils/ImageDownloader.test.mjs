import { jest } from '@jest/globals';
import { ImageDownloader } from '../../../src/utils/ImageDownloader.mjs';
import { Issue } from '../../../src/core/Issue.mjs';

// Mock node-fetch module
jest.unstable_mockModule('node-fetch', () => ({
  default: jest.fn()
}));

// Import node-fetch after mocking
const fetch = (await import('node-fetch')).default;

describe('ImageDownloader', () => {
  let imageDownloader;
  let mockLinearClient;
  let mockFileSystem;
  let mockOAuthHelper;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    fetch.mockReset();

    // Create mock dependencies
    mockLinearClient = {
      viewer: jest.fn().mockResolvedValue({ id: 'user-123', name: 'Test User' })
    };

    mockFileSystem = {
      ensureDir: jest.fn().mockResolvedValue(undefined),
      existsSync: jest.fn().mockReturnValue(false),
      writeFile: jest.fn().mockResolvedValue(undefined)
    };

    mockOAuthHelper = {
      hasValidToken: jest.fn().mockResolvedValue(true),
      getAccessToken: jest.fn().mockResolvedValue('oauth-token-123')
    };

    imageDownloader = new ImageDownloader(mockLinearClient, mockFileSystem, mockOAuthHelper);
  });

  describe('extractImageUrls', () => {
    it('should extract Linear upload URLs from text', () => {
      const text = `
        Here is some text with an image:
        https://uploads.linear.app/12345/image1.png
        And another one: https://uploads.linear.app/67890/image2.jpg
        Not a Linear image: https://example.com/image.png
      `;

      const urls = imageDownloader.extractImageUrls(text);

      expect(urls).toHaveLength(2);
      expect(urls).toContain('https://uploads.linear.app/12345/image1.png');
      expect(urls).toContain('https://uploads.linear.app/67890/image2.jpg');
    });

    it('should return empty array for null or empty text', () => {
      expect(imageDownloader.extractImageUrls(null)).toEqual([]);
      expect(imageDownloader.extractImageUrls('')).toEqual([]);
      expect(imageDownloader.extractImageUrls(undefined)).toEqual([]);
    });

    it('should remove duplicate URLs', () => {
      const text = `
        https://uploads.linear.app/12345/image.png
        https://uploads.linear.app/12345/image.png
        https://uploads.linear.app/12345/image.png
      `;

      const urls = imageDownloader.extractImageUrls(text);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://uploads.linear.app/12345/image.png');
    });

    it('should handle URLs in markdown format', () => {
      const text = `
        ![Screenshot](https://uploads.linear.app/12345/screenshot.png)
        [Link](https://uploads.linear.app/67890/file.pdf)
      `;

      const urls = imageDownloader.extractImageUrls(text);
      expect(urls).toHaveLength(2);
    });
  });

  describe('downloadImage', () => {
    beforeEach(() => {
      // Reset fetch mock before each test
      fetch.mockReset();
    });

    it('should download image with OAuth token', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        buffer: jest.fn().mockResolvedValue(mockBuffer)
      });

      const result = await imageDownloader.downloadImage(
        'https://uploads.linear.app/12345/image.png',
        '/workspace/images/image.png'
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://uploads.linear.app/12345/image.png',
        {
          headers: {
            'Authorization': 'Bearer oauth-token-123'
          }
        }
      );
      expect(mockFileSystem.ensureDir).toHaveBeenCalledWith('/workspace/images');
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith('/workspace/images/image.png', mockBuffer);
    });

    it('should fall back to API token when OAuth is not available', async () => {
      mockOAuthHelper.hasValidToken.mockResolvedValue(false);
      process.env.LINEAR_API_TOKEN = 'api-token-456';

      const mockBuffer = Buffer.from('fake-image-data');
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        buffer: jest.fn().mockResolvedValue(mockBuffer)
      });

      const result = await imageDownloader.downloadImage(
        'https://uploads.linear.app/12345/image.png',
        '/workspace/images/image.png'
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://uploads.linear.app/12345/image.png',
        {
          headers: {
            'Authorization': 'api-token-456'
          }
        }
      );

      delete process.env.LINEAR_API_TOKEN;
    });

    it('should handle download failures', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await imageDownloader.downloadImage(
        'https://uploads.linear.app/12345/missing.png',
        '/workspace/images/missing.png'
      );

      expect(result).toBe(false);
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await imageDownloader.downloadImage(
        'https://uploads.linear.app/12345/image.png',
        '/workspace/images/image.png'
      );

      expect(result).toBe(false);
    });
  });

  describe('downloadIssueImages', () => {
    it('should download images from issue description and comments', async () => {
      const issue = new Issue({
        id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        description: 'Check this screenshot: https://uploads.linear.app/12345/screenshot.png',
        comments: {
          nodes: [
            {
              id: 'comment-1',
              body: 'Here is another image: https://uploads.linear.app/67890/image.jpg',
              user: { name: 'User 1' }
            }
          ]
        }
      });

      const mockBuffer = Buffer.from('fake-image-data');
      fetch.mockImplementation(() => Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        buffer: jest.fn().mockResolvedValue(mockBuffer)
      }));

      const result = await imageDownloader.downloadIssueImages(issue, '/workspace');

      expect(result.downloaded).toBe(2);
      expect(result.totalFound).toBe(2);
      expect(result.skipped).toBe(0);
      expect(Object.keys(result.imageMap)).toHaveLength(2);
      expect(result.imageMap['https://uploads.linear.app/12345/screenshot.png']).toMatch(/\.linear-images\/image_1\.png$/);
      expect(result.imageMap['https://uploads.linear.app/67890/image.jpg']).toMatch(/\.linear-images\/image_2\.jpg$/);
    });

    it('should respect the 10 image limit', async () => {
      // Create an issue with 15 image URLs
      const imageUrls = [];
      for (let i = 1; i <= 15; i++) {
        imageUrls.push(`https://uploads.linear.app/${i}/image${i}.png`);
      }

      const issue = new Issue({
        id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        description: imageUrls.join(' '),
        comments: { nodes: [] }
      });

      const mockBuffer = Buffer.from('fake-image-data');
      fetch.mockImplementation(() => Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        buffer: jest.fn().mockResolvedValue(mockBuffer)
      }));

      const result = await imageDownloader.downloadIssueImages(issue, '/workspace', 10);

      expect(result.totalFound).toBe(15);
      expect(result.downloaded).toBe(10);
      expect(result.skipped).toBe(5);
      expect(Object.keys(result.imageMap)).toHaveLength(10);
    });

    it('should handle issues with no images', async () => {
      const issue = new Issue({
        id: 'issue-123',
        identifier: 'TEST-123',
        title: 'Test Issue',
        description: 'No images here',
        comments: { nodes: [] }
      });

      const result = await imageDownloader.downloadIssueImages(issue, '/workspace');

      expect(result.downloaded).toBe(0);
      expect(result.totalFound).toBe(0);
      expect(result.skipped).toBe(0);
      expect(Object.keys(result.imageMap)).toHaveLength(0);
    });
  });

  describe('generateImageManifest', () => {
    it('should generate manifest for downloaded images', () => {
      const downloadResult = {
        imageMap: {
          'https://uploads.linear.app/12345/screenshot.png': '/workspace/.linear-images/image_1.png',
          'https://uploads.linear.app/67890/diagram.jpg': '/workspace/.linear-images/image_2.jpg'
        },
        totalFound: 2,
        downloaded: 2,
        skipped: 0
      };

      const manifest = imageDownloader.generateImageManifest(downloadResult);

      expect(manifest).toContain('## Downloaded Images');
      expect(manifest).toContain('Found 2 images. Downloaded 2');
      expect(manifest).toContain('image_1.png');
      expect(manifest).toContain('image_2.jpg');
      expect(manifest).toContain('You can use the Read tool to view these images');
    });

    it('should mention skipped images in manifest', () => {
      const downloadResult = {
        imageMap: {
          'https://uploads.linear.app/1/image1.png': '/workspace/.linear-images/image_1.png',
          'https://uploads.linear.app/2/image2.png': '/workspace/.linear-images/image_2.png'
        },
        totalFound: 15,
        downloaded: 10,
        skipped: 5
      };

      const manifest = imageDownloader.generateImageManifest(downloadResult);

      expect(manifest).toContain('Found 15 images. Downloaded 10 (skipped 5 due to 10 image limit)');
    });

    it('should handle case with no images', () => {
      const downloadResult = {
        imageMap: {},
        totalFound: 0,
        downloaded: 0,
        skipped: 0
      };

      const manifest = imageDownloader.generateImageManifest(downloadResult);

      expect(manifest).toContain('No images were found in this issue');
    });
  });
});