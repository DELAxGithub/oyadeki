/**
 * gemini-2.5-flash のレスポンス構造を詳細に調べる
 * 思考モデル特有の応答フォーマット（thinking partsなど）を確認
 */
import { load } from "https://deno.land/std@0.177.0/dotenv/mod.ts";
const env = await load({ envPath: ".env.local" });
for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

const API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

// 1x1 PNG
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

async function testRaw(label: string, model: string, contents: any[], genConfig: any) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${label}] model=${model}`);
    console.log(`generationConfig: ${JSON.stringify(genConfig)}`);
    console.log("=".repeat(60));

    const url = `${BASE}/models/${model}:generateContent?key=${API_KEY}`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig: genConfig }),
    });

    console.log(`HTTP ${resp.status}`);
    const body = await resp.json();

    // 全体構造
    console.log("\n--- Full response keys ---");
    console.log(Object.keys(body));

    // candidates構造
    if (body.candidates) {
        for (let ci = 0; ci < body.candidates.length; ci++) {
            const c = body.candidates[ci];
            console.log(`\n--- Candidate ${ci} ---`);
            console.log("  finishReason:", c.finishReason);
            console.log("  content.role:", c.content?.role);
            console.log("  parts count:", c.content?.parts?.length);

            if (c.content?.parts) {
                for (let pi = 0; pi < c.content.parts.length; pi++) {
                    const part = c.content.parts[pi];
                    const keys = Object.keys(part);
                    console.log(`  part[${pi}] keys: ${keys.join(", ")}`);
                    if (part.text !== undefined) {
                        console.log(`  part[${pi}].text: "${part.text.substring(0, 200)}"`);
                    }
                    if (part.thought !== undefined) {
                        console.log(`  part[${pi}].thought: ${part.thought}`);
                    }
                }
            }
        }
    }

    // modelVersion
    if (body.modelVersion) {
        console.log("\nmodelVersion:", body.modelVersion);
    }
    // usageMetadata
    if (body.usageMetadata) {
        console.log("usageMetadata:", JSON.stringify(body.usageMetadata));
    }

    return body;
}

// テスト1: テキストのみ (maxOutputTokens: 10)
await testRaw(
    "テキスト maxOutputTokens=10",
    "gemini-2.5-flash",
    [{ parts: [{ text: "help と答えてください" }] }],
    { maxOutputTokens: 10, temperature: 0.1 }
);

// テスト2: 画像 + classifyImageIntent (maxOutputTokens: 10)
await testRaw(
    "画像+Intent maxOutputTokens=10",
    "gemini-2.5-flash",
    [{
        parts: [
            { text: "この画像について help か media か sell の一単語で答えてください" },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    { maxOutputTokens: 10, temperature: 0.1 }
);

// テスト3: 画像 + JSON mode
await testRaw(
    "画像+JSON mode",
    "gemini-2.5-flash",
    [{
        parts: [
            { text: '{"intent": "help"} のようなJSONで答えてください' },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    { response_mime_type: "application/json", temperature: 0.1 }
);

// テスト4: 画像 + identifyMedia JSON mode
await testRaw(
    "identifyMedia JSON mode",
    "gemini-2.5-flash",
    [{
        parts: [
            { text: `この画像のメディアを特定してJSONで返してください。
{"identified": false, "visual_clues": "説明", "question": "質問"}` },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    { response_mime_type: "application/json", temperature: 0.3 }
);

// テスト5: テキストのみ + JSON mode (thinking budget確認)
await testRaw(
    "テキスト+JSON mode",
    "gemini-2.5-flash",
    [{ parts: [{ text: '{"message": "hello"} と返してください' }] }],
    { response_mime_type: "application/json", temperature: 0.1 }
);

console.log("\n\nDone.");
