'use server';
/**
 * @fileOverview A flow to upload a video file to Google Drive.
 * 
 * - uploadVideo - A function that handles the video upload process.
 */

import { ai } from '@/ai/genkit';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { OAuth2Client } from 'google-auth-library';
import type { UploadVideoInput, UploadVideoOutput } from '@/ai/schemas/uploadVideoSchema';
import { UploadVideoInputSchema, UploadVideoOutputSchema } from '@/ai/schemas/uploadVideoSchema';

const FOLDER_NAME = 'videoverse';

async function findOrCreateFolder(drive: any): Promise<string> {
  const folderQuery = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  
  const searchResponse = await drive.files.list({
    q: folderQuery,
    fields: 'files(id, name)',
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    return searchResponse.data.files[0].id;
  } else {
    const fileMetadata = {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    };
    const createResponse = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    });
    const folderId = createResponse.data.id;
    if (!folderId) {
        throw new Error("Could not create 'videoverse' folder in Google Drive.");
    }
    return folderId;
  }
}

export async function uploadVideo(input: UploadVideoInput): Promise<UploadVideoOutput> {
    return uploadVideoFlow(input);
}

const uploadVideoFlow = ai.defineFlow(
  {
    name: 'uploadVideoFlow',
    inputSchema: UploadVideoInputSchema,
    outputSchema: UploadVideoOutputSchema,
  },
  async (input) => {
    try {
      const { fileDataUri, fileName, mimeType, accessToken } = input;

      const oAuth2Client = new OAuth2Client();
      oAuth2Client.setCredentials({ access_token: accessToken });

      const drive = google.drive({ version: 'v3', auth: oAuth2Client });
      
      const folderId = await findOrCreateFolder(drive);

      const [, data] = fileDataUri.split(',');
      const fileBuffer = Buffer.from(data, 'base64');
      const readable = new Readable();
      readable.push(fileBuffer);
      readable.push(null);

      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: mimeType,
          parents: [folderId],
        },
        media: {
          mimeType: mimeType,
          body: readable,
        },
        fields: 'id',
      });

      const fileId = response.data.id;
      if (!fileId) {
        throw new Error("Google Drive API did not return a file ID.");
      }
      
      // Make the file publicly readable so it can be streamed
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      return { fileId };

    } catch (error: any) {
      console.error("Error uploading to Google Drive:", error.message || error);
      if (error.code === 403) {
          throw new Error('Permissão negada. Verifique se a API do Google Drive está ativada e se o escopo de autenticação está correto.');
      }
      throw new Error(`Failed to upload to Google Drive: ${error.message}`);
    }
  }
);
