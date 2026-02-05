/**
 * gemini-2.5-flash の thinkingConfig テスト
 * 思考を無効化/制限して maxOutputTokens の問題を解決できるか確認
 */
import { load } from "https://deno.land/std@0.177.0/dotenv/mod.ts";
const env = await load({ envPath: ".env.local" });
for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

const API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

async function testThinking(label: string, body: any) {
    console.log(`\n--- ${label} ---`);
    const url = `${BASE}/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    console.log(`HTTP ${resp.status}`);
    if (!resp.ok) {
        console.log("Error:", await resp.text());
        return;
    }
    const data = await resp.json();
    const c = data.candidates?.[0];
    console.log("finishReason:", c?.finishReason);
    console.log("parts:", c?.content?.parts?.length ?? "undefined");
    if (c?.content?.parts) {
        for (const p of c.content.parts) {
            if (p.thought) console.log("  [thought]", p.text?.substring(0, 100));
            else console.log("  [text]", p.text?.substring(0, 200));
        }
    }
    console.log("usage:", JSON.stringify(data.usageMetadata));
}

// パターン1: generationConfig内にthinkingConfig
await testThinking("thinkingConfig inside generationConfig (thinkingBudget=0)", {
    contents: [{
        parts: [
            { text: "help と1単語で答えてください" },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    generationConfig: {
        maxOutputTokens: 10,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
    },
});

// パターン2: トップレベルにthinkingConfig
await testThinking("thinkingConfig at top level (thinkingBudget=0)", {
    contents: [{
        parts: [
            { text: "help と1単語で答えてください" },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    generationConfig: {
        maxOutputTokens: 10,
        temperature: 0.1,
    },
    thinkingConfig: { thinkingBudget: 0 },
});

// パターン3: maxOutputTokensを大きくする (思考込みで128)
await testThinking("maxOutputTokens=128 (no thinkingConfig)", {
    contents: [{
        parts: [
            { text: "help と1単語で答えてください" },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    generationConfig: {
        maxOutputTokens: 128,
        temperature: 0.1,
    },
});

// パターン4: maxOutputTokens=1024, response_mime_type=json, 実際のidentifyMediaプロンプト
await testThinking("identifyMedia full prompt (1024 tokens, JSON mode)", {
    contents: [{
        parts: [
            { text: `あなたはメディア鑑定士です。この画像のメディアを特定してJSON返してください。
{"identified": false, "visual_clues": "説明", "question": "質問"}
または
{"identified": true, "data": {"media_type": "other", "title": "タイトル", "trivia": "豆知識"}}` },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.3,
        response_mime_type: "application/json",
    },
});

// パターン5: thinkingBudget=0 + response_mime_type=json (classifyImageIntent代替)
await testThinking("classifyImageIntent: thinkingBudget=0, maxOutputTokens=50", {
    contents: [{
        parts: [
            { text: `この画像を見て判定してください:
1. "help" - スマホの操作画面
2. "media" - 視聴中のコンテンツ
3. "sell" - 売りたい商品
回答: help または media または sell のみ` },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
        ],
    }],
    generationConfig: {
        maxOutputTokens: 50,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
    },
});

console.log("\nDone.");
