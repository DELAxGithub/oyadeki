/**
 * Gemini APIクライアント
 * Pro -> Flash フォールバック対応
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiResponse {
    candidates?: Array<{
        content: {
            parts: Array<{ text?: string; thought?: string }>;
        };
    }>;
}

import { UserContext } from "./supabase-client.ts";

export interface GenerateOptions {
    model?: string;
    signal?: AbortSignal;
    maxTokens?: number;
    tools?: any[];
}

/**
 * ユーザーのコンテキストに基づいてペルソナ（口調・キャラ設定）を生成する
 */
export function getPersonaInstruction(context: UserContext | null): string {
    const defaultMetaphor = `
【キャラクター設定：ツェーゲン金沢サポーター】
語尾や雰囲気に少しだけ活気を持たせる。
- 感嘆：「ナイスゴール！」「レッドカード！（危険）」「VAR判定（確認中）」
- 肯定：「その調子！」「いい攻め上がりです！」
- 挨拶：「お疲れ様です！後半戦もいきましょう！」
`;

    if (context?.metaphor_enabled && context?.metaphor_theme) {
        const theme = context.metaphor_theme;
        if (theme.includes("相撲")) {
            return `
【キャラクター設定：大相撲の行司・親方】
- 語尾：「〜でごわす」「〜とのこと」
- 表現：「待ったなし」「土俵際」「金星」
- 丁寧だが力強い口調で。
`;
        } else if (theme.includes("サッカー") || theme.includes("ツェーゲン")) {
            return defaultMetaphor;
        } else {
            return `
【キャラクター設定：${theme}】
「${theme}」に関連した親しみやすい例えや口調を適度に使ってください。
`;
        }
    }
    return defaultMetaphor;
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
    const model = options.model ?? "gemini-2.5-flash";

    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: options.tools,
            generationConfig: {
                maxOutputTokens: options.maxTokens ?? 2048,
                temperature: 0.7,
            },
        }),
        signal: options.signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini API error:", response.status, errorText);
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
    const model = options.model ?? "gemini-2.5-flash";

    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const body: any = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
            },
        ],
        generationConfig: {
            maxOutputTokens: options.maxTokens ?? 2048,
            temperature: 0.5,
        },
    };

    if (options.tools) {
        body.tools = options.tools;
    }

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
export interface LedgerItem {
    id?: string;
    service_name: string;
    category: "utility" | "subscription" | "insurance" | "telecom" | "other";
    account_identifier?: string;
    monthly_cost?: number;
    note?: string;
}

/**
 * Geminiで台帳情報を抽出する
 */
