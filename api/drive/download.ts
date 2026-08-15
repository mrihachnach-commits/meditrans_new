import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const fileId = req.query.fileId as string;
  let token = req.query.token as string;

  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!fileId) {
    return res.status(400).json({ error: 'Missing fileId parameter' });
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing Google OAuth access token' });
  }

  try {
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const driveRes = await fetch(driveUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!driveRes.ok) {
      const errText = await driveRes.text().catch(() => '');
      console.error(`[Server Drive Download] Google Drive API returned ${driveRes.status}:`, errText);
      return res.status(driveRes.status).json({ error: `Google Drive API error: ${driveRes.statusText}`, details: errText });
    }

    const contentType = driveRes.headers.get('content-type') || 'application/pdf';
    const contentLength = driveRes.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const arrayBuffer = await driveRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return res.send(buffer);
  } catch (err: any) {
    console.error('[Server Drive Download] Error proxying file download:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
