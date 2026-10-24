import type { Request, Response } from "express";
import { GoogleGenAI, Type } from "@google/genai";

function normalizeGeminiModel(model?: string): string {
  if (!model) return "gemini-3.8-flash";
  const m = model.toLowerCase();
  if (m.includes("lite")) return "gemini-3.1-flash-lite";
  if (m.includes("pro")) return "gemini-3.1-pro-preview";
  return "gemini-3.8-flash";
}

function isProxyKey(key: string): boolean {
  if (!key) return false;
  const clean = key.trim();
  return clean.startsWith("sk-") || clean.startsWith("sh-") || clean.startsWith("sai-");
}

export default async function handler(req: Request, res: Response) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { blocks, model, glossary, translationMemory, customBaseUrl } = req.body;

  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    return res.status(400).json({ error: "Missing or invalid blocks parameter" });
  }

  // Retrieve API key
  let apiKey = "";
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const extractedKey = authHeader.split("Bearer ")[1].trim();
    if (extractedKey) {
      apiKey = extractedKey;
    }
  }

  // If no client key, fallback to server process.env.GEMINI_API_KEY
  if (!apiKey && process.env.GEMINI_API_KEY) {
    apiKey = process.env.GEMINI_API_KEY;
  }

  if (!apiKey) {
    return res.status(401).json({ error: "Không tìm thấy API Key. Vui lòng cấu hình API Key trong phần Cài đặt." });
  }

  const systemInstruction = `BẠN LÀ CHUYÊN GIA DỊCH THUẬT Y KHOA CAO CẤP (ANH - VIỆT) VÀ DOCUMENT PROCESSING AGENT.
Nhiệm vụ của bạn là dịch danh sách các đoạn văn bản (Document Blocks) từ tiếng Anh sang tiếng Việt.

CÁC QUY TẮC BẮT BUỘC TỐI THƯỢNG:
1. DỊCH HOÀN TOÀN SANG TIẾNG VIỆT 100%: Dịch chính xác, tự nhiên, đúng thuật ngữ chuyên ngành y khoa, sinh học, học thuật.
2. TUYỆT ĐỐI KHÔNG THAY ĐỔI HOẶC BỎ BẤT KỲ BLOCK NÀO: Giữ nguyên ID của block gốc. Trả về đúng số lượng block đã nhận.
3. KHÔNG THÊM LỜI DẪN, GIẢI THÍCH: Chỉ trả về nội dung JSON có cấu trúc {"translations": [{"id": "...", "text": "..."}]}.
4. GIỮ NGUYÊN ĐỊNH DẠNG HOẶC MÃ ĐÁNH SỐ: (ví dụ: "Figure 1", "Hình 1", "Table 2", "Bảng 2", "a.", "b.", v.v.).
${glossary ? `5. SỬ DỤNG BỘ THUẬT NGỮ (GLOSSARY) NẾU CÓ: ${JSON.stringify(glossary)}` : ""}
${translationMemory ? `6. THAM KHẢO TRÍ NHỚ DỊCH THUẬT (TRANSLATION MEMORY): ${JSON.stringify(translationMemory)}` : ""}`;

  const prompt = `Hãy dịch danh sách các block văn bản sau sang tiếng Việt 100%. Trả về đúng JSON format:
{
  "translations": [
    { "id": "block_id", "text": "bản dịch tiếng Việt" }
  ]
}

Danh sách các blocks cần dịch:
${JSON.stringify(blocks.map((b: any) => ({ id: b.id, text: b.text, type: b.type })), null, 2)}`;

  // Check if client provided a proxy/OpenAI key (sk-...)
  if (isProxyKey(apiKey)) {
    try {
      console.log(`[Layout Translation API] Using ShopAIKey / OpenAI Proxy for ${blocks.length} blocks...`);
      const baseUrl = (customBaseUrl || "https://api.shopaikey.com/v1").replace(/\/+$/, "");
      const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: "gemini-1.5-flash",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Proxy translation error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const parsedData = JSON.parse(content.replace(/```json\n?|```/g, "").trim());
      
      // Ensure translations array exists
      if (!parsedData.translations && Array.isArray(parsedData)) {
        return res.status(200).json({ translations: parsedData });
      }
      return res.status(200).json(parsedData);
    } catch (proxyErr: any) {
      console.error("[Layout Proxy Error]:", proxyErr);
      // If server has Gemini API Key, try fallback
      if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== apiKey) {
        console.log("[Layout Translation API] Falling back to server Gemini API Key...");
        apiKey = process.env.GEMINI_API_KEY;
      } else {
        return res.status(500).json({ error: proxyErr.message || "Lỗi khi gọi ShopAIKey Proxy." });
      }
    }
  }

  // Handle standard Google Gemini (@google/genai SDK)
  const selectedModel = normalizeGeminiModel(model);

  try {
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    // Define response schema for Gemini using standard Type enum
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        translations: {
          type: Type.ARRAY,
          description: "List of translated blocks, corresponding exactly to the input block list",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "The ID matching the original input block's ID" },
              text: { type: Type.STRING, description: "The translated text of the block in Vietnamese" }
            },
            required: ["id", "text"]
          }
        }
      },
      required: ["translations"]
    };

    console.log(`[Server API] Sending ${blocks.length} blocks to Gemini model ${selectedModel}...`);

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("Mẫu AI không trả về dữ liệu.");
    }

    const parsedData = JSON.parse(textOutput.trim());
    return res.status(200).json(parsedData);

  } catch (error: any) {
    console.error("[Layout Translation API Error]:", error);
    return res.status(500).json({
      error: error.message || "Lỗi máy chủ trong quá trình dịch thuật layout PDF.",
      details: error.stack
    });
  }
}
