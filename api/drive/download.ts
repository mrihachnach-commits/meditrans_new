import type { Request, Response } from "express";
import { Readable } from "node:stream";

/**
 * Server Streaming Proxy for Google Drive PDF files.
 * Streams data directly from Google Drive API to client (Direct Piping)
 * without buffering in server memory (RAM).
 */
export default async function handler(req: Request, res: Response) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const fileId = (req.query.fileId as string) || (req.query.id as string);
  
  let token = "";
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split("Bearer ")[1].trim();
  } else if (req.query.token) {
    token = req.query.token as string;
  }

  if (!fileId) {
    return res.status(400).json({ error: "Thiếu parameter fileId" });
  }

  if (!token) {
    return res.status(401).json({ error: "Thiếu OAuth token kết nối Google Drive" });
  }

  try {
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const driveRes = await fetch(driveUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!driveRes.ok) {
      const errText = await driveRes.text().catch(() => "");
      return res.status(driveRes.status).send(errText || `Google Drive API error ${driveRes.status}`);
    }

    const contentType = driveRes.headers.get("content-type") || "application/pdf";
    const contentLength = driveRes.headers.get("content-length");
    const contentDisposition = driveRes.headers.get("content-disposition");

    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentDisposition) res.setHeader("Content-Disposition", contentDisposition);
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (driveRes.body) {
      // Direct Piping using Readable.fromWeb without server RAM buffering
      // @ts-ignore
      const nodeStream = Readable.fromWeb(driveRes.body);
      nodeStream.pipe(res);
      nodeStream.on("error", (err) => {
        console.error("[Drive Streaming Proxy] Piping error:", err);
        if (!res.headersSent) {
          res.status(500).end("Drive streaming proxy error");
        }
      });
    } else {
      res.status(500).json({ error: "Google Drive returned empty body" });
    }
  } catch (error: any) {
    console.error("[Drive Streaming Proxy] Exception:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Lỗi máy chủ proxy Google Drive" });
    }
  }
}