export async function extractLedgerInfo(
    text: string,
    imageBase64?: string,
    mimeType?: string
): Promise<LedgerItem[]> {
    const prompt = `
あなたは高齢者の契約情報を整理するアシスタントです。
入力された画像（スクリーンショットや請求書）またはテキストから、
「サービスの契約情報」を抽出してJSON配列で返してください。

【抽出ルール】
- service_name: サービス名を正確に（例: "Netflix", "NHK", "ドコモ"）
- category: 以下から推定
  - utility (電気・ガス・水道)
  - subscription (サブスク・定期便)
  - insurance (保険)
  - telecom (携帯・ネット回線)
  - other (その他)
- account_identifier: 契約番号、ID、メールアドレスなど（パスワードは絶対に含めない）
- monthly_cost: 月額料金（数値のみ、不明ならnull）
- note: 解約方法や注意点があれば簡潔に

入力に契約情報が含まれない場合、空配列 [] を返してください。
整形されたJSONのみを返し、Markdownコードブロック等は不要です。
`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";

    const contents = [];
    if (imageBase64 && mimeType) {
        contents.push({
            parts: [
                { text: prompt + `\n\n【補足テキスト】${text}` },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
        });
    } else {
        contents.push({
            parts: [
                { text: prompt + `\n\n【入力テキスト】${text}` },
            ],
        });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents,
            generationConfig: {
                response_mime_type: "application/json",
                temperature: 0.1,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    try {
        return JSON.parse(jsonText);
    } catch (e) {
        console.error("Failed to parse ledger JSON:", e);
        return [];
    }
}

/**
 * 画像のIntentを判定（help or media）
 */
/**
 * 画像のIntentを判定（help or media or sell）
 */
export async function classifyImageIntent(
    imageBase64: string,
    mimeType: string
): Promise<"help" | "media" | "sell" | "ledger"> {
    const prompt = `この画像を見て、以下のどれか判定してください:

1. "help" - スマホの操作に困っている画面
   (エラー、設定、ダイアログ、警告、ログイン画面、アプリ更新など)

2. "media" - 視聴中のコンテンツ
   (テレビ番組、映画、スポーツ中継、YouTube、ライブ、コンサート、
    映画ポスター、CDジャケット、本の表紙など)

3. "sell" - 売りたい商品（フリマ出品用）
   (家電、ガジェット、服、バッグ、本、ゲーム機、フィギュア、
    またはそれらが机の上や背景ありで撮影されている写真)

4. "ledger" - 契約台帳に登録すべき書類・契約情報
   (請求書、明細、会員証、契約書、公共料金のハガキ、
    サブスク決済履歴、通信契約の画面など)

回答: help または media または sell または ledger のみ（他の文字は含めない）`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
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
                maxOutputTokens: 50,
                temperature: 0.1,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("classifyImageIntent failed:", response.status, errorText);
        return "help"; // デフォルトはhelp
    }

    const data: GeminiResponse = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() ?? "";

    if (text.includes("ledger")) return "ledger";
    if (text.includes("media")) return "media";
    if (text.includes("sell")) return "sell";
    return "help";
}

export interface MediaInfo {
    media_type: "movie" | "tv_show" | "anime" | "sports" | "music" | "book" | "other";
    title: string;
    subtitle?: string;        // エピソード名、対戦カードなど
    artist_or_cast?: string;  // 出演者、チーム名
    year?: number;
    trivia?: string;          // 豆知識、見どころ、受賞歴
    // 外部DB enrichment
    poster_url?: string;      // ポスター/カバー画像URL
    synopsis?: string;        // あらすじ
    score?: number;           // 外部DBの評価スコア
    genres?: string[];        // ジャンル
    external_url?: string;    // 外部DBのURL
    external_source?: string; // データソース名 ("TMDB" | "MyAnimeList" | "iTunes")
}

/**
 * 画像からメディア情報を識別
 */
export interface MediaDialogueState {
    visual_clues: string;    // 見えているもの（人、背景、文字など）
    question: string;        // ユーザーへの絞り込み質問
    media_candidate?: MediaInfo; // もし候補があれば
}

export type IdentifyMediaResult = MediaInfo | MediaDialogueState | null;

function summarizeParts(parts: Array<{ text?: string; thought?: string }> | undefined) {
    if (!parts) return [];
    return parts.map((part, index) => ({
        index,
        hasText: !!part.text,
        hasThought: !!part.thought,
        textPreview: part.text ? part.text.slice(0, 120) : "",
    }));
}

function tryParseJsonText(raw: string): Record<string, unknown> | null {
    // 1) strict JSON
    try {
        return JSON.parse(raw);
    } catch {
        // continue
    }

    // 2) fenced code block
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
        try {
            return JSON.parse(fence[1].trim());
        } catch {
            // continue
        }
    }

    // 3) first/last brace extraction
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            // continue
        }
    }

    return null;
}

function parseJsonFromParts(parts: Array<{ text?: string; thought?: string }> | undefined): {
    parsed: Record<string, unknown> | null;
    rawText: string;
} {
    if (!parts || parts.length === 0) return { parsed: null, rawText: "" };
    const texts = parts.map((part) => part.text).filter((text): text is string => !!text);
    if (texts.length === 0) return { parsed: null, rawText: "" };

    for (const text of texts) {
        const parsed = tryParseJsonText(text);
        if (parsed) return { parsed, rawText: text };
    }

    const merged = texts.join("\n");
    return { parsed: tryParseJsonText(merged), rawText: merged };
}

function normalizeTriviaSentence(text: string): string {
    // Keep trivia as declarative to avoid confusing the user.
    let out = text;
    out = out.replace(/[？?]/g, "。");
    out = out.replace(/いかがでしょうか[。]*/g, "です。");
    out = out.replace(/ご存知ですか[。]*/g, "ご存知です。");
    out = out.replace(/でしょうか[。]*/g, "です。");
    out = out.replace(/ですか[。]*/g, "です。");
    out = out.replace(/。{2,}/g, "。");
    return out.trim();
}

function normalizeAkinatorQuestion(raw: string): string {
    const normalized = raw.trim().replace(/\r\n/g, "\n");
    if (!normalized) return "この作品は何でしょうか？";

    // Prefer two-line style:
    // 1st line: identification question
    // 2nd line: trivia (declarative)
    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length >= 2) {
        const first = lines[0];
        const rest = lines.slice(1).map(normalizeTriviaSentence);
        return [first, ...rest].join("\n");
    }

    // Single-line fallback:
    // allow exactly one question mark, convert later ones to period.
    let questionMarkCount = 0;
    const oneQuestionOnly = normalized.replace(/[？?]/g, () => {
        questionMarkCount += 1;
        return questionMarkCount === 1 ? "？" : "。";
    });

    if (questionMarkCount <= 1) return oneQuestionOnly;

    // If there were multiple question marks, clean up the trivia part too.
    const firstQuestionIdx = oneQuestionOnly.indexOf("？");
    if (firstQuestionIdx === -1) return oneQuestionOnly;
    const head = oneQuestionOnly.slice(0, firstQuestionIdx + 1);
    const tail = normalizeTriviaSentence(oneQuestionOnly.slice(firstQuestionIdx + 1));
    return `${head}\n💡 ${tail}`.trim();
}

