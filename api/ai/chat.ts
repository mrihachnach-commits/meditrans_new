import admin from "firebase-admin";
import { firebaseConfig, getAdminApp, getAdminFirestore } from "../../lib/firebaseAdmin.js";
import { getEffectiveUserLevel } from "../../src/types";
import { isPrimaryAdminToken } from "../_utils.js";
import { acquireQuota, releaseQuota, estimateTokens, isDenied, usageFromJson, AI_MAX_CONCURRENT } from "../_aiQuota";

let roundRobinCounter = 0;

// v10.3: chỉ cho phép các model rẻ mà ứng dụng thực sự dùng (geminiService.mapModelForOpenAI + ô chọn trong Cài đặt).
// Model khác (đắt: gpt-4o, gpt-4.5, claude, o3, *-pro…) phải được thêm có chủ đích qua biến môi trường SYSTEM_AI_ALLOWED_MODELS.
const ALLOWED_MODELS = new Set([
  "gpt-6-luna", // v10.4
  "gpt-4.1-nano", // v10.8: mặc định dịch giữ định dạng
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4.1",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  ...String(process.env.SYSTEM_AI_ALLOWED_MODELS || "")
    .split(",")
    .map(m => m.trim())
    .filter(Boolean)
]);

// v10.3: giới hạn đầu ra / số tin nhắn / kích thước từng phần
const MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_OUTPUT_TOKENS = 4096;
const MAX_MESSAGES = 40;
const MAX_TEXT_CHARS = 1_000_000;
const MAX_IMAGE_URL_CHARS = 4 * 1024 * 1024;

// v10.4: giới hạn tần suất / đồng thời / token theo ngày chuyển sang api/_aiQuota.ts (Firestore, dùng chung mọi instance)

// v10.3: kiểm tra & làm sạch cấu trúc messages (chỉ chuyển tiếp các trường hợp lệ)
const sanitizeMessages = (messages: any): any[] | null => {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  const out: any[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null;
    if (!['system', 'user', 'assistant'].includes(m.role)) return null;
    if (typeof m.content === 'string') {
      if (m.content.length > MAX_TEXT_CHARS) return null;
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content) || m.content.length === 0 || m.content.length > 20) return null;
    const parts: any[] = [];
    for (const p of m.content) {
      if (p?.type === 'text' && typeof p.text === 'string' && p.text.length <= MAX_TEXT_CHARS) {
        parts.push({ type: 'text', text: p.text });
      } else if (p?.type === 'image_url' && typeof p.image_url?.url === 'string'
        && p.image_url.url.length <= MAX_IMAGE_URL_CHARS
        && /^(data:image\/(png|jpe?g|webp|gif);base64,|https:\/\/)/i.test(p.image_url.url)) {
        const detail = ['low', 'high', 'auto'].includes(p.image_url.detail) ? p.image_url.detail : undefined;
        parts.push({ type: 'image_url', image_url: detail ? { url: p.image_url.url, detail } : { url: p.image_url.url } });
      } else {
        return null;
      }
    }
    out.push({ role: m.role, content: parts });
  }
  return out;
};

// v10.3: lỗi từ AI Provider — chỉ trả đoạn ngắn đã che chuỗi giống key (client cần thông tin này để đổi reasoning_effort/response_format)
const safeUpstreamText = (t: string): string =>
  String(t || '').replace(/(sk|key|Bearer)[-_ ]?[A-Za-z0-9_\-]{8,}/gi, '$1-***').substring(0, 200);

