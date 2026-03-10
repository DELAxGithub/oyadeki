/**
 * E2Eシミュレーション: 画像処理パイプライン全体テスト
 *
 * 本番の index.ts と同じフローを再現:
 *   1. classifyImageIntent → intent判定
 *   2. intent=media → identifyMedia → MediaInfo or MediaDialogueState
 *   3. intent=help → analyzeImage (helpフロー)
 *   4. intent=sell → analyzeProductImage (出品フロー)
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read test/simulate-e2e.ts
 *   deno run --allow-net --allow-env --allow-read test/simulate-e2e.ts --image path/to/image.jpg
 */
import { load } from "https://deno.land/std@0.177.0/dotenv/mod.ts";
const env = await load({ envPath: ".env.local" });
for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

// gemini-client.ts からインポート
import {
    classifyImageIntent,
    identifyMedia,
    analyzeImage,
    analyzeProductImage,
    identifyLedgerDocument,
    continueMediaDialogue,
    type MediaInfo,
    type MediaDialogueState,
    type LedgerDialogueState,
} from "../supabase/functions/_shared/gemini-client.ts";

function colorLog(label: string, msg: string, color: string) {
    const colors: Record<string, string> = {
        green: "\x1b[32m", red: "\x1b[31m",
        yellow: "\x1b[33m", cyan: "\x1b[36m",
        reset: "\x1b[0m",
    };
    console.log(`${colors[color] || ""}[${label}]${colors.reset} ${msg}`);
}

async function loadImage(path?: string): Promise<{ base64: string; mimeType: string }> {
    if (path) {
        const file = await Deno.readFile(path);
        // 大きなファイルでスタックオーバーフローしないようチャンク処理
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < file.length; i += chunkSize) {
            binary += String.fromCharCode(...file.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        const ext = path.split(".").pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
            jpg: "image/jpeg", jpeg: "image/jpeg",
            png: "image/png", gif: "image/gif", webp: "image/webp",
        };
        colorLog("INFO", `画像: ${path} (${(file.length / 1024).toFixed(1)} KB)`, "cyan");
        return { base64, mimeType: mimeMap[ext || ""] || "image/jpeg" };
    }
    // デフォルト: 1x1 PNG
    colorLog("INFO", "ダミー画像使用。--image で実画像を指定可能", "yellow");
    return {
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
    };
}