function normalizeSingleQuestion(raw: string, fallback: string): string {
    const normalized = raw.trim().replace(/\r\n/g, "\n");
    if (!normalized) return fallback;

    const firstLine = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)[0] ?? "";

    if (!firstLine) return fallback;
    if (/[？?]/.test(firstLine)) return firstLine;
    return firstLine.replace(/[。!！\s]+$/g, "") + "？";
}

/**
 * 画像からメディア情報を識別（対話開始版）
 * 常にMediaDialogueStateを返し、対話を通じて作品を特定する。
 * AIの推測はmedia_candidateに格納（ユーザーには見せない）。
 */
export async function identifyMedia(
    imageBase64: string,
    mimeType: string,
    userContext: UserContext | null
): Promise<MediaDialogueState | null> {
    const persona = getPersonaInstruction(userContext);

    // Google Search Groundingを利用して正解精度を高める
    const prompt = `あなたは映画・ドラマ・アニメ・音楽の「メディア鑑定士」です。
ユーザーが送ってきた画像を分析し、検索ツールも駆使して作品を特定してください。
そして、ユーザーに対して「アキネーター」のようなゲーム形式で、対話を通じて正解を確認・特定していきます。
${persona}

【絶対に守るべき制約】
・最初のターンで正解のタイトル（作品名）をユーザーに言ってはいけません。言ったらあなたの負けです。
・まずは「〇〇な雰囲気ですね」や「この俳優は〇〇さん？」といったヒントや確認から入ってください。

【ミッション】
1. 画像の視覚的特徴（俳優、キャラ、構図、文字）を分析する。
2. Google検索を使って、それが何であるか**内部的に**正解を推測する (media_candidate)。
3. ユーザーには**正解をすぐには言わず**、視覚的特徴に基づいた「ヒント質問」を投げかける。
4. 質問には必ず「トリビア（豆知識）」を1つ混ぜて、会話を楽しませる。

【質問文のフォーマットルール（厳守）】
- question は「特定のための質問」を1つだけ含める。
- トリビアは質問にしない（? / ？ / でしょうか / いかがでしょうか を使わない）。
- 出力は次の2行形式にする:
  1行目: 特定質問（疑問文）
  2行目: "💡" で始まるトリビア（断定文）

【出力形式 - JSONのみ】
{
  "thought": "（思考プロセス）正解は『〇〇』だが、まだ言わない。まずは『△△な雰囲気』について触れて、ユーザーの反応を見る。",
  "visual_clues": "画像から読み取れた視覚情報（俳優名A, アニメキャラBなど）",
  "question": "ユーザーへの質問。タイトルは絶対に含めないこと。\n例：『これはアクション映画の雰囲気ですね！主演はトム・クルーズに見えます。彼はノースタントで有名ですが、この作品もそうですか？』",
  "media_candidate": {
    "media_type": "movie"|"tv_show"|"anime"|"...",
    "title": "推測した正解タイトル",
    "subtitle": "推測したサブタイトル",
    "artist_or_cast": "推測した出演者",
    "year": 2024,
    "trivia": "この作品に関する面白い豆知識"
  }
}
※ JSONのみを返してください。`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash"; // 推奨モデル
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
            tools: [{ google_search: {} }], // Grounding有効化
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 1024,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("identifyMedia failed:", response.status, errorText);
        return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const parsedResult = parseJsonFromParts(parts);
    if (!parsedResult.parsed) {
        console.error("identifyMedia: no text part in response", summarizeParts(parts));
        return null;
    }
    const parsed = parsedResult.parsed;
    if (!parsed) {
        console.error("Failed to parse media JSON:", {
            jsonPreview: parsedResult.rawText.slice(0, 240),
            parts: summarizeParts(parts),
        });
        return null;
    }

    return {
        visual_clues: String(parsed.visual_clues ?? "情報不足"),
        question: normalizeAkinatorQuestion(String(parsed.question ?? "この画面に映っているのは何ですか？")),
        media_candidate: (parsed.media_candidate as MediaInfo) || undefined,
    } as MediaDialogueState;
}

/**
 * 3. メディア特定対話の継続（二段階フロー対応）
 * ユーザーの回答をヒントに再特定を試みる。
 * ユーザーが作品名を肯定 → MediaInfo を返す（確定）
 * まだ不明 → MediaDialogueState を返す（対話継続）
 */
