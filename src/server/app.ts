import express from "express";
import path from "path";
import admin from "firebase-admin";
import axios from "axios";
import FormData from "form-data";
import multer from "multer";
import { 
  firebaseConfig, 
  getAdminApp, 
  getAdminFirestore, 
  firestoreRest, 
  CustomRequest 
} from "../lib/firebaseAdmin";

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
      if (firebaseConfig.error) {
        return res.status(500).json({ error: "Dịch vụ chưa được cấu hình đúng.", details: firebaseConfig.error });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized: Thiếu token xác thực" });
      }

      const idToken = authHeader.split("Bearer ")[1].trim();
      req.idToken = idToken;

      const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      
      const verifyData: any = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
        return res.status(401).json({ error: "Xác thực token thất bại." });
      }

      const decodedToken = verifyData.users[0];
      decodedToken.uid = decodedToken.localId;
      const userEmail = (decodedToken.email || "").toLowerCase();
      const userUid = decodedToken.uid;
      
      const primaryAdmins = [
        "hoanghiep1296@gmail.com",
        "mrihachnach@gmail.com",
        "admin@gmail.com",
        "hoctap853@gmail.com"
      ];
      
      const isPrimaryAdmin = (userEmail !== "" && primaryAdmins.includes(userEmail)) || (userUid === "4cFbfQhPMpgStJXZ9EpAVcd90i33");
      
      if (isPrimaryAdmin) {
        req.user = decodedToken;
        return next();
      }

      try {
        const userDoc = await firestoreRest.getDoc("users", userUid, idToken);
        if (userDoc.exists && userDoc.data.role === "admin") {
          req.user = decodedToken;
          return next();
        }
      } catch (e) {}

      return res.status(403).json({ error: "Bạn không có quyền quản trị (Admin)" });
    } catch (err: any) {
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
    try {
      try {
        const currentAdminApp = getAdminApp();
        if (currentAdminApp) await admin.auth(currentAdminApp).deleteUser(uid);
      } catch (ae) {}
      
      await firestoreRest.deleteDoc("users", uid, req.idToken);
      if (email) {
        await firestoreRest.setDoc("blacklist", email.toLowerCase(), {
          email: email.toLowerCase(),
          uid: uid,
          reason: "Deleted by admin",
          createdAt: new Date().toISOString()
        }, req.idToken);
      }
      
      res.json({ success: true });
    } catch (error: any) {
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
