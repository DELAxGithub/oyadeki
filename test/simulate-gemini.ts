/**
 * Gemini API ローカルシミュレーション
 * gemini-2.5-flash での画像処理を本番デプロイ前にテストする
 *
 * 使い方:
 *   deno run --allow-net --allow-env --allow-read test/simulate-gemini.ts
 *   deno run --allow-net --allow-env --allow-read test/simulate-gemini.ts --image path/to/image.jpg
 */

// .env.local 読み込み
import { load } from "https://deno.land/std@0.177.0/dotenv/mod.ts";
const env = await load({ envPath: ".env.local" });
for (const [k, v] of Object.entries(env)) {
    Deno.env.set(k, v);
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const API_KEY = Deno.env.get("GEMINI_API_KEY");

if (!API_KEY) {
    console.error("❌ GEMINI_API_KEY が設定されていません");
    Deno.exit(1);
}

// ---------- ユーティリティ ----------

function colorLog(label: string, msg: string, color: string) {
    const colors: Record<string, string> = {
        green: "\x1b[32m",
        red: "\x1b[31m",
        yellow: "\x1b[33m",
        cyan: "\x1b[36m",
        reset: "\x1b[0m",
    };
    console.log(`${colors[color] || ""}[${label}]${colors.reset} ${msg}`);
}

async function callGemini(
    model: string,
    contents: any[],
    generationConfig: any = {}
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${API_KEY}`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, generationConfig }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            return { ok: false, status: response.status, error: errorText };
        }
        const data = await response.json();
        return { ok: true, status: response.status, data };
    } catch (e) {
        return { ok: false, status: 0, error: String(e) };
    }
}

function extractText(data: any): string {
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ---------- テスト画像 ----------

async function loadTestImage(path?: string): Promise<{ base64: string; mimeType: string }> {
    if (path) {
        const file = await Deno.readFile(path);
        const base64 = btoa(String.fromCharCode(...file));
        const ext = path.split(".").pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
            jpg: "image/jpeg", jpeg: "image/jpeg",
            png: "image/png", gif: "image/gif", webp: "image/webp",
        };
        return { base64, mimeType: mimeMap[ext || ""] || "image/jpeg" };
    }

    // デフォルト: 小さい赤い四角 (10x10 PNG) を生成
    colorLog("INFO", "テスト用のダミー画像(赤い四角)を使用します。--image オプションで実画像を指定可能", "yellow");
    // 最小限のPNG: 1x1 赤ピクセル
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    return { base64: pngBase64, mimeType: "image/png" };
}

// ---------- テストケース ----------

async function test1_textGeneration() {
    colorLog("TEST 1", "gemini-2.5-flash テキスト生成", "cyan");
    const result = await callGemini(
        "gemini-2.5-flash",
        [{ parts: [{ text: "「こんにちは」と返してください。それだけでOKです。" }] }],
        { maxOutputTokens: 50, temperature: 0.1 }
    );
    if (result.ok) {
        const text = extractText(result.data);
        colorLog("PASS", `テキスト生成OK: "${text.trim()}"`, "green");
        return true;
    } else {
        colorLog("FAIL", `テキスト生成失敗: ${result.status} - ${result.error}`, "red");
        return false;
    }
}

async function test2_imageBasic(image: { base64: string; mimeType: string }) {
    colorLog("TEST 2", "gemini-2.5-flash 画像 + テキスト (基本)", "cyan");
    const result = await callGemini(
        "gemini-2.5-flash",
        [{
            parts: [
                { text: "この画像に何が映っていますか？1文で答えてください。" },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            ],
        }],
        { maxOutputTokens: 200, temperature: 0.3 }
    );
    if (result.ok) {
        const text = extractText(result.data);
        colorLog("PASS", `画像認識OK: "${text.trim()}"`, "green");
        return true;
    } else {
        colorLog("FAIL", `画像認識失敗: ${result.status} - ${result.error}`, "red");
        return false;
    }
}

async function test3_imageWithJsonMode(image: { base64: string; mimeType: string }) {
    colorLog("TEST 3", "gemini-2.5-flash 画像 + response_mime_type:application/json", "cyan");
    const result = await callGemini(
        "gemini-2.5-flash",
        [{
            parts: [
                { text: `この画像を見て、以下のどれか判定してください:
1. "help" - スマホの操作画面
2. "media" - 視聴中のコンテンツ
3. "sell" - 売りたい商品

JSONで返してください: {"intent": "help" | "media" | "sell"}` },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            ],
        }],
        { maxOutputTokens: 50, temperature: 0.1, response_mime_type: "application/json" }
    );
    if (result.ok) {
        const text = extractText(result.data);
        colorLog("PASS", `JSON mode画像OK: ${text.trim()}`, "green");
        try {
            JSON.parse(text);
            colorLog("PASS", "JSONパース成功", "green");
        } catch {
            colorLog("WARN", "JSONパース失敗（テキストは返ったがJSON形式でない）", "yellow");
        }
        return true;
    } else {
        colorLog("FAIL", `JSON mode画像失敗: ${result.status} - ${result.error}`, "red");
        console.log("  エラー詳細:", result.error?.substring(0, 500));
        return false;
    }
}

async function test4_classifyImageIntent(image: { base64: string; mimeType: string }) {
    colorLog("TEST 4", "classifyImageIntent (修正版: thinkingBudget=0, maxOutputTokens=50)", "cyan");
    const prompt = `この画像を見て、以下のどれか判定してください:

1. "help" - スマホの操作に困っている画面
   (エラー、設定、ダイアログ、警告、ログイン画面、アプリ更新など)

2. "media" - 視聴中のコンテンツ
   (テレビ番組、映画、スポーツ中継、YouTube、ライブ、コンサート、
    映画ポスター、CDジャケット、本の表紙など)

3. "sell" - 売りたい商品（フリマ出品用）
   (家電、ガジェット、服、バッグ、本、ゲーム機、フィギュア、
    またはそれらが机の上や背景ありで撮影されている写真)

回答: help または media または sell のみ（他の文字は含めない）`;

    const result = await callGemini(
        "gemini-2.5-flash",
        [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            ],
        }],
        { maxOutputTokens: 50, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } }
    );
    if (result.ok) {
        const text = extractText(result.data).trim().toLowerCase();
        if (text) {
            colorLog("PASS", `Intent判定OK: "${text}"`, "green");
        } else {
            colorLog("FAIL", `Intent判定: 空文字が返されました（思考トークンで出力枠消費の可能性）`, "red");
            return false;
        }
        return true;
    } else {
        colorLog("FAIL", `Intent判定失敗: ${result.status} - ${result.error}`, "red");
        return false;
    }
}

async function test5_identifyMedia(image: { base64: string; mimeType: string }) {
    colorLog("TEST 5", "identifyMedia (本番と同じプロンプト + JSON mode)", "cyan");
    const prompt = `あなたはアニメ・映画・テレビ番組・音楽・スポーツに精通したメディア鑑定士です。
この画像に映っているメディアを、あなたの豊富な知識を使って特定してください。

【重要ルール】
- 作品名やキャラクター名に心当たりがあるなら、積極的にパターンAで回答してください。
- 「たぶんこれだろう」レベル（7割以上の確信）でもパターンAで構いません。
- アニメキャラの場合、服装・髪型・体格・雰囲気から作品とキャラ名を推測してください。
  例：金色の軍服の男性 → ガンダムのギレン・ザビ、赤い彗星 → シャア・アズナブル
- パターンBは「全く見当がつかない」場合のみ使ってください。

【出力形式 - JSONのみ】

パターンA：作品を特定（推測含む）
{
  "identified": true,
  "data": {
    "media_type": "movie" | "tv_show" | "anime" | "sports" | "music" | "book" | "other",
    "title": "作品タイトル",
    "subtitle": "エピソード名や登場キャラ名など（あれば）",
    "artist_or_cast": "出演者・声優・チーム名",
    "year": 2024,
    "trivia": "この作品に関する短い豆知識（1〜2文）"
  }
}

パターンB：全く見当がつかない場合のみ
{
  "identified": false,
  "visual_clues": "画像から読み取れる視覚情報",
  "question": "具体的な作品名を挙げた絞り込み質問"
}

JSONのみを返し、Markdownコードブロックは不要です。`;

    const result = await callGemini(
        "gemini-2.5-flash",
        [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            ],
        }],
        { response_mime_type: "application/json", temperature: 0.3 }
    );
    if (result.ok) {
        const text = extractText(result.data);
        colorLog("PASS", `identifyMedia応答OK`, "green");
        try {
            const parsed = JSON.parse(text);
            console.log("  解析結果:", JSON.stringify(parsed, null, 2));
            if (parsed.identified && parsed.data) {
                colorLog("INFO", `特定: ${parsed.data.title} (${parsed.data.media_type})`, "cyan");
            } else if (parsed.question) {
                colorLog("INFO", `質問: ${parsed.question}`, "cyan");
            }
        } catch {
            colorLog("WARN", `JSONパース失敗: "${text.substring(0, 200)}"`, "yellow");
        }
        return true;
    } else {
        colorLog("FAIL", `identifyMedia失敗: ${result.status}`, "red");
        console.log("  エラー詳細:", result.error?.substring(0, 500));
        return false;
    }
}

async function test6_analyzeProductImage(image: { base64: string; mimeType: string }) {
    colorLog("TEST 6", "analyzeProductImage (出品用・JSON mode)", "cyan");
    const prompt = `あなたはフリマアプリの出品アシスタントです。
ユーザーが売りたい商品の写真を送ってきました。
この画像を分析し、出品に必要な情報を抽出してください。

【出力形式 - JSONのみ】
{
  "image_summary": "画像の視覚的な説明",
  "extracted_info": {
    "category": "推定カテゴリ",
    "product_name": "推定商品名",
    "features": "特徴リスト"
  },
  "first_question": "ユーザーに尋ねるべき最初の質問"
}`;

    const result = await callGemini(
        "gemini-2.5-flash",
        [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            ],
        }],
        { response_mime_type: "application/json", temperature: 0.5 }
    );
    if (result.ok) {
        const text = extractText(result.data);
        colorLog("PASS", `analyzeProductImage応答OK`, "green");
        try {
            const parsed = JSON.parse(text);
            console.log("  解析結果:", JSON.stringify(parsed, null, 2));
        } catch {
            colorLog("WARN", `JSONパース失敗: "${text.substring(0, 200)}"`, "yellow");
        }
        return true;
    } else {
        colorLog("FAIL", `analyzeProductImage失敗: ${result.status}`, "red");
        console.log("  エラー詳細:", result.error?.substring(0, 500));
        return false;
    }
}

// ---------- メイン ----------

async function main() {
    console.log("========================================");
    console.log(" Gemini API ローカルシミュレーション");
    console.log(" モデル: gemini-2.5-flash");
    console.log("========================================\n");

    // コマンドライン引数で画像パスを指定可能
    let imagePath: string | undefined;
    const args = Deno.args;
    const imageIdx = args.indexOf("--image");
    if (imageIdx !== -1 && args[imageIdx + 1]) {
        imagePath = args[imageIdx + 1];
        colorLog("INFO", `画像ファイル: ${imagePath}`, "cyan");
    }

    const image = await loadTestImage(imagePath);
    colorLog("INFO", `画像サイズ: ${image.base64.length} bytes (base64), type: ${image.mimeType}`, "cyan");
    console.log();

    const results: { name: string; pass: boolean }[] = [];

    // Test 1: テキスト生成
    results.push({ name: "テキスト生成", pass: await test1_textGeneration() });
    console.log();

    // Test 2: 画像+テキスト基本
    results.push({ name: "画像認識(基本)", pass: await test2_imageBasic(image) });
    console.log();

    // Test 3: 画像+JSON mode
    results.push({ name: "画像+JSON mode", pass: await test3_imageWithJsonMode(image) });
    console.log();

    // Test 4: classifyImageIntent
    results.push({ name: "classifyImageIntent", pass: await test4_classifyImageIntent(image) });
    console.log();

    // Test 5: identifyMedia
    results.push({ name: "identifyMedia", pass: await test5_identifyMedia(image) });
    console.log();

    // Test 6: analyzeProductImage
    results.push({ name: "analyzeProductImage", pass: await test6_analyzeProductImage(image) });
    console.log();

    // サマリー
    console.log("========================================");
    console.log(" テスト結果サマリー");
    console.log("========================================");
    let allPass = true;
    for (const r of results) {
        const icon = r.pass ? "✅" : "❌";
        console.log(`  ${icon} ${r.name}`);
        if (!r.pass) allPass = false;
    }
    console.log();

    if (allPass) {
        colorLog("RESULT", "全テスト通過！本番デプロイ可能です。", "green");
    } else {
        colorLog("RESULT", "一部テストが失敗しています。修正が必要です。", "red");
    }
}

main();