export async function continueMediaDialogue(
    visualClues: string,
    dialogueHistory: { role: string; text: string }[],
    userReply: string,
    mediaCandidate: MediaInfo | null | undefined,
    userContext: UserContext | null
): Promise<IdentifyMediaResult> {
    const persona = getPersonaInstruction(userContext);
    const candidateInfo = mediaCandidate
        ? `\nAIの現在の推測: ${JSON.stringify(mediaCandidate)}`
        : "\nAIの推測: なし（まだ候補が絞れていない）";

    const prompt = `あなたは映画・テレビ・アニメに詳しい「メディア鑑定士」です。
ユーザーとの対話を通じて、作品を特定します。
${persona}

【現状の情報】
視覚情報: ${visualClues}${candidateInfo}
会話履歴: ${JSON.stringify(dialogueHistory.slice(-6))}
ユーザーの最新の回答: "${userReply}"

【重要ルール】
1. ユーザーが作品名やシリーズ名を肯定した場合（「はい」「そう」「そうです」「正解」「合ってる」など）：
   → パターンAで確定してください。
2. ユーザーがキャラ名や作品名のヒントを出した場合：
   → あなたの知識で補完し、「○○ですね！」と確認する質問を返してください（パターンB）。
3. ユーザーが否定した場合（「違う」「いいえ」など）：
   → 別の候補を挙げて質問してください（パターンB）。新しい推測をmedia_candidateに入れてください。
4. 質問にはトリビア（豆知識）を交えて会話を楽しくしてください。

【質問文のフォーマットルール（厳守）】
- question は特定のための質問を1つだけ。
- トリビアは必ず断定文にし、疑問文にしない。
- 出力は2行形式:
  1行目: 特定質問（疑問文）
  2行目: "💡" で始まるトリビア（断定文）

【出力形式 - JSONのみ】
パターンA：ユーザーが確認・肯定した場合（確定）
{
  "identified": true,
  "data": { ...MediaInfo... }
}

パターンB：まだ確定していない場合（対話継続）
{
  "identified": false,
  "visual_clues": "更新された視覚情報",
  "question": "トリビアを交えた次の質問",
  "media_candidate": { ...MediaInfo... }
}

JSONのみを返してください。`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                response_mime_type: "application/json",
                temperature: 0.4,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("continueMediaDialogue failed:", response.status, errorText);
        return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const parsedResult = parseJsonFromParts(parts);
    if (!parsedResult.parsed) {
        console.error("continueMediaDialogue: no text part in response", summarizeParts(parts));
        return null;
    }

    try {
        const parsed = parsedResult.parsed as any;
        if (parsed.identified && parsed.data && parsed.data.title) {
            return parsed.data as MediaInfo;
        } else if (!parsed.identified && parsed.question) {
            return {
                visual_clues: parsed.visual_clues || visualClues,
                question: normalizeAkinatorQuestion(String(parsed.question)),
                media_candidate: parsed.media_candidate || undefined,
            } as MediaDialogueState;
        }
        return null;
    } catch (e) {
        console.error("Failed to parse continueMediaDialogue JSON:", e, {
            jsonPreview: parsedResult.rawText.slice(0, 240),
            parts: summarizeParts(parts),
        });
        return null;
    }
}

// ==================== 外部メディアDB検索 ====================

/**
 * メディア情報を外部DBで補完する
 * anime → Jikan (MyAnimeList), movie/tv_show → TMDB, music → iTunes
 */
export async function enrichMediaInfo(media: MediaInfo): Promise<MediaInfo> {
    try {
        switch (media.media_type) {
            case "anime":
                return await enrichFromJikan(media);
            case "movie":
                return await enrichFromTMDB(media, "movie");
            case "tv_show":
                return await enrichFromTMDB(media, "tv");
            case "music":
                return await enrichFromiTunes(media);
            default:
                // sports, book, other → TMDBで試す
                return await enrichFromTMDB(media, "multi");
        }
    } catch (e) {
        console.error("enrichMediaInfo failed:", e);
        return media; // エンリッチ失敗時は元のまま返す
    }
}

