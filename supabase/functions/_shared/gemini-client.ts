/**
 * Gemini APIクライアント
 * Pro -> Flash フォールバック対応
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

export interface GenerateOptions {
  model?: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

/**
 * テキスト生成（タイムアウト対応）
 */
export async function generateText(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const model = options.model ?? "gemini-2.5-flash-preview-05-20";

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        temperature: 0.7,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", response.status, errorText);
    // 失敗時はフォールバック
    if (model === "gemini-2.5-flash-preview-05-20") {
      console.warn("gemini-2.5-flash failed, falling back to gemini-2.0-flash");
      return generateText(prompt, { ...options, model: "gemini-2.0-flash" });
    }
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data: GeminiResponse = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

/**
 * 画像解析（Vision）
 */
export async function analyzeImage(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY")!;
  const model = options.model ?? "gemini-1.5-pro";

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        temperature: 0.5,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    if (model === "gemini-1.5-pro") {
      console.warn("Pro failed, falling back to Flash");
      return analyzeImage(imageBase64, mimeType, prompt, {
        ...options,
        model: "gemini-1.5-flash",
      });
    }
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data: GeminiResponse = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}
