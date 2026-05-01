import { 
  firebaseConfig, 
  getAdminApp, 
  firestoreRest, 
  CustomRequest 
} from "../src/lib/firebaseAdmin";
import admin from "firebase-admin";

// In-memory cache for verified tokens
export const tokenCache = new Map<string, { decodedToken: any, expiry: number }>();

export const checkAdmin = async (req: CustomRequest) => {
  try {
    if (firebaseConfig.error) {
      console.error("[Server] Firebase config error:", firebaseConfig.error);
      throw { status: 500, error: "Dịch vụ chưa được cấu hình đúng.", details: firebaseConfig.error };
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[Server] checkAdmin: Missing auth header");
      throw { status: 401, error: "Unauthorized: Thiếu token xác thực" };
    }

    const idToken = authHeader.split("Bearer ")[1].trim();
    req.idToken = idToken;

    // Check cache first
    const now = Date.now();
    const cached = tokenCache.get(idToken);
    if (cached && cached.expiry > now) {
      console.log("[Server] checkAdmin: Using cached token info");
      const decodedToken = cached.decodedToken;
      const userEmail = (decodedToken.email || "").toLowerCase();
      const userUid = decodedToken.uid;
      
      const primaryAdmins = ["hoanghiep1296@gmail.com", "mrihachnach@gmail.com", "admin@gmail.com", "hoctap853@gmail.com"];
      const isPrimaryAdmin = (userEmail !== "" && primaryAdmins.includes(userEmail)) || (userUid === "4cFbfQhPMpgStJXZ9EpAVcd90i33");
      
      if (isPrimaryAdmin) {
        req.user = decodedToken;
        return decodedToken;
      }

      const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
      if (userDoc.exists && userDoc.data.role === "admin") {
        req.user = decodedToken;
        return decodedToken;
      }
      throw { status: 403, error: "Bạn không có quyền quản trị (Admin)" };
    }

    let decodedToken: any = null;
    const adminApp = getAdminApp();

    if (adminApp) {
      try {
        console.log("[Server] checkAdmin: Verifying ID token via Admin SDK...");
        decodedToken = await admin.auth(adminApp).verifyIdToken(idToken);
      } catch (e: any) {
        console.warn("[Server] checkAdmin: Admin SDK verification failed, falling back to REST API:", e.message);
      }
    }

    if (!decodedToken) {
      console.log("[Server] checkAdmin: Verifying ID token via Identity Toolkit REST API...");
      const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      
      const verifyData: any = await verifyRes.json();
      
      if (verifyRes.status === 429) {
        throw { status: 429, error: "Hệ thống đang bận (Rate Limit Exceeded).", details: "Vui lòng đợi 1-2 phút và thử lại." };
      }

      if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
        throw { status: 401, error: "Xác thực token thất bại." };
      }

      decodedToken = verifyData.users[0];
      decodedToken.uid = decodedToken.localId;
    }

    // Cache the result
    tokenCache.set(idToken, { decodedToken, expiry: now + 5 * 60 * 1000 });
    
    const userEmail = (decodedToken.email || "").toLowerCase();
    const userUid = decodedToken.uid;
    const primaryAdmins = ["hoanghiep1296@gmail.com", "mrihachnach@gmail.com", "admin@gmail.com", "hoctap853@gmail.com"];
    const isPrimaryAdmin = (userEmail !== "" && primaryAdmins.includes(userEmail)) || (userUid === "4cFbfQhPMpgStJXZ9EpAVcd90i33");
    
    if (isPrimaryAdmin) {
      req.user = decodedToken;
      return decodedToken;
    }

    const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
    if (userDoc.exists && userDoc.data.role === "admin") {
      req.user = decodedToken;
      return decodedToken;
    }
    throw { status: 403, error: "Bạn không có quyền quản trị (Admin)" };
  } catch (err: any) {
    if (err.status) throw err;
    throw { status: 500, error: err.error || "Lỗi hệ thống", details: err.message || err.details };
  }
};
