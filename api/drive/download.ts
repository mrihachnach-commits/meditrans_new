import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { verifyUserToken } from "../_utils.js";

// v10.3: chỉ nhận fileId đúng dạng Google Drive (chặn chèn đường dẫn / tham số)
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

const sendJsonError = (res: Response, status: number, error: string, code?: string) => {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.removeHeader("Content-Disposition");
  return res.status(status).json(code ? { error, code } : { error });
};

/**
 * Server Streaming Proxy for Google Drive PDF files.
 * Streams data directly from Google Drive API to client (Direct Piping)
 * without buffering in server memory (RAM).
 *
 * v10.3 (bảo mật):
 *  - Bắt buộc Firebase ID token (Authorization: Bearer <idToken>) — chỉ người dùng đã đăng nhập dùng được proxy.
 *  - OAuth token Google gửi qua header X-Google-Token (không còn nhận ?token= trên URL → không lộ trong log).
 *  - Bỏ CORS "*" (chỉ dùng cùng origin), luôn trả PDF dạng tệp tải về + nosniff, lỗi trả JSON.
 */
export default async function handler(req: Request, res: Response) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET") {
    return sendJsonError(res, 405, "Method not allowed");
  }

  // v10.3: xác thực người dùng Firebase
  try {
    await verifyUserToken(req);
  } catch (err: any) {
    const status = Number(err?.status) || 401;
    return sendJsonError(res, status, typeof err?.error === "string" ? err.error : "Xác thực thất bại.", "AUTH_FIREBASE");
  }

  const rawFileId = (req.query.fileId as string) || (req.query.id as string) || "";
  const fileId = typeof rawFileId === "string" ? rawFileId.trim() : "";
  if (!fileId || !FILE_ID_RE.test(fileId)) {
    return sendJsonError(res, 400, "Tham số fileId không hợp lệ");
  }

  const googleHeader = req.headers["x-google-token"];
  const token = (Array.isArray(googleHeader) ? googleHeader[0] : googleHeader || "").toString().trim();
  if (!token || token.length > 4096) {
    return sendJsonError(res, 401, "Thiếu OAuth token kết nối Google Drive", "AUTH_GOOGLE");
  }

  try {
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const driveRes = await fetch(driveUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!driveRes.ok) {
      // v10.3: không chuyển tiếp nội dung lỗi thô của Google cho client (chỉ ghi log)
      const errText = await driveRes.text().catch(() => "");
      console.warn(`[Drive Streaming Proxy] Google Drive API error ${driveRes.status}: ${errText.substring(0, 200)}`);
      const status = [401, 403, 404, 429].includes(driveRes.status) ? driveRes.status : 502;
      return sendJsonError(res, status, `Google Drive API error ${driveRes.status}`, driveRes.status === 401 ? "AUTH_GOOGLE" : undefined);
    }

    const contentLength = driveRes.headers.get("content-length");

    // v10.3: luôn trả PDF/octet-stream dạng tệp đính kèm (không để trình duyệt hiển thị nội dung tuỳ ý cùng origin)
    const upstreamType = (driveRes.headers.get("content-type") || "").toLowerCase();
    res.setHeader("Content-Type", upstreamType.startsWith("application/pdf") ? "application/pdf" : "application/octet-stream");
    if (contentLength && /^\d+$/.test(contentLength)) res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Disposition", `attachment; filename="${fileId}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (driveRes.body) {
      // Direct Piping using Readable.fromWeb without server RAM buffering
      // @ts-ignore
      const nodeStream = Readable.fromWeb(driveRes.body);
      nodeStream.on("error", (err: any) => {
        console.error("[Drive Streaming Proxy] Piping error:", err);
        if (!res.headersSent) {
          sendJsonError(res, 500, "Drive streaming proxy error");
        } else if (!res.writableEnded) {
          res.end();
        }
      });
      nodeStream.pipe(res);
    } else {
      return sendJsonError(res, 502, "Google Drive returned empty body");
    }
  } catch (error: any) {
    // v10.3: chỉ ghi log chi tiết, trả thông báo chung
    console.error("[Drive Streaming Proxy] Exception:", error);
    return sendJsonError(res, 500, "Lỗi máy chủ proxy Google Drive");
  }
}