/** Jikan API (MyAnimeList) - 認証不要 */
async function enrichFromJikan(media: MediaInfo): Promise<MediaInfo> {
    const query = encodeURIComponent(media.title);
    const res = await fetch(
        `https://api.jikan.moe/v4/anime?q=${query}&limit=3`,
        { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return media;

    const data = await res.json();
    const results = data.data;
    if (!results?.length) return media;

    // タイトルが最も一致するものを選択
    const best = results[0];

    return {
        ...media,
        title: best.title_japanese || best.title || media.title,
        year: best.year || media.year,
        artist_or_cast: media.artist_or_cast || best.studios?.map((s: any) => s.name).join(", "),
        poster_url: best.images?.jpg?.large_image_url || best.images?.jpg?.image_url,
        synopsis: best.synopsis?.substring(0, 200),
        score: best.score,
        genres: best.genres?.map((g: any) => g.name),
        external_url: best.url,
        external_source: "MyAnimeList",
    };
}

/** TMDB API - Bearer token認証 */
async function enrichFromTMDB(media: MediaInfo, type: "movie" | "tv" | "multi"): Promise<MediaInfo> {
    const token = Deno.env.get("TMDB_API_TOKEN");
    if (!token) return media;

    const query = encodeURIComponent(media.title);
    const endpoint = type === "multi" ? "search/multi" : `search/${type}`;
    const res = await fetch(
        `https://api.themoviedb.org/3/${endpoint}?query=${query}&language=ja-JP&include_adult=false`,
        {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(5000),
        }
    );
    if (!res.ok) return media;

    const data = await res.json();
    const results = data.results;
    if (!results?.length) return media;

    const best = results[0];
    const title = best.title || best.name;
    const releaseDate = best.release_date || best.first_air_date;
    const mediaType = best.media_type === "tv" ? "tv_show" : best.media_type === "movie" ? "movie" : media.media_type;

    return {
        ...media,
        title: title || media.title,
        media_type: type === "multi" ? mediaType : media.media_type,
        year: releaseDate ? parseInt(releaseDate.substring(0, 4)) : media.year,
        poster_url: best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : undefined,
        synopsis: best.overview?.substring(0, 200),
        score: best.vote_average,
        genres: undefined, // genre_ids → 名前解決が必要なので省略
        external_url: `https://www.themoviedb.org/${type === "multi" ? (best.media_type || "movie") : type}/${best.id}`,
        external_source: "TMDB",
    };
}

/** iTunes Search API - 認証不要 */
async function enrichFromiTunes(media: MediaInfo): Promise<MediaInfo> {
    const query = encodeURIComponent(media.title + (media.artist_or_cast ? ` ${media.artist_or_cast}` : ""));
    const res = await fetch(
        `https://itunes.apple.com/search?term=${query}&country=JP&media=music&limit=3&lang=ja_jp`,
        { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return media;

    const data = await res.json();
    const results = data.results;
    if (!results?.length) return media;

    const best = results[0];

    return {
        ...media,
        title: best.trackName || media.title,
        artist_or_cast: best.artistName || media.artist_or_cast,
        subtitle: best.collectionName || media.subtitle,
        year: best.releaseDate ? parseInt(best.releaseDate.substring(0, 4)) : media.year,
        poster_url: best.artworkUrl100?.replace("100x100", "600x600"),
        genres: best.primaryGenreName ? [best.primaryGenreName] : undefined,
        external_url: best.trackViewUrl,
        external_source: "iTunes",
    };
}

export interface ListingInfo {
    title: string;           // 出品タイトル（40文字以内）
    description: string;     // 説明文
    category: string;        // カテゴリ提案
    condition: string;       // 商品の状態
}

/**
 * 画像から出品用テキストを生成（メルカリ向け・一発生成版）
 * バックアップ/互換性維持用
 */
export async function generateListing(
    imageBase64: string,
    mimeType: string
): Promise<ListingInfo | null> {
    const prompt = `この商品の写真を見て、メルカリ出品用のタイトルと説明文を作成してください。

【出力形式 - JSONのみ】
{
  "title": "商品タイトル（40文字以内、検索されやすいキーワードを含める）",
  "description": "商品説明文（200文字程度、状態・サイズ・使用感など）",
  "category": "推定カテゴリ（例: レディース > トップス > Tシャツ）",
  "condition": "商品の状態（新品未使用/未使用に近い/目立った傷や汚れなし/やや傷や汚れあり/傷や汚れあり/全体的に状態が悪い）"
}

【タイトルのコツ】
- ブランド名があれば先頭に
- サイズ・色を含める
- 「美品」「新品」など状態を示す言葉
- 例: 「【美品】ユニクロ フリースジャケット グレー Lサイズ」

【説明文のコツ】
- 最初に商品の概要
- サイズ・寸法（わかれば）
- 使用頻度・状態の詳細
- 購入時期（推測でOK）
- 最後に「ご質問があればお気軽にどうぞ！」

JSONのみを返し、Markdownコードブロックは不要です。`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
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
                response_mime_type: "application/json",
                temperature: 0.5,
            },
        }),
    });

    if (!response.ok) {
        console.error("generateListing failed:", response.status);
        return null;
    }

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "null";

    try {
        const parsed = JSON.parse(jsonText);
        if (parsed && parsed.title && parsed.description) {
            return parsed as ListingInfo;
        }
        return null;
    } catch (e) {
        console.error("Failed to parse listing JSON:", e);
        return null;
    }
}

// ==================== 対話型出品サポート用ロジック ====================

