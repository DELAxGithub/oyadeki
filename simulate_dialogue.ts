import { config } from "https://deno.land/x/dotenv@v3.2.0/mod.ts";
// Load .env.local
const env = config({ path: "./.env.local", safe: true });
for (const key in env) {
    Deno.env.set(key, env[key]);
}

import { analyzeProductImage, identifyMedia, continueMediaDialogue, getPersonaInstruction, MediaInfo } from "./supabase/functions/_shared/gemini-client.ts";
import { UserContext } from "./supabase/functions/_shared/supabase-client.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.177.0/encoding/base64.ts";

async function main() {
    const args = Deno.args;
    if (args.length < 2) {
        console.log("Usage: deno run --allow-net --allow-read --allow-env simulate_dialogue.ts <mode> <image_path> [metaphor_theme]");
        console.log("Modes: media, sell");
        Deno.exit(1);
    }

    const mode = args[0];
    const imagePath = args[1];
    const theme = args[2] || "サッカー"; // Default theme

    // 1. Load Image
    console.log(`Loading image from ${imagePath}...`);
    let imageBytes: Uint8Array;
    try {
        imageBytes = await Deno.readFile(imagePath);
    } catch (e) {
        console.error("Failed to read image file:", e);
        Deno.exit(1);
    }
    const base64 = encodeBase64(imageBytes);
    const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

    // 2. Setup User Context
    const userContext: UserContext = {
        line_user_id: "test_user",
        metaphor_enabled: true,
        metaphor_theme: theme,
    };
    console.log(`\n--- Simulation Start (Mode: ${mode}, Theme: ${theme}) ---`);
    console.log(`Persona Instruction:\n${getPersonaInstruction(userContext)}\n--------------------------------------------------\n`);

    if (mode === "media") {
        console.log("Running identifyMedia...");
        const result = await identifyMedia(base64, mimeType, userContext);
        if (!result) {
            console.log("Failed to identify media.");
            return;
        }

        console.log("\n[AI]:", result.question);
        console.log("(Visual Clues:", result.visual_clues, ")");
        if (result.media_candidate) {
            console.log("(Internal Candidate:", result.media_candidate.title, ")");
        }

        // Simulate dialogue loop
        let currentResult = result;
        const history = [{ role: "assistant", text: currentResult.question }];

        // Interactive loop
        while (true) {
            const buf = new Uint8Array(1024);
            process.stdout.write("\n[You]: ");
            const n = <number>await Deno.stdin.read(buf);
            const input = new TextDecoder().decode(buf.subarray(0, n)).trim();

            if (input === "exit" || input === "quit") break;

            history.push({ role: "user", text: input });

            console.log("\n(Thinking...)");
            const nextResult = await continueMediaDialogue(
                currentResult.visual_clues,
                history,
                input,
                currentResult.media_candidate || null,
                userContext
            );

            if (!nextResult) {
                console.log("Error in dialogue.");
                break;
            }

            if ("identified" in nextResult && nextResult.identified) {
                const data = (nextResult as any).data as MediaInfo;
                console.log(`\n[AI]: 正解です！「${data.title}」ですね！`);
                console.log(`(Year: ${data.year}, Trivia: ${data.trivia})`);
                break;
            } else {
                const state = nextResult as any;
                console.log(`\n[AI]: ${state.question}`);
                currentResult = state;
                history.push({ role: "assistant", text: state.question });
            }
        }

    } else if (mode === "sell") {
        console.log("Running analyzeProductImage...");
        const result = await analyzeProductImage(base64, mimeType, userContext);
        if (!result) {
            console.log("Failed to analyze product.");
            return;
        }

        console.log("\n[AI]:", result.first_question);
        console.log("(Extracted:", JSON.stringify(result.extracted_info, null, 2), ")");
    }
}

main();