async function main() {
    console.log("========================================");
    console.log(" E2E画像処理パイプラインシミュレーション");
    console.log("========================================\n");

    let imagePath: string | undefined;
    const imageIdx = Deno.args.indexOf("--image");
    if (imageIdx !== -1 && Deno.args[imageIdx + 1]) {
        imagePath = Deno.args[imageIdx + 1];
    }

    const { base64, mimeType } = await loadImage(imagePath);

    // ==================== Step 1: Intent判定 ====================
    console.log("\n--- Step 1: classifyImageIntent ---");
    const start1 = Date.now();
    let intent: "help" | "media" | "sell" | "ledger";
    try {
        intent = await classifyImageIntent(base64, mimeType);
        colorLog("OK", `Intent: "${intent}" (${Date.now() - start1}ms)`, "green");
    } catch (e) {
        colorLog("ERROR", `classifyImageIntent threw: ${e}`, "red");
        return;
    }

    // ==================== Step 2: Intent別処理 ====================
    if (intent === "media") {
        console.log("\n--- Step 2: identifyMedia (二段階フロー: 常に対話開始) ---");
        const start2 = Date.now();
        let dialogueState: MediaDialogueState | null;
        try {
            dialogueState = await identifyMedia(base64, mimeType, null);
            colorLog("OK", `identifyMedia完了 (${Date.now() - start2}ms)`, "green");
        } catch (e) {
            colorLog("ERROR", `identifyMedia threw: ${e}`, "red");
            return;
        }

        if (dialogueState === null) {
            colorLog("RESULT", "メディア識別失敗 (null) → helpフローにフォールバック", "yellow");

            // フォールバック: helpフロー
            console.log("\n--- Fallback: analyzeImage (helpフロー) ---");
            const start3 = Date.now();
            try {
                const helpResult = await analyzeImage(base64, mimeType, "この画像を見て状況を説明してください");
                colorLog("OK", `analyzeImage完了 (${Date.now() - start3}ms)`, "green");
                console.log("  応答:", helpResult.substring(0, 300));
            } catch (e) {
                colorLog("ERROR", `analyzeImage threw: ${e}`, "red");
            }
        } else {
            colorLog("RESULT", "対話モード開始（二段階フロー Stage 1）", "cyan");
            console.log("  視覚情報:", dialogueState.visual_clues);
            console.log("  質問:", dialogueState.question);
            if (dialogueState.media_candidate) {
                colorLog("INFO", `AI候補: ${dialogueState.media_candidate.title} (${dialogueState.media_candidate.media_type})`, "cyan");
                console.log("  豆知識:", dialogueState.media_candidate.trivia);
            } else {
                colorLog("INFO", "AI候補: なし（まだ推測できていない）", "yellow");
            }

            // 対話継続テスト: ユーザーが「はい」と肯定した場合
            console.log("\n--- Step 3: continueMediaDialogue (ユーザー肯定 → 確定テスト) ---");
            const start3 = Date.now();
            try {
                const dialogueResult = await continueMediaDialogue(
                    dialogueState.visual_clues,
                    [{ role: "assistant", text: dialogueState.question }],
                    "はい、そうです",  // テスト用: 肯定回答
                    dialogueState.media_candidate,
                    null
                );
                colorLog("OK", `continueMediaDialogue完了 (${Date.now() - start3}ms)`, "green");
                if (dialogueResult) {
                    if ("visual_clues" in dialogueResult) {
                        // まだ対話継続
                        const next = dialogueResult as MediaDialogueState;
                        colorLog("RESULT", "対話継続（まだ確定せず）", "yellow");
                        console.log("  次の質問:", next.question);
                    } else {
                        // 確定！ Stage 2 へ
                        const info = dialogueResult as MediaInfo;
                        colorLog("RESULT", "🎉 作品確定！（Stage 2: 評価フェーズへ）", "green");
                        console.log("  タイトル:", info.title);
                        console.log("  タイプ:", info.media_type);
                        console.log("  出演:", info.artist_or_cast);
                        console.log("  年:", info.year);
                        console.log("  豆知識:", info.trivia);
                    }
                } else {
                    colorLog("WARN", "continueMediaDialogue returned null", "yellow");
                }
            } catch (e) {
                colorLog("ERROR", `continueMediaDialogue threw: ${e}`, "red");
            }
        }

    } else if (intent === "sell") {
        console.log("\n--- Step 2: analyzeProductImage (出品フロー) ---");
        const start2 = Date.now();
        try {
            const sellResult = await analyzeProductImage(base64, mimeType, null);
            colorLog("OK", `analyzeProductImage完了 (${Date.now() - start2}ms)`, "green");
            if (sellResult) {
                console.log("  商品概要:", sellResult.image_summary);
                console.log("  抽出情報:", JSON.stringify(sellResult.extracted_info));
                console.log("  質問:", sellResult.next_question);
            } else {
                colorLog("WARN", "analyzeProductImage returned null", "yellow");
            }
        } catch (e) {
            colorLog("ERROR", `analyzeProductImage threw: ${e}`, "red");
        }

    } else if (intent === "ledger") {
        console.log("\n--- Step 2: identifyLedgerDocument (台帳フロー) ---");
        const start2 = Date.now();
        try {
            const ledgerState = await identifyLedgerDocument(base64, mimeType, null);
            colorLog("OK", `identifyLedgerDocument完了 (${Date.now() - start2}ms)`, "green");
            if (ledgerState) {
                const state = ledgerState as LedgerDialogueState;
                console.log("  書類概要:", state.document_clues);
                console.log("  質問:", state.question);
                if (state.ledger_candidate) {
                    console.log("  候補:", `${state.ledger_candidate.service_name} (${state.ledger_candidate.category})`);
                }
            } else {
                colorLog("WARN", "identifyLedgerDocument returned null", "yellow");
            }
        } catch (e) {
            colorLog("ERROR", `identifyLedgerDocument threw: ${e}`, "red");
        }

    } else {
        // intent === "help"
        console.log("\n--- Step 2: analyzeImage (helpフロー) ---");
        const start2 = Date.now();
        const helpPrompt = `あなたはスマホの操作に不慣れな高齢者のサポーターです。
この画像を見て状況を判断し、以下の情報を返してください：
- 何が起きているか
- 対処法のステップ`;
        try {
            const helpResult = await analyzeImage(base64, mimeType, helpPrompt);
            colorLog("OK", `analyzeImage完了 (${Date.now() - start2}ms)`, "green");
            console.log("  応答:", helpResult.substring(0, 500));
        } catch (e) {
            colorLog("ERROR", `analyzeImage threw: ${e}`, "red");
        }
    }

    console.log("\n========================================");
    colorLog("DONE", "E2Eシミュレーション完了", "green");
}

main();