export interface SellDialogueState {
    image_summary: string;
    extracted_info: Record<string, any>;
    next_question: string | null;
    is_sufficient: boolean;
    listing?: ListingInfo;
}

/**
 * 1. 初期画像解析
 * 画像から商品の基本的な特徴を抽出し、最初の質問を生成する。
 */
export async function analyzeProductImage(
    imageBase64: string,
    mimeType: string,
    userContext: UserContext | null
): Promise<SellDialogueState | null> {
    const persona = getPersonaInstruction(userContext);

    // Google検索を使って相場情報も取得する
    const prompt = `あなたはプロの「メルカリ出品アシスタント」です。
ユーザーが売りたい商品の写真を送ってきました。
画像を分析し、検索ツールも使って、商品名や相場を特定してください。
このフローはクイズではありません。最短で商品を特定してください。
${persona}

【最重要ルール】
- 初手で最有力の商品候補を提示し、確認質問を1つだけ出す。
- 雑談やトリビアは不要。
- first_question は「はい/違う」で答えられる確認形式を優先。
- 候補が不確実なら「商品名か型番を教えてください」と短く聞く。

【タスク】
1. 画像から商品（ブランド、型番、状態）を推定する。
2. Google検索で「メルカリ 売り切れ」等を参考に相場（price_estimate）を推定する。
3. 出品文作成に必要な最小情報を extracted_info に格納する。
4. first_question で「商品特定」を最優先して確認する。

【出力形式 - JSONのみ】
{
  "image_summary": "画像の視覚的特徴",
  "extracted_info": {
    "type": "sell_dialogue",
    "identity_confirmed": false,
    "category": "推定カテゴリ",
    "product_name": "推定商品名・型番",
    "price_estimate": "推定相場（例: 3000円〜5000円）",
    "condition": "推定状態（不明なら空文字）"
  },
  "first_question": "ユーザーへの最初の質問（1つだけ）。\n例：『これはダイソン V8 Slimで合っていますか？違う場合は商品名や型番を教えてください。』"
}
`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
            }],
            tools: [{ google_search: {} }], // Grounding有効化
            generationConfig: { temperature: 0.5 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("analyzeProductImage failed:", response.status, errorText);
        return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const parsedResult = parseJsonFromParts(parts);
    if (!parsedResult.parsed) {
        console.error("analyzeProductImage: no text/json part", summarizeParts(parts));
        return null;
    }

    try {
        const parsed = parsedResult.parsed as any;
        const extractedInfo = parsed.extracted_info || {};
        if (typeof extractedInfo === "object" && extractedInfo !== null) {
            extractedInfo.type = "sell_dialogue";
        }

        return {
            image_summary: String(parsed.image_summary || ""),
            extracted_info: extractedInfo,
            next_question: normalizeSingleQuestion(
                String(parsed.first_question || ""),
                "これはどんな商品ですか？商品名や型番を教えてください。"
            ),
            is_sufficient: false
        };
    } catch (e) {
        console.error("Failed to parse analyzeProductImage JSON:", e, {
            jsonPreview: parsedResult.rawText.slice(0, 240),
            parts: summarizeParts(parts),
        });
        return null;
    }
}

/**
 * 2. 継続対話・情報更新
 * これまでの情報とユーザーの回答から、情報を更新し、次のアクション（質問継続 or 出品生成）を決定する。
 */
export async function continueSellingDialogue(
    currentInfo: Record<string, any>,
    imageSummary: string,
    dialogueHistory: { role: string; text: string }[],
    userReply: string,
    userContext: UserContext | null
): Promise<SellDialogueState | null> {
    const persona = getPersonaInstruction(userContext);
    const prompt = `あなたはプロの「メルカリ出品アシスタント」です。
ユーザーとの対話を通じて、出品文を完成させます。
このフローはクイズではありません。最短で商品を特定して進めてください。
${persona}

【現状の情報】
画像の特徴: ${imageSummary}
抽出済み情報: ${JSON.stringify(currentInfo)}
会話履歴: ${JSON.stringify(dialogueHistory.slice(-4))}
ユーザーの回答: "${userReply}"

【優先順位】
1. 商品特定（product_name）を最優先。否定されたら即座に別候補または型番確認へ。
2. 特定後に、出品に必要な不足情報（状態・カテゴリなど）を最小ターンで回収。
3. 早く十分情報が揃えば、すぐ listing を生成。

【タスク】
1. ユーザー回答を反映して extracted_info を更新する。
2. is_sufficient を判定する（必須: 商品名、状態、カテゴリ）。
3. 不十分なら next_question を1つだけ返す（短く具体的に）。
4. 十分なら listing を返す。
5. extracted_info.type は必ず "sell_dialogue" を維持する。

【出力形式 - JSONのみ】
{
  "extracted_info": { ... },
  "is_sufficient": boolean,
  "next_question": "...",
  "listing": { "title": "...", "description": "...", "category": "...", "condition": "..." }
}
`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.5 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("continueSellingDialogue failed:", response.status, errorText);
        return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const parsedResult = parseJsonFromParts(parts);
    if (!parsedResult.parsed) {
        console.error("continueSellingDialogue: no text/json part", summarizeParts(parts));
        return null;
    }

    try {
        const parsed = parsedResult.parsed as any;
        const extractedInfo = parsed.extracted_info || currentInfo;
        if (typeof extractedInfo === "object" && extractedInfo !== null) {
            extractedInfo.type = "sell_dialogue";
        }
        return {
            image_summary: imageSummary,
            extracted_info: extractedInfo,
            next_question: parsed.next_question
                ? normalizeSingleQuestion(String(parsed.next_question), "商品の状態を教えてください。")
                : null,
            is_sufficient: parsed.is_sufficient || false,
            listing: parsed.listing
        };
    } catch (e) {
        console.error("Failed to parse continueSellingDialogue JSON:", e, {
            jsonPreview: parsedResult.rawText.slice(0, 240),
            parts: summarizeParts(parts),
        });
        return null;
    }
}

