import fetch from 'node-fetch';
import path from 'path';

/**
 * Utility class for downloading images from Linear with proper authentication
 */
export class ImageDownloader {
  /**
   * @param {LinearClient} linearClient - Linear API client
   * @param {FileSystem} fileSystem - File system utility
   * @param {OAuthHelper} oauthHelper - OAuth helper for token retrieval
   */
  constructor(linearClient, fileSystem, oauthHelper = null) {
    this.linearClient = linearClient;
    this.fileSystem = fileSystem;
    this.oauthHelper = oauthHelper;
  }

  /**
   * Extract image URLs from text (issue description or comment)
   * @param {string} text - The text to search for image URLs
   * @returns {string[]} - Array of image URLs
   */
  extractImageUrls(text) {
    if (!text) return [];
    
    // Match URLs that start with https://uploads.linear.app
    const regex = /https:\/\/uploads\.linear\.app\/[^\s<>"]+/gi;
    const matches = text.match(regex) || [];
    
    // Remove duplicates
    return [...new Set(matches)];
  }

  /**
   * Download an image from Linear with authentication
   * @param {string} imageUrl - The URL of the image to download
   * @param {string} destinationPath - Where to save the image
   * @returns {Promise<boolean>} - Success status
   */
  async downloadImage(imageUrl, destinationPath) {
    try {
      console.log(`Downloading image from: ${imageUrl}`);
      
      // Get the authorization header from the appropriate source
      let authHeader = '';
      
      // Try OAuth first if available
      if (this.oauthHelper && await this.oauthHelper.hasValidToken()) {
        const token = await this.oauthHelper.getAccessToken();
        authHeader = `Bearer ${token}`;
        console.log('Using OAuth token for image download');
      } else if (process.env.LINEAR_API_TOKEN) {
        // Fall back to API token
        authHeader = process.env.LINEAR_API_TOKEN;
        console.log('Using API token for image download');
      } else if (process.env.LINEAR_PERSONAL_ACCESS_TOKEN) {
        // Fall back to personal access token
        authHeader = `Bearer ${process.env.LINEAR_PERSONAL_ACCESS_TOKEN}`;
        console.log('Using personal access token for image download');
      } else {
        throw new Error('No authentication method available for image download');
      }
      
      const response = await fetch(imageUrl, {
        headers: {
          'Authorization': authHeader
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status || 401} ${response.statusText || 'Unauthorized'}`);
      }
      
      const buffer = await response.buffer();
      
      // Ensure the directory exists
      const dir = path.dirname(destinationPath);
      await this.fileSystem.ensureDir(dir);
      
      // Write the image to disk
      await this.fileSystem.writeFile(destinationPath, buffer);
      
      console.log(`Successfully downloaded image to: ${destinationPath}`);
      return true;
    } catch (error) {
      console.error(`Error downloading image from ${imageUrl}:`, error);
      return false;
    }
  }

  /**
   * Download all images from an issue and its comments
   * @param {Issue} issue - The issue containing potential images
   * @param {string} workspacePath - The workspace directory
   * @param {number} maxImages - Maximum number of images to download (default: 10)
   * @returns {Promise<Object>} - Map of original URLs to local file paths
   */
  async downloadIssueImages(issue, workspacePath, maxImages = 10) {
    const imageMap = {};
    let imageCount = 0;
    let skippedCount = 0;
    
    // Create images directory in workspace
    const imagesDir = path.join(workspacePath, '.linear-images');
    
    // Extract URLs from issue description
    const descriptionUrls = this.extractImageUrls(issue.description);
    
    // Extract URLs from comments
    const commentUrls = [];
    if (issue.comments && issue.comments.nodes) {
      for (const comment of issue.comments.nodes) {
        const urls = this.extractImageUrls(comment.body);
        commentUrls.push(...urls);
      }
    }
    
    // Combine and deduplicate all URLs
    const allUrls = [...new Set([...descriptionUrls, ...commentUrls])];
    
    console.log(`Found ${allUrls.length} unique image URLs in issue ${issue.identifier}`);
    
    if (allUrls.length > maxImages) {
      console.warn(`Warning: Found ${allUrls.length} images but limiting to ${maxImages}. Skipping ${allUrls.length - maxImages} images.`);
    }
    
    // Download images up to the limit
    for (const url of allUrls) {
      if (imageCount >= maxImages) {
        skippedCount++;
        continue;
      }
      
      // Generate a filename based on the URL
      const urlPath = new URL(url).pathname;
      const filename = `image_${imageCount + 1}${path.extname(urlPath) || '.png'}`;
      const localPath = path.join(imagesDir, filename);
      
      const success = await this.downloadImage(url, localPath);
      
      if (success) {
        imageMap[url] = localPath;
        imageCount++;
      }
    }
    
    if (skippedCount > 0) {
      console.log(`Downloaded ${imageCount} images. Skipped ${skippedCount} due to limit.`);
    } else {
      console.log(`Downloaded all ${imageCount} images.`);
    }
    
    return {
      imageMap,
      totalFound: allUrls.length,
      downloaded: imageCount,
      skipped: skippedCount
    };
  }

  /**
   * Generate a markdown section describing downloaded images
   * @param {Object} downloadResult - Result from downloadIssueImages
   * @returns {string} - Markdown formatted string
   */
  generateImageManifest(downloadResult) {
    const { imageMap, totalFound, downloaded, skipped } = downloadResult;
    
    let manifest = '\n## Downloaded Images\n\n';
    
    if (Object.keys(imageMap).length === 0) {
      manifest += 'No images were found in this issue.\n';
      return manifest;
    }
    
    manifest += `Found ${totalFound} images. Downloaded ${downloaded}`;
    if (skipped > 0) {
      manifest += ` (skipped ${skipped} due to 10 image limit)`;
    }
    manifest += '.\n\n';
    
    manifest += 'Images have been downloaded to the `.linear-images` directory:\n\n';
    
    Object.entries(imageMap).forEach(([url, localPath], index) => {
      const filename = path.basename(localPath);
      manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
      manifest += `   Local path: ${localPath}\n\n`;
    });
    
    manifest += 'You can use the Read tool to view these images.\n';
    
    return manifest;
  }
}