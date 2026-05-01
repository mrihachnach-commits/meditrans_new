import axios from "axios";
import FormData from "form-data";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() }).single("file");

// Helper to run middleware in serverless function
function runMiddleware(req: any, res: any, fn: any) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Run multer middleware
    await runMiddleware(req, res, upload);
    
    if (!req.file) {
      return res.status(400).json({ error: "Lỗi xử lý tệp tin hoặc không có tệp tin" });
    }

    const formData = new FormData();
    formData.append("file", req.file.buffer, { 
      filename: req.file.originalname, 
      contentType: req.file.mimetype 
    });

    const response = await axios.post("https://tinyvault.space/api/upload", formData, { 
      headers: { ...formData.getHeaders() } 
    });
    
    return res.status(200).json(response.data);
  } catch (err: any) {
    console.error("[Server] TinyVault upload error:", err.message);
    return res.status(500).json({ error: "Lỗi từ máy chủ TinyVault hoặc hệ thống xử lý" });
  }
}

// Config to allow larger files and stop Vercel from parsing body
export const config = {
  api: {
    bodyParser: false,
  },
};