export interface LedgerDialogueState {
    document_clues: string;
    question: string;
    ledger_candidate?: LedgerItem;
}

export type IdentifyLedgerResult = LedgerItem | LedgerDialogueState | null;

const LEDGER_CATEGORY_SET = new Set(["utility", "subscription", "insurance", "telecom", "other"]);

function normalizeLedgerCategory(input: unknown): LedgerItem["category"] {
    const value = String(input ?? "").trim().toLowerCase();
    if (LEDGER_CATEGORY_SET.has(value)) {
        return value as LedgerItem["category"];
    }
    return "other";
}

function normalizeLedgerItem(raw: any): LedgerItem | null {
    if (!raw || typeof raw !== "object") return null;
    const serviceName = String(raw.service_name ?? "").trim();
    if (!serviceName) return null;

    const accountIdentifier = raw.account_identifier == null
        ? undefined
        : String(raw.account_identifier).trim() || undefined;

    const note = raw.note == null ? undefined : String(raw.note).trim() || undefined;

    let monthlyCost: number | undefined = undefined;
    if (raw.monthly_cost != null && raw.monthly_cost !== "") {
        const parsed = Number(raw.monthly_cost);
        if (Number.isFinite(parsed) && parsed >= 0) {
            monthlyCost = Math.round(parsed);
        }
    }

    return {
        service_name: serviceName,
        category: normalizeLedgerCategory(raw.category),
        account_identifier: accountIdentifier,
        monthly_cost: monthlyCost,
        note,
    };
}

/**
 * 台帳向け: 画像から契約書類を最短で特定するための対話開始
 */
export async function identifyLedgerDocument(
    imageBase64: string,
    mimeType: string,
    userContext: UserContext | null
): Promise<LedgerDialogueState | null> {
    const persona = getPersonaInstruction(userContext);
    const prompt = `あなたは「契約台帳登録アシスタント」です。
ユーザーが送った書類画像を最短で特定し、登録候補を作ります。
${persona}

【重要】
- クイズ形式にしない。雑談しない。
- 1ターン目で最有力候補を提示し、確認質問を1つだけ返す。
- 候補が弱い場合も、次に必要な確認を1つだけ聞く。
- トリビアは禁止。

【出力形式 - JSONのみ】
{
  "document_clues": "画像から読める視覚情報",
  "question": "確認質問（1つだけ）",
  "ledger_candidate": {
    "service_name": "推定サービス名",
    "category": "utility|subscription|insurance|telecom|other",
    "account_identifier": "契約番号やID（不明ならnull）",
    "monthly_cost": 1234,
    "note": "補足メモ"
  },
  "confidence": 0.0
}
JSONのみを返してください。`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
            }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.3 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("identifyLedgerDocument failed:", response.status, errorText);
        return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const parsedResult = parseJsonFromParts(parts);
    if (!parsedResult.parsed) {
        console.error("identifyLedgerDocument: no text/json part", summarizeParts(parts));
        return null;
    }

    try {
        const parsed = parsedResult.parsed as any;
        const candidate = normalizeLedgerItem(parsed.ledger_candidate);
        return {
            document_clues: String(parsed.document_clues || "情報不足"),
            question: normalizeSingleQuestion(
                String(parsed.question || ""),
                "これはどのサービスの請求書・契約書ですか？"
            ),
            ledger_candidate: candidate || undefined,
        };
    } catch (e) {
        console.error("Failed to parse identifyLedgerDocument JSON:", e, {
            jsonPreview: parsedResult.rawText.slice(0, 240),
            parts: summarizeParts(parts),
        });
        return null;
    }
}