// v8.0: mặc định gpt-4.1-mini (đổi bằng biến môi trường SYSTEM_AI_DEFAULT_MODEL)
const DEFAULT_MODEL = (process.env.SYSTEM_AI_DEFAULT_MODEL || "gpt-4.1-mini").trim();


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
  // v10.3: dùng chung hàm kiểm tra admin chính (email phải đã xác minh)
  const isPrimaryAdmin = isPrimaryAdminToken(decodedToken);

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

  // v10.3: JSON.parse an toàn
  let bodyData: any;
  try {
    bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Dữ liệu yêu cầu không phải JSON hợp lệ." });
  }
  const { model, messages: rawMessages, stream, temperature, reasoning_effort, response_format } = bodyData || {};
  const max_tokens = bodyData?.max_tokens ?? bodyData?.max_completion_tokens; // v10.4

  // v10.3: kiểm tra cấu trúc / số lượng / kích thước messages
  const messages = sanitizeMessages(rawMessages);
  if (!messages) {
    return res.status(400).json({ error: "Danh sách tin nhắn (messages) không hợp lệ." });
  }

  // v10.3: giới hạn max_tokens (mặc định 4096, tối đa 16384)
  const requestedTokens = typeof max_tokens === 'number' && Number.isFinite(max_tokens) && max_tokens > 0 ? Math.floor(max_tokens) : DEFAULT_OUTPUT_TOKENS;
  const cappedMaxTokens = Math.min(requestedTokens, MAX_OUTPUT_TOKENS);
  const safeTemperature = typeof temperature === 'number' && Number.isFinite(temperature) ? Math.min(Math.max(temperature, 0), 2) : 0.2;

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

  // v10.4: model OpenAI có suy nghĩ (gpt-5.x / gpt-6.x / o-series) không nhận temperature và max_tokens
  const isOpenAIReasoning = /^(gpt-5|gpt-6|o\d)/i.test(selectedModel);
  const requestPayload = {
    model: selectedModel,
    messages,
    stream: Boolean(stream),
    ...(isOpenAIReasoning ? { max_completion_tokens: cappedMaxTokens } : { temperature: safeTemperature, max_tokens: cappedMaxTokens }),
    // Giảm "suy nghĩ" của model để tiết kiệm token/thời gian (chỉ nhận giá trị hợp lệ)
    ...(['none', 'minimal', 'low', 'medium', 'high'].includes(reasoning_effort) ? { reasoning_effort } : {}),
    // Chỉ chuyển tiếp chế độ JSON đơn giản (dịch giữ định dạng)
    ...(response_format?.type === 'json_object' ? { response_format: { type: 'json_object' } } : {})
  };

  // v10.4: xin hạn mức (nguyên tử qua Firestore): tần suất / số yêu cầu đồng thời / token trong ngày
  const est = estimateTokens(messages, cappedMaxTokens);
  // v10.6: báo giới hạn đồng thời cho trình duyệt (bộ điều tiết phía máy đặt trần theo số này, không đoán 8)
  res.setHeader?.("X-AI-Concurrency-Limit", String(AI_MAX_CONCURRENT));
  const ticket = await acquireQuota(adminDb, uid, est.total, { unlimitedDaily: isPrimaryAdmin });
  if (isDenied(ticket)) {
    res.setHeader?.("Retry-After", String(ticket.retryAfter));
    return res.status(429).json({ error: ticket.error, reason: ticket.reason });
  }
  let usage: { input: number; output: number } | null = null;
  // v10.6: trả slot "đang chạy" NGAY TRƯỚC khi gửi kết quả về trình duyệt. Trước đây trả slot sau khi đã gửi →
  // trình duyệt nhận kết quả, gửi yêu cầu kế tiếp trong lúc server chưa trừ inflight → bị 429 "quá nhiều yêu cầu"
  // dù thực tế chưa tới 6 yêu cầu.
  let released = false;
  const releaseOnce = async () => {
    if (released) return;
    released = true;
    await releaseQuota(adminDb, ticket, usage, est.input);
  };
  try {
    return await forwardUpstream();
  } finally {
    await releaseOnce();
  }

  async function forwardUpstream() {
  // Chưa gọi được nhà cung cấp → không tính token; luồng bắt đầu → coi như đã tốn phần vào cho tới khi biết số thật
  usage = { input: 0, output: 0 };
  // 5. Execute Upstream Request with Key Rotation
  const baseUrl = (process.env.SYSTEM_AI_BASE_URL || "https://api.shopaikey.com/v1").replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/chat/completions`;
  const isStream = Boolean(stream);

  let lastErrorMsg = "";
  const abortController = new AbortController();
  res.on?.('close', () => {
    if (!res.writableEnded) abortController.abort();
  });
  const failStatuses: number[] = [];
  const startIndex = roundRobinCounter % systemKeys.length;
  roundRobinCounter = (roundRobinCounter + 1) % systemKeys.length;

  for (let attempt = 0; attempt < systemKeys.length; attempt++) {
    const keyObj = systemKeys[(startIndex + attempt) % systemKeys.length];
    const apiKey = (keyObj.value || "").trim();
    if (!apiKey) continue;

    const maskedKey = apiKey.length >= 4 ? `...${apiKey.slice(-4)}` : "...";

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
        
        // Key hệ thống hỏng (401/403), hết số dư (402), hết lượt (429), máy chủ lỗi (5xx) → thử key hệ thống kế tiếp
        if ([401, 402, 403, 429].includes(upstreamRes.status) || upstreamRes.status >= 500) {
          lastErrorMsg = `Upstream status ${upstreamRes.status}: ${errText.substring(0, 100)}`;
          failStatuses.push(upstreamRes.status);
          continue;
        }

        // Lỗi do yêu cầu (400/404/413…) → trả về nguyên mã; KHÔNG trả 403 để trình duyệt không hiểu nhầm là "chưa đủ Level"
        return res.status(upstreamRes.status === 403 ? 502 : upstreamRes.status).json({
          error: `Lỗi từ AI Provider (${upstreamRes.status}): ${safeUpstreamText(errText)}`
        });
      }

      if (isStream) {
        usage = null;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        // v10.4: đếm token ra của luồng (usage nếu nhà cung cấp gửi kèm, không thì ước tính theo số ký tự nội dung)
        let outChars = 0;
        let streamUsage: { input: number; output: number } | null = null;
        let pending = "";
        const decoder = new TextDecoder();
        const scan = (chunk: string) => {
          pending += chunk;
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload);
              const u = usageFromJson(j);
              if (u) streamUsage = u;
              const delta = j?.choices?.[0]?.delta;
              if (typeof delta?.content === "string") outChars += delta.content.length;
              if (typeof delta?.reasoning_content === "string") outChars += delta.reasoning_content.length;
            } catch { /* dòng không phải JSON */ }
          }
        };
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
            try { scan(decoder.decode(value, { stream: true })); } catch { /* */ }
          }
        }
        usage = streamUsage || { input: est.input, output: Math.ceil(outChars / 3) };
        await releaseOnce();
        res.end();
        return;
      } else {
        // v10.3: JSON.parse an toàn
        const json = await upstreamRes.json().catch(() => null);
        if (!json) return res.status(502).json({ error: "AI Provider trả về dữ liệu không hợp lệ." });
        usage = usageFromJson(json) || { input: est.input, output: Math.ceil(String(json?.choices?.[0]?.message?.content || "").length / 3) };
        await releaseOnce();
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

  // Mọi key chỉ đang hết lượt tạm thời → trả 429 + Retry-After để trình duyệt tự giãn nhịp gửi (trước đây trả 502)
  if (failStatuses.length > 0 && failStatuses.every(st => st === 429)) {
    res.setHeader?.("Retry-After", "5");
    return res.status(429).json({
      reason: "upstream",
      error: "Các API Key hệ thống đang hết lượt tạm thời (429). Vui lòng thử lại sau ít giây."
    });
  }
  const allRejected = failStatuses.length > 0 && failStatuses.every(st => st === 401 || st === 403 || st === 402);
  if (lastErrorMsg) console.warn(`[api/ai/chat] All system keys failed: ${lastErrorMsg}`);
  return res.status(502).json({
    error: allRejected
      ? "Tất cả API Key hệ thống bị ShopAIKey từ chối (sai key / hết số dư). Quản trị viên cần kiểm tra kho key hệ thống."
      : "Tất cả các API Key hệ thống hiện đang bận hoặc quá tải. Vui lòng thử lại sau."
    // v10.3: không trả chi tiết lỗi upstream (lastErrorMsg chỉ ghi log)
  });
  }
}
