import admin from "firebase-admin";
import { firebaseConfig, getAdminApp, getAdminFirestore } from "../../lib/firebaseAdmin.js";
import { getEffectiveUserLevel } from "../../src/types";

let roundRobinCounter = 0;

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.5-preview",
  "claude-3-5-sonnet",
  "claude-3-7-sonnet",
  "o3-mini",
  "deepseek-r1",
  "deepseek-v3",
  ...String(process.env.SYSTEM_AI_ALLOWED_MODELS || "")
    .split(",")
    .map(m => m.trim())
    .filter(Boolean)
]);
const DEFAULT_MODEL = (process.env.SYSTEM_AI_DEFAULT_MODEL || "gemini-2.5-flash-lite").trim();

const PRIMARY_ADMIN_EMAILS = ["hoanghiep1296@gmail.com", "mrihachnach@gmail.com"];
const PRIMARY_ADMIN_UIDS = ["4cFbfQhPMpgStJXZ9EpAVcd90i33"];

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Validate Header Authorization
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Thiếu token xác thực Firebase." });
  }

  const idToken = authHeader.split("Bearer ")[1].trim();

  // Validate Admin SDK Service Account presence
  const adminApp = getAdminApp();
  const hasServiceAccount = Boolean(
    adminApp && 
    process.env.FIREBASE_CLIENT_EMAIL && 
    process.env.FIREBASE_PRIVATE_KEY
  );

  if (!hasServiceAccount) {
    return res.status(500).json({ 
      error: "Chưa cấu hình Firebase Admin SDK Service Account. Không thể xác thực token phía máy chủ." 
    });
  }

  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await admin.auth(adminApp!).verifyIdToken(idToken);
  } catch (err: any) {
    return res.status(401).json({ error: "Token xác thực không hợp lệ hoặc đã hết hạn." });
  }

  const uid = decodedToken.uid;
  const userEmail = (decodedToken.email || "").toLowerCase();
  const isEmailVerified = Boolean(decodedToken.email_verified || decodedToken.emailVerified);
  const isPrimaryAdmin = (PRIMARY_ADMIN_UIDS.includes(uid) || (userEmail !== "" && PRIMARY_ADMIN_EMAILS.includes(userEmail) && isEmailVerified));

  // 2. Fetch user profile from Admin Firestore
  const dbId = firebaseConfig.firestoreDatabaseId || 'ai-studio-274cca7a-128b-4f84-92a2-6b79856d515b';
  const adminDb = getAdminFirestore(adminApp!, dbId);

  let userProfile: any = null;
  try {
    const snap = await adminDb.collection("users").doc(uid).get();
    if (snap.exists) {
      userProfile = snap.data();
    }
  } catch (e: any) {
    console.error("[api/ai/chat] Error reading user doc:", e.message);
  }

  if (isPrimaryAdmin) {
    userProfile = { ...userProfile, role: 'admin' };
  }

  if (userProfile?.isBlocked && !isPrimaryAdmin) {
    return res.status(403).json({ error: "Tài khoản của bạn đã bị khóa." });
  }

  const effectiveLevel = getEffectiveUserLevel(userProfile);
  if (effectiveLevel < 2) {
    return res.status(403).json({ error: "Tài khoản của bạn chưa đủ Level 2 hoặc đã hết hạn." });
  }

  // 3. Body size limit check (~4MB)
  const bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(bodyString, 'utf8') > 4 * 1024 * 1024) {
    return res.status(413).json({ error: "Kích thước yêu cầu vượt quá giới hạn cho phép (4MB)." });
  }

  const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { model, messages, stream, temperature, max_tokens } = bodyData || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Danh sách tin nhắn (messages) không hợp lệ." });
  }

  const selectedModel = model && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  if (model && !ALLOWED_MODELS.has(model)) {
    console.warn(`[api/ai/chat] Model "${model}" không nằm trong danh sách cho phép, dùng ${DEFAULT_MODEL}.`);
  }

  // 4. Fetch active systemShopAiKeys from Admin Firestore
  let systemKeys: Array<{ id: string; value: string; name?: string }> = [];
  try {
    const snap = await adminDb.collection("systemShopAiKeys").where("isActive", "==", true).get();
    systemKeys = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
  } catch (e: any) {
    console.error("[api/ai/chat] Error fetching systemShopAiKeys:", e.message);
  }

  if (systemKeys.length === 0) {
    return res.status(503).json({ error: "Hệ thống hiện chưa có API Key khả dụng." });
  }

  const requestPayload = {
    model: selectedModel,
    messages,
    stream: Boolean(stream),
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    ...(typeof max_tokens === 'number' ? { max_tokens } : {})
  };

  // 5. Execute Upstream Request with Key Rotation
  const baseUrl = (process.env.SYSTEM_AI_BASE_URL || "https://api.shopaikey.com/v1").replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/chat/completions`;
  const isStream = Boolean(stream);

  let lastErrorMsg = "";
  const abortController = new AbortController();
  res.on?.('close', () => {
    if (!res.writableEnded) abortController.abort();
  });
  const startIndex = roundRobinCounter % systemKeys.length;
  roundRobinCounter = (roundRobinCounter + 1) % systemKeys.length;

  for (let attempt = 0; attempt < systemKeys.length; attempt++) {
    const keyObj = systemKeys[(startIndex + attempt) % systemKeys.length];
    const apiKey = (keyObj.value || "").trim();
    if (!apiKey) continue;

    const maskedKey = apiKey.length >= 4 ? `...${apiKey.slice(-4)}` : "...";
    console.log(`[api/ai/chat] Attempting upstream call with key (${keyObj.id}, ${maskedKey}) for model: ${selectedModel}`);

    try {
      const upstreamRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestPayload),
        signal: abortController.signal
      });

      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text().catch(() => "");
        console.warn(`[api/ai/chat] Key ${maskedKey} returned status ${upstreamRes.status}: ${errText.substring(0, 150)}`);
        
        if ([401, 429].includes(upstreamRes.status) || upstreamRes.status >= 500) {
          lastErrorMsg = `Upstream status ${upstreamRes.status}: ${errText.substring(0, 100)}`;
          continue;
        }

        return res.status(upstreamRes.status).json({
          error: `Lỗi từ AI Provider (${upstreamRes.status}): ${errText.substring(0, 200)}`
        });
      }

      if (isStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        if (upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          while (true) {
            if (abortController.signal.aborted) {
              await reader.cancel().catch(() => {});
              break;
            }
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
        return;
      } else {
        const json = await upstreamRes.json();
        return res.status(200).json(json);
      }
    } catch (fetchErr: any) {
      if (fetchErr.name === 'AbortError' || abortController.signal.aborted) {
        console.log('[api/ai/chat] Client closed request.');
        if (!res.headersSent) res.status(499).end();
        else if (!res.writableEnded) res.end();
        return;
      }
      console.warn(`[api/ai/chat] Network error with key ${maskedKey}:`, fetchErr.message);
      lastErrorMsg = fetchErr.message;
      continue;
    }
  }

  return res.status(502).json({
    error: "Tất cả các API Key hệ thống hiện đang bận hoặc quá tải. Vui lòng thử lại sau.",
    details: lastErrorMsg
  });
}
