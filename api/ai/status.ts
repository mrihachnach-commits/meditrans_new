import admin from "firebase-admin";
import { firebaseConfig, getAdminApp, getAdminFirestore } from "../../lib/firebaseAdmin.js";

/**
 * Trạng thái kho key hệ thống (ShopAIKey Pool) cho người dùng đã đăng nhập.
 * Người dùng thường không đọc được collection systemShopAiKeys (chỉ admin) → hỏi máy chủ.
 * Chỉ trả về SỐ key đang bật, không bao giờ trả về mã key.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader?.("Cache-Control", "no-store");
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const adminApp = getAdminApp();
  if (!adminApp || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return res.status(500).json({ error: "Chưa cấu hình Firebase Admin SDK.", available: false, activeCount: 0 });
  }
  try {
    await admin.auth(adminApp).verifyIdToken(authHeader.split("Bearer ")[1].trim());
  } catch {
    return res.status(401).json({ error: "Token xác thực không hợp lệ hoặc đã hết hạn." });
  }
  try {
    const dbId = firebaseConfig.firestoreDatabaseId || 'ai-studio-274cca7a-128b-4f84-92a2-6b79856d515b';
    const snap = await getAdminFirestore(adminApp, dbId).collection("systemShopAiKeys").where("isActive", "==", true).get();
    const activeCount = snap.docs.filter(d => String((d.data() as any)?.value || '').trim()).length;
    return res.status(200).json({ available: activeCount > 0, activeCount });
  } catch (e: any) {
    console.error("[api/ai/status] Error:", e?.message);
    return res.status(500).json({ error: "Không đọc được kho key hệ thống." });
  }
}
