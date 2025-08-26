import { z } from 'zod';

export const UploadVideoInputSchema = z.object({
  fileDataUri: z.string().describe("The video file encoded as a Base64 data URI."),
  fileName: z.string().describe("The name of the video file."),
  mimeType: z.string().describe("The MIME type of the video file."),
  accessToken: z.string().describe("The Google OAuth2 access token."),
});

export type UploadVideoInput = z.infer<typeof UploadVideoInputSchema>;

export const UploadVideoOutputSchema = z.object({
  fileId: z.string().describe("The ID of the uploaded file in Google Drive."),
});

export type UploadVideoOutput = z.infer<typeof UploadVideoOutputSchema>;
