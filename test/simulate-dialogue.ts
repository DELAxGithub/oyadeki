/**
 * 二段階メディア対話フロー シミュレーション
 *
 * 本番の index.ts と同じ分岐ロジックを再現:
 *   1. identifyMedia → 常にMediaDialogueState（質問+候補）
 *   2. ユーザー回答 → continueMediaDialogue
 *      - 肯定（はい）→ MediaInfo確定 → 評価フェーズへ
 *      - 否定（違う）→ 次の質問
 *      - ヒント（ガンダムです）→ 絞り込み質問
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read test/simulate-dialogue.ts
 *   deno run --allow-net --allow-env --allow-read test/simulate-dialogue.ts --image path/to/image.jpg
 */
import { load } from "https://deno.land/std@0.177.0/dotenv/mod.ts";
const env = await load({ envPath: ".env.local" });
for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);

import {
    identifyMedia,
    continueMediaDialogue,
    type MediaInfo,
    type MediaDialogueState,
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
    colorLog("INFO", "ダミー画像使用。--image で実画像を指定可能", "yellow");
    return {
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
    };
}

/**
 * 本番の index.ts と同じ分岐ロジックでテスト
 */
async function testDialogueFlow(
    userReply: string,
    dialogueState: MediaDialogueState,
    history: { role: string; text: string }[]
) {
    console.log(`\n${"=".repeat(50)}`);
    colorLog("USER", `「${userReply}」`, "cyan");

    // 本番と同じ: history にユーザー回答を追加
    history.push({ role: "user", text: userReply });

    // 本番と同じ: storedCandidate を取得
    const storedCandidate = dialogueState.media_candidate || null;
    console.log("  storedCandidate:", storedCandidate ? storedCandidate.title : "null");

    const start = Date.now();
    const result = await continueMediaDialogue(
        dialogueState.visual_clues,
        history,
        userReply,
        storedCandidate
    );
    const elapsed = Date.now() - start;

    console.log("  continueMediaDialogue result:", result ? JSON.stringify(result).substring(0, 300) : "null");
    console.log(`  (${elapsed}ms)`);

    // 本番と同じ分岐ロジック
    if (result) {
        if ("visual_clues" in result) {
            // 対話継続
            const nextState = result as MediaDialogueState;
            history.push({ role: "assistant", text: nextState.question });

            colorLog("BOT", `🎬 ${nextState.question}`, "yellow");
            if (nextState.media_candidate) {
                colorLog("INFO", `(内部候補: ${nextState.media_candidate.title})`, "cyan");
            }
            return { state: nextState, history, confirmed: false };
        } else {
            // 確定！
            const mediaInfo = result as MediaInfo;
            colorLog("BOT", `🎉 「${mediaInfo.title}」ですね！`, "green");
            colorLog("BOT", `💡 ${mediaInfo.trivia || ""}`, "green");
            console.log("  タイプ:", mediaInfo.media_type);
            console.log("  出演:", mediaInfo.artist_or_cast);
            console.log("  年:", mediaInfo.year);
            return { state: null, history, confirmed: true, mediaInfo };
        }
    } else {
        colorLog("BOT", "🤔 うーん、まだピンときていません...", "yellow");
        return { state: dialogueState, history, confirmed: false };
    }
}

