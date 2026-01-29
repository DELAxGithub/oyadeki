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
    const model = options.model ?? "gemini-2.0-flash";

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
    const model = "gemini-2.0-flash"; // Visionは2.0 Flash推奨

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
): Promise<"help" | "media" | "sell"> {
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

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.0-flash";
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
                maxOutputTokens: 10,
                temperature: 0.1,
            },
        }),
    });

    if (!response.ok) {
        console.error("classifyImageIntent failed:", response.status);
        return "help"; // デフォルトはhelp
    }

    const data: GeminiResponse = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() ?? "";

    if (text.includes("media")) return "media";
    if (text.includes("sell")) return "sell";
    return "help";
}

export interface MediaInfo {
    media_type: "movie" | "tv_show" | "sports" | "music" | "book" | "other";
    title: string;
    subtitle?: string;        // エピソード名、対戦カードなど
    artist_or_cast?: string;  // 出演者、チーム名
    year?: number;
    trivia?: string;          // 豆知識、見どころ、受賞歴
}

/**
 * 画像からメディア情報を識別
 */
export async function identifyMedia(
    imageBase64: string,
    mimeType: string
): Promise<MediaInfo | null> {
    const prompt = `この画像に映っているメディア（番組・映画・スポーツ・音楽など）を特定してください。

【出力形式 - JSONのみ】
{
  "media_type": "movie" | "tv_show" | "sports" | "music" | "book" | "other",
  "title": "タイトル名",
  "subtitle": "エピソード名や対戦カードなど（あれば）",
  "artist_or_cast": "出演者・アーティスト・チーム名",
  "year": 2024（公開年・放送年、わかれば数値で）,
  "trivia": "この作品に関する短い豆知識や見どころ、受賞歴などを1〜2文で。親世代が興味を持ちそうな内容が良いです。"
}

【判定ガイド】
- テレビ番組（ニュース、ドラマ、バラエティ） → tv_show
- 映画（映画館、映画ポスター、配信映画） → movie
- スポーツ中継（野球、サッカー、相撲など） → sports
- 音楽番組、ライブ、CDジャケット → music
- 本の表紙、読書画面 → book
- それ以外 → other

【例】
- 大河ドラマの画面 → {"media_type": "tv_show", "title": "光る君へ", "subtitle": "第15話", "artist_or_cast": "吉高由里子", "year": 2024, "trivia": "平安時代の衣装は「十二単」と呼ばれ、総重量は20kgにもなったそうです。"}
- サッカー中継 → {"media_type": "sports", "title": "天皇杯決勝", "subtitle": "浦和レッズ vs 名古屋", "artist_or_cast": null, "year": 2024, "trivia": "天皇杯は日本最古のサッカートーナメントで、プロアマ問わず参加できるのが特徴です。"}

特定できない場合は null を返してください。
JSONのみを返し、Markdownコードブロックは不要です。`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.0-flash";
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
                temperature: 0.3,
            },
        }),
    });

    if (!response.ok) {
        console.error("identifyMedia failed:", response.status);
        return null;
    }

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "null";

    try {
        const parsed = JSON.parse(jsonText);
        if (parsed && parsed.title) {
            return parsed as MediaInfo;
        }
        return null;
    } catch (e) {
        console.error("Failed to parse media JSON:", e);
        return null;
    }
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
    const model = "gemini-2.0-flash";
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
    mimeType: string
): Promise<SellDialogueState | null> {
    const prompt = `あなたはフリマアプリの出品アシスタントです。
ユーザーが売りたい商品の写真を送ってきました。
この画像を分析し、出品に必要な情報を抽出してください。

【出力形式 - JSONのみ】
{
  "image_summary": "画像の視覚的な説明（色、形、文字情報、メーカーロゴなど）",
  "extracted_info": {
    "category": "推定カテゴリ",
    "product_name": "推定商品名（型番含む）",
    "features": "特徴リスト"
  },
  "first_question": "ユーザーに尋ねるべき最初の質問（1つだけ、フレンドリーに）"
                  "例：『これはダイソンの掃除機ですね！型番はわかりますか？』"
                  "例：『きれいなバッグですね。ブランドはわかりますか？』"
}

【質問のコツ】
- まず「これは〇〇ですね！」と特定できたことを伝えて安心させる
- 次に、写真からはわからない最も重要な情報（型番、サイズ、ブランド、購入時期など）を聞く
- 質問は1つに絞る`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.0-flash";
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
            generationConfig: { response_mime_type: "application/json", temperature: 0.5 },
        }),
    });

    if (!response.ok) {
        console.error("analyzeProductImage failed:", response.status);
        return null;
    }

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "null";

    try {
        const parsed = JSON.parse(jsonText);
        return {
            image_summary: parsed.image_summary || "",
            extracted_info: parsed.extracted_info || {},
            next_question: parsed.first_question || "詳細を教えていただけますか？",
            is_sufficient: false
        };
    } catch (e) {
        console.error("Failed to parse analyzeProductImage JSON:", e);
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
    userReply: string
): Promise<SellDialogueState | null> {
    const prompt = `あなたはフリマアプリの出品アシスタントです。
これまでの情報と、ユーザーの最新の回答をもとに、出品情報を更新してください。

【現状の情報】
画像の特徴: ${imageSummary}
抽出済み情報: ${JSON.stringify(currentInfo)}
会話履歴: ${JSON.stringify(dialogueHistory.slice(-4))}

【ユーザーの回答】
"${userReply}"

【タスク】
1. ユーザーの回答から新しい情報（サイズ、状態、購入時期、型番など）を抽出し、extracted_infoを更新してください。
2. 出品文を作成するのに十分な情報が集まったか判定してください (is_sufficient)。
   - 必須: 商品名、カテゴリ、状態の大まかな把握
   - 十分なら true、まだ重要情報が欠けていれば false
3. falseの場合: 次に聞くべき質問 (next_question) を生成してください。
4. trueの場合: 出品文情報 (listing) を生成してください。

【出力形式 - JSONのみ】
{
  "extracted_info": { ...更新後の情報... },
  "is_sufficient": true | false,
  "next_question": "次の質問（is_sufficientがfalseの場合）",
  "listing": {
    "title": "出品タイトル (is_sufficientがtrueの場合)",
    "description": "商品説明文",
    "category": "カテゴリ",
    "condition": "状態"
  }
}

【質問のコツ】
- 前の回答を肯定する（例：「なるほど、3年使用ですね」）
- 質問は1つずつ、具体的に
- 「もう十分かな」と思ったら無理に聞かず出品文を作る`;

    const apiKey = Deno.env.get("GEMINI_API_KEY")!;
    const model = "gemini-2.0-flash";
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
        console.error("continueSellingDialogue failed:", response.status);
        return null;
    }

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "null";

    try {
        const parsed = JSON.parse(jsonText);
        return {
            image_summary: imageSummary,
            extracted_info: parsed.extracted_info || currentInfo,
            next_question: parsed.next_question || null,
            is_sufficient: parsed.is_sufficient || false,
            listing: parsed.listing
        };
    } catch (e) {
        console.error("Failed to parse continueSellingDialogue JSON:", e);
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
    return generateText(prompt, { model: "gemini-2.0-flash" });
}
