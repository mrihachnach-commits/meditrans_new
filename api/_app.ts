import express from "express";
import path from "path";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import axios from "axios";
import FormData from "form-data";
import multer from "multer";
import { 
  firebaseConfig, 
  getAdminApp, 
  getAdminFirestore, 
  firestoreRest, 
  CustomRequest 
} from "../src/lib/firebaseAdmin";

// In-memory cache for verified tokens to prevent "Rate exceeded" errors
const tokenCache = new Map<string, { decodedToken: any, expiry: number }>();

export async function createApp() {
  const app = express();
  app.use(express.json());

  // Simple ping endpoint for health checks
  app.get("/api/ping", (req, res) => {
    res.json({ 
      status: "alive", 
      time: new Date().toISOString(),
      env: process.env.NODE_ENV,
      vercel: process.env.VERCEL || "0"
    });
  });

  // Middleware to check if user is admin
  const checkAdmin = async (req: CustomRequest, res: any, next: any) => {
    try {
      console.log(`[Server] checkAdmin triggered for ${req.path}`);
      if (firebaseConfig.error) {
        console.error("[Server] Firebase config error:", firebaseConfig.error);
        return res.status(500).json({ error: "Dịch vụ chưa được cấu hình đúng.", details: firebaseConfig.error });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.warn("[Server] checkAdmin: Missing auth header");
        return res.status(401).json({ error: "Unauthorized: Thiếu token xác thực" });
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
          return next();
        }

        const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
        if (userDoc.exists && userDoc.data.role === "admin") {
          req.user = decodedToken;
          return next();
        }
        return res.status(403).json({ error: "Bạn không có quyền quản trị (Admin)" });
      }

      let decodedToken: any = null;
      const adminApp = getAdminApp();

      if (adminApp) {
        try {
          console.log("[Server] checkAdmin: Verifying ID token via Admin SDK...");
          decodedToken = await admin.auth(adminApp).verifyIdToken(idToken);
          console.log(`[Server] checkAdmin: Admin SDK verification succesful for ${decodedToken.email}`);
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
          console.error("[Server] checkAdmin: IDENTITY_TOOLKIT_RATE_LIMIT_EXCEEDED");
          return res.status(429).json({ 
            error: "Hệ thống đang bận (Rate Limit Exceeded).", 
            details: "Vui lòng đợi 1-2 phút và thử lại. Bạn cũng có thể định cấu hình Service Account (FIREBASE_PRIVATE_KEY) để bỏ qua giới hạn này." 
          });
        }

        if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
          console.warn("[Server] checkAdmin: Token verification failed", verifyData.error);
          return res.status(401).json({ error: "Xác thực token thất bại." });
        }

        decodedToken = verifyData.users[0];
        decodedToken.uid = decodedToken.localId;
      }

      // Cache the result for 5 minutes
      tokenCache.set(idToken, { decodedToken, expiry: now + 5 * 60 * 1000 });
      // Cleanup cache occasionally
      if (tokenCache.size > 100) {
        for (const [key, val] of tokenCache.entries()) {
          if (val.expiry < now) tokenCache.delete(key);
        }
      }

      const userEmail = (decodedToken.email || "").toLowerCase();
      const userUid = decodedToken.uid;
      
      console.log(`[Server] checkAdmin: Token belongs to ${userEmail} (${userUid})`);

      const primaryAdmins = [
        "hoanghiep1296@gmail.com",
        "mrihachnach@gmail.com",
        "admin@gmail.com",
        "hoctap853@gmail.com"
      ];
      
      const isPrimaryAdmin = (userEmail !== "" && primaryAdmins.includes(userEmail)) || (userUid === "4cFbfQhPMpgStJXZ9EpAVcd90i33");
      
      if (isPrimaryAdmin) {
        console.log(`[Server] checkAdmin: Primary admin authorized: ${userEmail}`);
        req.user = decodedToken;
        return next();
      }

      try {
        console.log(`[Server] checkAdmin: Fetching user doc for ${userUid} to check role...`);
        const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
        if (userDoc.exists && userDoc.data.role === "admin") {
          console.log(`[Server] checkAdmin: Dynamic admin authorized: ${userEmail}`);
          req.user = decodedToken;
          return next();
        }
        console.warn(`[Server] checkAdmin: User ${userEmail} is not an admin. Role: ${userDoc.exists ? userDoc.data.role : 'not found'}`);
      } catch (e: any) {
        console.error(`[Server] checkAdmin: Error checking user doc: ${e.message}`);
      }

      return res.status(403).json({ error: "Bạn không có quyền quản trị (Admin)" });
    } catch (err: any) {
      console.error(`[Server] checkAdmin: Critical error: ${err.message}`);
      return res.status(500).json({ error: "Lỗi hệ thống khi kiểm tra quyền", details: err.message });
    }
  };

  // Diagnostic Endpoint
  app.get("/api/admin/diagnostics", checkAdmin, async (req: CustomRequest, res) => {
    try {
      const idToken = req.idToken;
      const results: any = {
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        configLoaded: !firebaseConfig.error,
        adminSdk: { status: "unknown" },
        env: {
          VERCEL: process.env.VERCEL || "0",
          HAS_ADMIN_KEYS: !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
        }
      };

      try {
        const adminApp = getAdminApp();
        if (adminApp) {
          results.adminSdk.status = "ok";
        } else {
          results.adminSdk.status = "error";
        }
      } catch (e: any) {
        results.adminSdk.status = "error";
        results.adminSdk.message = e.message;
      }

      return res.json(results);
    } catch (err: any) {
      return res.status(500).json({ error: "Diagnostics failed", message: err.message });
    }
  });

  // Proxy TinyVault Upload
  app.post("/api/tinyvault", async (req, res) => {
    const upload = multer({ storage: multer.memoryStorage() });
    upload.single("file")(req as any, res as any, async (err) => {
      const request = req as any;
      if (err || !request.file) return res.status(400).json({ error: "Lỗi xử lý tệp tin hoặc không có tệp tin" });

      const formData = new FormData();
      formData.append("file", request.file.buffer, { filename: request.file.originalname, contentType: request.file.mimetype });

      try {
        const response = await axios.post("https://tinyvault.space/api/upload", formData, { headers: { ...formData.getHeaders() } });
        res.json(response.data);
      } catch (axiosError: any) {
        res.status(500).json({ error: "Lỗi từ máy chủ TinyVault" });
      }
    });
  });

  // Admin Routes
  app.post("/api/admin/create-user", checkAdmin, async (req: CustomRequest, res) => {
    const { email, password, displayName, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });

    try {
      let uid = "";
      try {
        const currentAdminApp = getAdminApp();
        if (!currentAdminApp) throw new Error("Admin SDK not initialized");
        const userRecord = await admin.auth(currentAdminApp).createUser({ email, password, displayName: displayName || email.split('@')[0], emailVerified: true });
        uid = userRecord.uid;
      } catch (e) {
        const signUpResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, displayName: displayName || email.split('@')[0], returnSecureToken: true })
        });
        const signUpData: any = await signUpResponse.json();
        if (!signUpResponse.ok) throw new Error(signUpData.error?.message || "Lỗi tạo tài khoản");
        uid = signUpData.localId;
      }
      
      const userData = { uid, email, displayName: displayName || email.split('@')[0], role: role || "user", createdAt: new Date().toISOString() };
      await firestoreRest.setDoc("users", uid, userData, req.idToken);
      
      return res.json({ success: true, uid, userData });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/list-users", checkAdmin, async (req: any, res) => {
    try {
      const users = await firestoreRest.listDocs("users", req.idToken);
      return res.json({ success: true, users });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/delete-user", checkAdmin, async (req: any, res) => {
    const { uid, email } = req.body;
    console.log(`[Server] Admin delete-user request for ${email} (${uid})`);
    
    let authDeleted = false;
    let authError = null;

    try {
      const currentAdminApp = getAdminApp();
      if (currentAdminApp) {
        try {
          console.log(`[Server] Deleting user ${uid} from Firebase Auth...`);
          await getAuth(currentAdminApp).deleteUser(uid);
          console.log(`[Server] User ${uid} deleted from Firebase Auth.`);
          authDeleted = true;
        } catch (ae: any) {
          authError = ae.message;
          console.error(`[Server] Error deleting user from Auth: ${ae.message}`);
          
          // Re-throw if it's a critical error that should stop the process
          // But if the user is already gone from Auth, we might want to continue to Firestore
          if (ae.code === 'auth/user-not-found') {
            console.warn(`[Server] User ${uid} not found in Auth, continuing to Firestore...`);
            authDeleted = true; // Effectively deleted
          } else {
            return res.status(500).json({ 
              error: `Lỗi xóa tài khoản khỏi Authentication: ${ae.message}`,
              details: "Bạn có thể cần cấu hình FIREBASE_PRIVATE_KEY và FIREBASE_CLIENT_EMAIL trong môi trường."
            });
          }
        }
      } else {
        return res.status(500).json({ 
          error: "Admin SDK chưa được cấu hình đầy đủ (thiếu Service Account).",
          details: "Cần đặt FIREBASE_PRIVATE_KEY và FIREBASE_CLIENT_EMAIL để xóa người dùng khỏi Authentication."
        });
      }
      
      console.log(`[Server] Deleting Firestore user doc: ${uid}`);
      await firestoreRest.deleteDoc("users", uid, req.idToken);
      
      if (email) {
        console.log(`[Server] Adding ${email} to blacklist...`);
        await firestoreRest.setDoc("blacklist", email.toLowerCase(), {
          email: email.toLowerCase(),
          uid: uid,
          reason: "Deleted by admin",
          createdAt: new Date().toISOString()
        }, req.idToken);
      }
      
      console.log(`[Server] Admin delete-user request for ${email} completed successfully.`);
      res.json({ success: true, authDeleted });
    } catch (error: any) {
      console.error(`[Server] Admin delete-user request failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  // SPA Middleware
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use("/api/*", (req, res) => res.status(404).json({ error: "Not Found" }));
    app.get("*", (req, res) => {
      // In some environments, sending file might fail if dist doesn't exist yet
      try {
        res.sendFile(path.join(distPath, "index.html"));
      } catch (e) {
        res.status(500).send("Application is building or dist folder is missing.");
      }
    });
  }

  return app;
}