async function main() {
    console.log("========================================");
    console.log(" 二段階メディア対話フロー シミュレーション");
    console.log("========================================\n");

    let imagePath: string | undefined;
    const imageIdx = Deno.args.indexOf("--image");
    if (imageIdx !== -1 && Deno.args[imageIdx + 1]) {
        imagePath = Deno.args[imageIdx + 1];
    }

    const { base64, mimeType } = await loadImage(imagePath);

    // ==================== Step 1: identifyMedia ====================
    console.log("\n--- Step 1: identifyMedia (対話開始) ---");
    const start1 = Date.now();
    const dialogueState = await identifyMedia(base64, mimeType);
    colorLog("OK", `identifyMedia完了 (${Date.now() - start1}ms)`, "green");

    if (!dialogueState) {
        colorLog("ERROR", "identifyMedia returned null - フロー終了", "red");
        return;
    }

    colorLog("BOT", `🎬 ${dialogueState.question}`, "yellow");
    console.log("  visual_clues:", dialogueState.visual_clues);
    if (dialogueState.media_candidate) {
        colorLog("INFO", `(内部候補: ${dialogueState.media_candidate.title})`, "cyan");
    }

    const history: { role: string; text: string }[] = [
        { role: "assistant", text: dialogueState.question }
    ];

    // ==================== Step 2: ユーザー回答テスト ====================

    // テストケース1: 肯定回答「はい」
    console.log("\n\n" + "=".repeat(60));
    colorLog("TEST", "テストケース1: 肯定回答「はい」", "cyan");
    console.log("=".repeat(60));
    const test1 = await testDialogueFlow("はい", dialogueState, [...history]);
    if (test1.confirmed) {
        colorLog("PASS", "✅ 「はい」で作品確定 → 評価フェーズへ進める", "green");
    } else {
        colorLog("INFO", "対話継続（「はい」だけでは確定しなかった）", "yellow");
    }

    // テストケース2: 肯定回答「そうです」
    console.log("\n\n" + "=".repeat(60));
    colorLog("TEST", "テストケース2: 肯定回答「そうです」", "cyan");
    console.log("=".repeat(60));
    const test2 = await testDialogueFlow("そうです", dialogueState, [...history]);
    if (test2.confirmed) {
        colorLog("PASS", "✅ 「そうです」で作品確定", "green");
    } else {
        colorLog("INFO", "対話継続", "yellow");
    }

    // テストケース3: 具体的な回答
    console.log("\n\n" + "=".repeat(60));
    colorLog("TEST", "テストケース3: 具体的な回答「ガンダムです」", "cyan");
    console.log("=".repeat(60));
    const test3 = await testDialogueFlow("ガンダムです", dialogueState, [...history]);
    if (test3.confirmed) {
        colorLog("PASS", "✅ 具体回答で作品確定", "green");
    } else {
        colorLog("INFO", "対話継続 → さらに絞り込み", "yellow");

        // 続けて肯定
        if (test3.state) {
            console.log("\n  → 続けて「はい」と回答...");
            const test3b = await testDialogueFlow("はい", test3.state, test3.history);
            if (test3b.confirmed) {
                colorLog("PASS", "✅ 2回目の対話で確定", "green");
            } else {
                colorLog("WARN", "2回の対話でも確定せず", "yellow");
            }
        }
    }

    // テストケース4: 否定回答
    console.log("\n\n" + "=".repeat(60));
    colorLog("TEST", "テストケース4: 否定回答「違います」", "cyan");
    console.log("=".repeat(60));
    const test4 = await testDialogueFlow("違います", dialogueState, [...history]);
    if (test4.confirmed) {
        colorLog("WARN", "否定なのに確定された（予期しない）", "yellow");
    } else {
        colorLog("PASS", "✅ 否定 → 別の候補で対話継続", "green");
    }

    // ==================== サマリー ====================
    console.log("\n\n" + "=".repeat(60));
    console.log(" テスト結果サマリー");
    console.log("=".repeat(60));
    console.log(`  テスト1「はい」    : ${test1.confirmed ? "✅ 確定" : "🔄 対話継続"}`);
    console.log(`  テスト2「そうです」: ${test2.confirmed ? "✅ 確定" : "🔄 対話継続"}`);
    console.log(`  テスト3「ガンダム」: ${test3.confirmed ? "✅ 確定" : "🔄 対話継続"}`);
    console.log(`  テスト4「違います」: ${!test4.confirmed ? "✅ 対話継続" : "❌ 予期しない確定"}`);
    console.log();
    colorLog("DONE", "シミュレーション完了", "green");
}

main();