/**
 * 台帳向け: 対話継続で契約情報候補を確定する
 */
export async function continueLedgerDialogue(
    documentClues: string,
    dialogueHistory: { role: string; text: string }[],
    userReply: string,
    ledgerCandidate: LedgerItem | null | undefined,
    userContext: UserContext | null
): Promise<IdentifyLedgerResult> {
    const persona = getPersonaInstruction(userContext);
    const candidateInfo = ledgerCandidate
        ? JSON.stringify(ledgerCandidate)
        : "候補なし";

    const prompt = `あなたは「契約台帳登録アシスタント」です。
画像に写っている契約書類を、ユーザーとの短い対話で確定してください。
${persona}

【現状】
書類情報: ${documentClues}
現在の候補: ${candidateInfo}
会話履歴: ${JSON.stringify(dialogueHistory.slice(-6))}
ユーザーの最新回答: "${userReply}"

【厳守ルール】
1. クイズ形式にしない。雑談しない。
2. ユーザーが肯定（はい/合ってる等）したら identified=true で確定。
3. ユーザーが否定したら別候補を提示して確認質問を1つ返す。
4. ユーザーがサービス名・金額・IDを言ったら候補へ即反映する。
5. 質問は1つだけ。最短（1〜2ターン）で確定を目指す。

【出力形式 - JSONのみ】
確定パターン:
{
  "identified": true,
  "data": {
    "service_name": "...",
    "category": "utility|subscription|insurance|telecom|other",
    "account_identifier": "...",
    "monthly_cost": 1234,
    "note": "..."
  }
}

継続パターン:
{
  "identified": false,
  "document_clues": "更新後の書類情報",
  "question": "次の確認質問（1つだけ）",
  "ledger_candidate": {
    "service_name": "...",
    "category": "...",
    "account_identifier": "...",
    "monthly_cost": 1234,
    "note": "..."
  }
}

JSONのみを返してください。`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.5-flash";
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.3 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("continueLedgerDialogue failed:", response.status, errorText);
        return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const parsedResult = parseJsonFromParts(parts);
    if (!parsedResult.parsed) {
        console.error("continueLedgerDialogue: no text/json part", summarizeParts(parts));
        return null;
    }

    try {
        const parsed = parsedResult.parsed as any;
        if (parsed.identified === true) {
            return normalizeLedgerItem(parsed.data);
        }

        if (parsed.identified === false) {
            return {
                document_clues: String(parsed.document_clues || documentClues || "情報不足"),
                question: normalizeSingleQuestion(
                    String(parsed.question || ""),
                    "サービス名や契約先を教えてください。"
                ),
                ledger_candidate: normalizeLedgerItem(parsed.ledger_candidate) || ledgerCandidate || undefined,
            } as LedgerDialogueState;
        }

        return null;
    } catch (e) {
        console.error("Failed to parse continueLedgerDialogue JSON:", e, {
            jsonPreview: parsedResult.rawText.slice(0, 240),
            parts: summarizeParts(parts),
        });
        return null;
    }
}

/**
 * コンテキスト（文脈）を踏まえたチャット応答
 * 例：直前に見た映画についての質問、台帳についての詳細確認など
 */
export async function chatWithContext(
    userMessage: string,
    contextType: "media" | "ledger",
    contextData: any
): Promise<string> {
    let systemInstruction = "";

    if (contextType === "media") {
        const media = contextData as MediaInfo;
        systemInstruction = `
あなたはユーザーが見ている（または見た直後の）メディア作品について話しています。
作品情報:
- タイトル: ${media.title}
- ジャンル: ${media.media_type}
- 出演: ${media.artist_or_cast || "不明"}
- 年代: ${media.year || "不明"}
- 豆知識: ${media.trivia || "なし"}

ユーザーの質問や感想に対して、フレンドリーに答えてください。
作品のキャスト詳細、あらすじ、評判などを聞かれたら、あなたの知識を使って補足して答えてください。
`;
    } else if (contextType === "ledger") {
        const ledger = contextData as LedgerItem;
        systemInstruction = `
あなたはユーザーの契約情報（台帳）について話しています。
登録情報:
- サービス名: ${ledger.service_name}
- カテゴリ: ${ledger.category}
- 月額: ${ledger.monthly_cost}円
- メモ: ${ledger.note}

ユーザーの質問に対して、この情報を元に答えてください。
もし「解約したい」などの相談であれば、一般的な解約手続きのアドバイスを加えてください。
`;
    }

    const prompt = `${systemInstruction}

ユーザー: ${userMessage}
回答:`;

    // 会話用のLightモデルを使用
    return generateText(prompt, { model: "gemini-2.5-flash" });
}
