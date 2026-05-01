import { createApp } from "./src/server/app";
import { firebaseConfig } from "./src/lib/firebaseAdmin";

const PORT = 3000;

async function start() {
  const app = await createApp();
  
  // Only listen if not running in a serverless environment
  const isServerless = process.env.VERCEL === '1' || process.env.LAMBDA_TASK_ROOT;
  
  if (!isServerless) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      if (firebaseConfig.error) {
        console.warn("[Warning] Firebase Config Error:", firebaseConfig.error);
      }
    });
  }
}

// For local development / standalone execution
if (import.meta.url === `file://${process.argv[1]}` || !process.env.VERCEL) {
  start();
}

let cachedApp: any;

// Re-export for potential usage
export default async (req: any, res: any) => {
  if (!cachedApp) {
    cachedApp = await createApp();
  }
  return cachedApp(req, res);
};
