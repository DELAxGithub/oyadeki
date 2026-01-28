# Design Brief: "Oyadeki" (オヤデキ)
**Project**: AI-powered LINE Bot Assistant for Elderly Parents & Families
**Target Audience**: Seniors (60s+) and their Adult Children (30s-40s)
**Concept**: "Digital Peace of Mind" - Trustworthy, Warm, Premium, Easy to Read.

## 1. Design Concept & Guidelines
*   **Tone**: "Premium Reliability" meets "Warm Support". Avoid looking childish or too "medical/nursing". It should feel like a high-quality concierge service.
*   **Color Palette**:
    *   **Primary**: LINE Green (#06C755) for actions.
    *   **Brand**: Gold/Premium accents (inspired by "Zweigen Kanazawa" red/black/gold theme mentioned, but keep UI clean).
    *   **Warning**: Clear Red (#CC0000) for scam alerts.
    *   **Backgrounds**: Clean White or Off-White (#F5F5F5).
*   **Typography**: Large, high-contrast text for seniors. San-serif (Hiragino Sans / Noto Sans JP).
*   **Icons**: Simple, bold, easily recognizable symbols.

## 2. Deliverables List

### A. Rich Menu (LINE Bottom Menu)
*   **Layout**: 2 rows, 2 columns (4 buttons total).
*   **Items**:
    1.  **Top Left**: 📑 `契約台帳` (Contract Ledger) - Icon: Document/Binder.
    2.  **Top Right**: 📖 `見たもの` (Media Log) - Icon: Eye/Book/Movie.
    3.  **Bottom Left**: 💬 `相談履歴` (History) - Icon: Chat/Bubble.
    4.  **Bottom Right**: 📲 `シゴデキ` (Family App) - Icon: Link/App.
*   **Style**: Dark/Gold/Red premium theme or Clean/High-contrast.

### B. LIFF Web Screens (Mobile Web)
These are web pages opened inside LINE. Needs mobile-first, iOS-like design.

**1. Settings Page (`/settings`)**
*   **User**: Child (configuring for Parent).
*   **Elements**:
    *   **Values**: Theme (Text input), Metaphor Toggle (Switch), Tone (Select), NG Words (Tag input), Consent (Checkbox).
    *   **Action**: "Save Settings" (Large primary button).
*   **Style**: Clean settings list (like iOS Settings). Grouped sections with headers.

**2. Ledger Share View (`/share/[token]`)**
*   **User**: Child (viewing Parent's data via link).
*   **Elements**:
    *   **Header**: Total Monthly Cost (Large number), Contract Count.
    *   **Warning**: "Expiration Date" (color-coded).
    *   **List**: Cards for each contract (Service Name, Cost, ID, Note, Unconfirmed Badge).
    *   **Footer**: "Export CSV" button.

### C. Flex Message Layouts (Chat Bubbles)
These are the bot's responses in the chat.

**1. Vision Response (The "Help" Answer)** 🚨 *Critical*
*   **Context**: User sends a screenshot of a phone error.
*   **Layout**:
    *   **Header**: ⚠️ Warning Banner (Red background) IF dangerous.
    *   **Body**: 📱 Situation Explanation (Text).
    *   **Steps**: 1️⃣ 2️⃣ 3️⃣ Step-by-step instructions (Bold/Boxed).
    *   **Footer Actions**: "Got it!" (Primary), "Call Child" (Secondary), "Add to Ledger" (Link).

**2. Ledger List (Carousel)**
*   **Context**: User taps "Contract Ledger".
*   **Card**:
    *   **Header**: Category Icon & Name.
    *   **Body**: Service Name (Large Title), Monthly Cost (highlighted).
    *   **Footer**: "Confirm" button (Orange if unconfirmed, Gray if confirmed).
*   **Summary Card (First card)**: Total cost & count, "Share to Group" button.

**3. Media Log Confirmation (Bubble)**
*   **Context**: User sends a photo of a TV/Movie.
*   **layout**:
    *   **Header**: Media Type (Movie/TV/Book).
    *   **Body**: Title (Large), Artist/Director, Year.
    *   **Rating**: Large Interactive Stars (⭐) buttons (1-5).

**4. Listing Support (Product Info)**
*   **Context**: User sends a photo of an item to sell.
*   **Layout**:
    *   **Header**: 📦 "Listing Draft Ready".
    *   **Body**: Title, Description (Long text box for copying), Category tag, Condition tag.
    *   **Action**: "Copy Text" hint.

## 3. Technical Constraints
*   **LIFF**: HTML/CSS (Tailwind compatible preferred).
*   **Flex Messages**: Must follow LINE Flex Message JSON structure (Bubbles/Carousels). No custom JavaScript or forms inside chat bubbles.
