import express from "express";
import path from "path";
import { firebaseConfig } from "./lib/firebaseAdmin.js";

// Import handlers for local mapping
import pingHandler from "./api/ping";
import diagnosticsHandler from "./api/admin/diagnostics";
import createUserHandler from "./api/admin/create-user";
import listUsersHandler from "./api/admin/list-users";
import deleteUserHandler from "./api/admin/delete-user";
import changePasswordHandler from "./api/admin/change-password";
import tinyvaultHandler from "./api/tinyvault";
import indexHandler from "./api/index";

const PORT = 3000;

async function start() {
  const app = express();
  app.use(express.json());

  // Manually map routes for local development
  app.get("/api/ping", pingHandler);
  app.get("/api/admin/diagnostics", diagnosticsHandler);
  app.post("/api/admin/create-user", createUserHandler);
  app.get("/api/admin/list-users", listUsersHandler);
  app.post("/api/admin/delete-user", deleteUserHandler);
  app.post("/api/admin/change-password", changePasswordHandler);
  app.post("/api/tinyvault", tinyvaultHandler);
  app.get("/api", indexHandler);
  app.get("/api/index", indexHandler);

  // SPA Middleware for local development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Local Dev] Server running on http://localhost:${PORT}`);
    if (firebaseConfig.error) {
      console.warn("[Warning] Firebase Config Error:", firebaseConfig.error);
    }
  });
}

start();
