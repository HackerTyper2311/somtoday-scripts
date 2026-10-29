(() => {
    "use strict";

    /*
     * ============================================================
     * SOMTODAY SCHOOL CHAT
     * Versie: 2.10.2
     * ============================================================
     */

    if (window.__SOMTODAY_SCHOOL_CHAT_RUNNING__) {
        console.log("[Somtoday Chat] Al actief.");
        return;
    }

    window.__SOMTODAY_SCHOOL_CHAT_RUNNING__ = true;

    // ============================================================
    // CONFIG
    // ============================================================

    const CONFIG = {

        version: "2.10.2",

        publishKey: "demo",
        subscribeKey: "demo",

        pubnubScript:
            "https://cdn.pubnub.com/sdk/javascript/pubnub.10.2.0.min.js",

        channelPrefix: "school",

        maxMessages: 1000,
        localCacheMessages: 1000,

        startupTimeout: 30000,
        syncOnOpen: true,

        debug: false,

        // Duplicaatcontrole
        duplicateWindowMs: 2 * 60 * 1000,

        // Cooldown tussen verzonden berichten
        sendCooldownMs: 5000,

        // Profanity-filter
        profanityEnabled: true,      // hoofdschakelaar
        profanityLocal: true,        // laag 1: lokaal filter
        profanityExternal: true,     // laag 2: profanity.dev
        profanityApi: "https://vector.profanity.dev",
        profanityTimeout: 3000,
        profanityFailClosed: false,  // true = blokkeren als externe check faalt

        // Spamfilter (alleen live ontvangen berichten van anderen)
        spamWindowMs: 10000,
        spamMaxPerWindow: 20,
        spamMaxSame: 10,
        spamMinuteWindowMs: 60 * 1000,
        spamMaxPerMinute: 50,

        // Extra filters
        maxMessageLength: 300,       // langere berichten worden verborgen
        blockLinks: true,            // links worden verborgen
        blockUnreadable: true        // berichten met onleesbare tekens worden verborgen
    };

    const STORAGE_PREFIX = "somtoday-school-chat";
    const VERSION_KEY = STORAGE_PREFIX + ":version";

    const HIDDEN_TEXT = "⚠️ Bericht verborgen (ongepast taalgebruik)";
    const HIDDEN_SPAM_TEXT = "⚠️ Bericht verborgen (spam)";
    const HIDDEN_LONG_TEXT = "⚠️ Bericht verborgen (te lang)";
    const HIDDEN_LINK_TEXT = "⚠️ Bericht verborgen (link)";
    const HIDDEN_CHARS_TEXT = "⚠️ Bericht verborgen (onleesbare tekens)";
    const HIDDEN_ART_TEXT = "⚠️ Bericht verborgen (tekening)";

    // ============================================================
    // STATE
    // ============================================================

    let currentUser = null;
    let channel = null;
    let chatTab = null;
    let chatPanel = null;
    let messagesContainer = null;
    let messageInput = null;
    let sendButton = null;
    let statusElement = null;
    let chatOpen = false;
    let observer = null;
    let pubnubConnected = false;
    let syncRunning = false;
    let sending = false;
    let lastSentAt = 0;

    /*
     * message.id -> { id, userId, name, text (origineel), timestamp, notice }
     * notice = null of de melding die in plaats van de tekst wordt getoond.
     */
    const messageMap = new Map();

    /*
     * Dubbele-tekst-index: afzender + tekst -> { id, time }
     */
    const seenTexts = new Map();

    /*
     * Spam-index voor live berichten van anderen: userId -> [{ text, time }]
     */
    const recentByUser = new Map();

    /*
     * Cache met externe resultaten per tekst.
     */
    const externalCache = new Map();
    const EXTERNAL_CACHE_LIMIT = 500;

    // ============================================================
    // LOGGING
    // ============================================================

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Somtoday Chat]", ...args);
        }
    }

    function warn(...args) {
        console.warn("[Somtoday Chat]", ...args);
    }

    function error(...args) {
        console.error("[Somtoday Chat]", ...args);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function clean(value) {
        if (value === null || value === undefined) {
            return "";
        }
        return String(value).trim();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function sortByTime(list) {
        return list.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    }

    function isOwnMessage(message) {
        return Boolean(currentUser) &&
            String(message.userId) === String(currentUser.id);
    }

    // ============================================================
    // VERSIE: OUDE DATA WISSEN
    // ============================================================

    function purgeOldData() {

        try {

            const stored = localStorage.getItem(VERSION_KEY);

            if (stored === CONFIG.version) {
                return;
            }

            const keysToRemove = [];

            for (let i = 0; i < localStorage.length; i++) {

                const key = localStorage.key(i);

                if (key && key.startsWith(STORAGE_PREFIX)) {
                    keysToRemove.push(key);
                }
            }

            for (const key of keysToRemove) {
                localStorage.removeItem(key);
            }

            localStorage.setItem(VERSION_KEY, CONFIG.version);

            log(
                "Oude chatdata gewist.",
                "Versie:", stored || "geen", "->", CONFIG.version,
                "(" + keysToRemove.length + " sleutels)"
            );

        } catch (err) {
            warn("Oude chatdata wissen mislukt:", err);
        }
    }

    // ============================================================
    // PROFANITY: TEKST ANALYSE (LAAG 1, LOKAAL)
    // ============================================================
    //
    // Werkwijze:
    // 1. NFKD haalt stijlletters terug naar gewone letters (𝒹 -> d, ℊ -> g,
    //    fullwidth, ligaturen, cirkel- en vetletters).
    // 2. Accenten en onzichtbare tekens worden verwijderd.
    // 3. Regionale-indicatorletters (🇫🇦) worden letters.
    // 4. Leetspeak-cijfers en symbolen worden letters.
    // 5. Tekeningen met veel speciale symbolen worden in zijn geheel verborgen.
    // 6. Alles wat geen a-z is en niet als scheiding of emoji telt, maakt het
    //    bericht "onleesbaar".
    // ============================================================

    function squashRepeats(text) {
        return text.replace(/(.)\1+/g, "$1");
    }

    // Leetspeak: symbolen en cijfers die als letter worden gebruikt
    const LEET = {
        "@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "|": "i",
        "0": "o", "5": "s", "$": "s", "7": "t", "8": "b", "9": "g",
        "2": "z", "+": "t", "(": "c", "<": "c", "#": "h"
    };

    // Letterachtige tekens die NFKD NIET omzet naar een letter
    const LETTERLIKE = {
        "\u2134": "o",   // ℴ script small o
        "\u2113": "l",   // ℓ script small l
        "\u212E": "e",   // ℮ estimated symbol
        "\u2107": "e",   // ℇ euler constant
        "\u2102": "c",   // ℂ double-struck C
        "\u2118": "p",   // ℘ weierstrass p
        "\u210E": "h"    // ℎ planck h
    };

    // Veilige niet-letter tekens: typografische leestekens, valuta, emoji
    const SAFE_SYMBOLS =
        /[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u20AC]|[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;

    /*
     * Herkent alleen tekeningen: berichten waarin speciale symbolen
     * (!@#$%^&* enz.) de overhand hebben. Gewone leestekens, komma's,
     * punten, emoticons en meerdere regels tellen niet mee.
     */
    function isArtLike(text) {

        const raw = String(text ?? "");

        const chars = Array.from(raw).filter(c => !/\s/.test(c));

        if (chars.length < 12) {
            return false;
        }

        const symbols = chars.filter(c =>
            /[!@#$%^&*_|\\\/<>~`{}\[\]=+]/.test(c)
        ).length;

        return symbols / chars.length > 0.5;
    }

    /*
     * Zet tekst om naar woorden van a-z.
     * unknown = true als de tekst een letter of symbool bevat dat niet te
     * lezen is (bijv. ƀ, ŧ, ₴, ß, Cyrillisch, Grieks).
     */
    function analyzeText(text) {

        const base = clean(text)
            .normalize("NFKD")
            .toLowerCase()
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")      // accenten en combinerende tekens
            .replace(/\p{Cf}/gu, "");    // onzichtbare tekens

        let folded = "";
        let unknown = false;

        for (const ch of base) {

            const cp = ch.codePointAt(0);

            if (ch >= "a" && ch <= "z") {
                folded += ch;
            } else if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
                // Regionale-indicatorletters (🇫🇦🇬🇬🇴🇹) spellen gewone letters
                folded += String.fromCharCode(97 + cp - 0x1F1E6);
            } else if (LEET[ch] !== undefined) {
                folded += LEET[ch];
            } else if (LETTERLIKE[ch] !== undefined) {
                folded += LETTERLIKE[ch];
            } else if (ch <= "\x7f" || /\s/u.test(ch) || SAFE_SYMBOLS.test(ch)) {
                folded += " ";
            } else {
                unknown = true;
                folded += " ";
            }
        }

        return {
            tokens: folded.split(" ").filter(Boolean),
            unknown
        };
    }

    // Exacte woorden (korte woorden horen hier, niet in de substring-lijst)
    const PROFANITY_EXACT = new Set([

        // Nederlands
        "kut", "lul", "hoer", "fok", "fuk", "shi", "gvd", "kkr",
        "piemel", "pimel", "dick", "dik", "dih", "cuck", "cock", "fag", "vagina",

        // Engels
        "fck", "fk", "fuck", "shit", "bitch", "suck",

        // Seksueel getinte termen
        "goon", "gooner", "gooning", "gogoon", "gogooning", "sperma", "sperm",

        // Racistische termen
        "neger", "nigga", "niga", "nigger", "nagger", "ngger", "ngr", "negr"

    ].map(squashRepeats));

    // Substring-matches: alleen lange, herkenbare termen
    const PROFANITY_CONTAINS = [

        // Nederlands
        "klootzak", "kanker", "godverdomme", "godver",
        "scheiss", "scheisse", "schiesse", "sheisse",
        "schijt", "flikker", "mongool", "balzak", "piemel", "pimel", "neger",

        // Engels
        "fuck", "bastard", "faggot", "fagot", "cocksuck",

        // Seksueel getinte termen (hun gecomprimeerde vorm)
        "gooning", "gogoon",

        // Racistische termen
        "nigger", "nigga", "niga", "ngga", "nagger"

    ].map(squashRepeats);

    /*
     * Controleert woorden op scheldwoorden, ook als ze zijn opgeknipt
     * ("k u t", "f-u-c-k", "k.u.t") of aan elkaar zijn geplakt.
     */
    function profanityIn(tokens) {

        if (!tokens.length) {
            return false;
        }

        // 1. Losse woorden
        if (tokens.some(t => PROFANITY_EXACT.has(squashRepeats(t)))) {
            return true;
        }

        // 2. Opgeknipte woorden: 2 tot 5 opeenvolgende fragmenten van max. 3 letters
        for (let i = 0; i < tokens.length; i++) {

            let joined = "";
            let count = 0;

            for (let j = i; j < tokens.length && j < i + 5; j++) {

                if (tokens[j].length > 3) {
                    break;
                }

                joined += tokens[j];
                count++;

                if (joined.length > 14) {
                    break;
                }

                if (count >= 2 && PROFANITY_EXACT.has(squashRepeats(joined))) {
                    return true;
                }
            }
        }

        // 3. Alles aan elkaar, ook over woordgrenzen heen
        const compact = squashRepeats(tokens.join(""));

        return PROFANITY_CONTAINS.some(term => compact.includes(term));
    }

    function containsProfanityLocal(text) {
        return profanityIn(analyzeText(text).tokens);
    }

    // ============================================================
    // LINKS
    // ============================================================

    // Domeinen zonder spaties, bijv. "youtube.com", "bit.ly", "t.me"
    const LINK_PATTERN =
        /(https?:\/\/|www\.|[a-z0-9-]+\.(com|nl|net|org|io|xyz|gg|tv|me|be|co|app|site|ly|gl|ru|cc|info|biz|online)\b)/i;

    // Platformnamen die als link worden gebruikt, ook zonder punt
    const PLATFORMS = new Set([
        "youtube", "youtu", "discord", "twitch", "instagram", "tiktok",
        "snapchat", "telegram", "whatsapp", "facebook", "reddit",
        "twitter", "onlyfans", "kick"
    ]);

    // Topleveldomeinen die los als "com" of "nl" worden getypt
    const TLDS = new Set([
        "com", "nl", "net", "org", "io", "xyz", "gg", "tv", "me",
        "be", "co", "app", "site", "ly"
    ]);

    /*
     * True als de tekst een link is of erop lijkt:
     * - een domein met punt ("youtube.com")
     * - een platformnaam met een tld, slash of @ ("youtube com", "youtube / @naam")
     */
    function containsLink(text) {

        if (!CONFIG.blockLinks) {
            return false;
        }

        const raw = clean(text);

        if (LINK_PATTERN.test(raw)) {
            return true;
        }

        const { tokens } = analyzeText(raw);

        if (!tokens.some(t => PLATFORMS.has(t))) {
            return false;
        }

        const hasTld = tokens.some(t => TLDS.has(t));
        const hasLinkSymbol = /[\/@.]/.test(raw);

        return hasTld || hasLinkSymbol;
    }

    // ============================================================
    // MODERATIE: LOKALE MELDING
    // ============================================================

    /*
     * Geeft de melding terug als het bericht lokaal verborgen moet worden,
     * anders null. Volgorde: lengte, tekening, scheldwoorden, links, tekens.
     */
    function lexicalNotice(text) {

        const raw = String(text ?? "").trim();

        if (!raw) {
            return null;
        }

        if (raw.length > CONFIG.maxMessageLength) {
            return HIDDEN_LONG_TEXT;
        }

        if (isArtLike(raw)) {
            return HIDDEN_ART_TEXT;
        }

        const { tokens, unknown } = analyzeText(raw);

        if (CONFIG.profanityLocal && profanityIn(tokens)) {
            return HIDDEN_TEXT;
        }

        if (containsLink(raw)) {
            return HIDDEN_LINK_TEXT;
        }

        if (CONFIG.blockUnreadable && unknown) {
            return HIDDEN_CHARS_TEXT;
        }

        return null;
    }

    // ============================================================
    // SPAMFILTER (LIVE BERICHTEN VAN ANDEREN)
    // ============================================================

    function isSpam(message) {

        const text = clean(message.text);
        const userId = clean(message.userId);
        const now = Number(message.timestamp) || Date.now();

        if (!text || !userId) {
            return false;
        }

        // Alleen leestekens, zonder letters, cijfers of emoji
        if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)) {
            return true;
        }

        const lower = text.toLowerCase();

        const history = (recentByUser.get(userId) || [])
            .filter(entry => Math.abs(now - entry.time) < CONFIG.spamMinuteWindowMs);

        history.push({ text: lower, time: now });
        recentByUser.set(userId, history);

        const short = history.filter(
            entry => Math.abs(now - entry.time) < CONFIG.spamWindowMs
        );

        if (short.length > CONFIG.spamMaxPerWindow) {
            return true;
        }

        if (short.filter(entry => entry.text === lower).length >= CONFIG.spamMaxSame) {
            return true;
        }

        return history.length > CONFIG.spamMaxPerMinute;
    }

    // ============================================================
    // DUPLICAATCONTROLE (2 MINUTEN)
    // ============================================================

    function duplicateKey(userId, text) {

        return clean(userId) + "|" +
            clean(text).toLowerCase().replace(/\s+/g, " ");
    }

    function pruneSeenTexts(now) {

        for (const [key, entry] of seenTexts) {

            if (now - entry.time > CONFIG.duplicateWindowMs) {
                seenTexts.delete(key);
            }
        }
    }

    /*
     * True als dezelfde afzender binnen het venster al dezelfde tekst
     * heeft gestuurd, met een ander bericht-id.
     */
    function isRecentDuplicate(userId, text, time, id) {

        const entry = seenTexts.get(duplicateKey(userId, text));

        if (!entry) {
            return false;
        }

        return entry.id !== id &&
            Math.abs(Number(time) - entry.time) < CONFIG.duplicateWindowMs;
    }

    function rememberText(message) {

        seenTexts.set(
            duplicateKey(message.userId, message.text),
            {
                id: message.id,
                time: Number(message.timestamp)
            }
        );
    }

    // ============================================================
    // PROFANITY: LAAG 2 (EXTERN)
    // ============================================================

    /*
     * Geeft true, false of null terug.
     * null = de check is mislukt.
     */
    async function checkExternal(text) {

        const value = clean(text);

        if (!value) {
            return false;
        }

        if (externalCache.has(value)) {
            return externalCache.get(value);
        }

        let timer = null;

        try {

            const controller = new AbortController();

            timer = setTimeout(
                () => controller.abort(),
                CONFIG.profanityTimeout
            );

            const response = await fetch(
                CONFIG.profanityApi,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        message: value
                    }),
                    signal: controller.signal
                }
            );

            clearTimeout(timer);

            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            const data = await response.json();

            if (typeof data.isProfanity !== "boolean") {
                throw new Error("Onverwacht antwoordformaat");
            }

            if (externalCache.size >= EXTERNAL_CACHE_LIMIT) {
                externalCache.clear();
            }

            externalCache.set(value, data.isProfanity);

            return data.isProfanity;

        } catch (err) {

            if (timer) {
                clearTimeout(timer);
            }

            warn("Externe profanity-check mislukt:", err);

            return null;
        }
    }

    /*
     * True als de externe dienst het bericht afkeurt. Bij een storing
     * bepaalt profanityFailClosed of het bericht wordt geblokkeerd.
     */
    async function externalBlocks(text) {

        if (!CONFIG.profanityExternal) {
            return false;
        }

        const result = await checkExternal(text);

        if (result === null) {
            return CONFIG.profanityFailClosed;
        }

        return result;
    }

    // ============================================================
    // BERICHT VOORBEREIDEN (ONTVANGEN / CACHE / HISTORIE)
    // ============================================================

    function normalizeMessage(input) {

        if (!input || typeof input !== "object") {
            return null;
        }

        const normalized = {
            id: clean(input.id),
            userId: clean(input.userId),
            name: clean(input.name || "Leerling"),
            text: clean(input.text),
            timestamp: Number(input.timestamp || Date.now())
        };

        if (!normalized.id || !normalized.text) {
            return null;
        }

        return normalized;
    }

    /*
     * mode:
     *   "live"    -> nieuw bericht via PubNub: alle filters, incl. spam
     *   "history" -> historie van PubNub: alle lokale filters, geen spam
     *   "cache"   -> lokale cache: lokale filters, stored melding behouden
     */
    function prepareIncoming(input, mode) {

        const msg = normalizeMessage(input);

        if (!msg) {
            return null;
        }

        if (!CONFIG.profanityEnabled) {
            return { ...msg, notice: null };
        }

        let notice = lexicalNotice(msg.text);

        if (!notice && mode === "cache") {
            notice = input.notice || null;
        }

        if (!notice && mode === "live" && !isOwnMessage(msg) && isSpam(msg)) {
            notice = HIDDEN_SPAM_TEXT;
        }

        return { ...msg, notice };
    }

    // ============================================================
    // SHA256
    // ============================================================

    async function sha256(text) {

        const data = new TextEncoder().encode(String(text));

        const hashBuffer = await crypto.subtle.digest("SHA-256", data);

        return Array.from(new Uint8Array(hashBuffer))
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    // ============================================================
    // LOCAL CACHE
    // ============================================================

    function getCacheKey() {

        if (!channel) {
            return null;
        }

        return STORAGE_PREFIX + ":v" + CONFIG.version + ":" + String(channel);
    }

    function saveLocalCache() {

        const key = getCacheKey();

        if (!key) {
            return;
        }

        try {

            const messages = sortByTime(Array.from(messageMap.values()))
                .slice(-CONFIG.localCacheMessages);

            localStorage.setItem(key, JSON.stringify(messages));

        } catch (err) {
            warn("Lokale chat-cache opslaan mislukt:", err);
        }
    }

    function loadLocalCache() {

        const key = getCacheKey();

        if (!key) {
            return;
        }

        try {

            const raw = localStorage.getItem(key);

            if (!raw) {
                return;
            }

            const messages = JSON.parse(raw);

            if (!Array.isArray(messages)) {
                return;
            }

            for (const message of sortByTime([...messages])) {
                const prepared = prepareIncoming(message, "cache");
                if (prepared) {
                    addMessage(prepared, false);
                }
            }

            log("Lokale cache geladen:", messages.length, "berichten");

        } catch (err) {
            warn("Lokale chat-cache lezen mislukt:", err);
        }
    }

    // ============================================================
    // SOMTODAY AUTH
    // ============================================================

    function getAuthRecord() {

        const keys = [
            "CapacitorStorage.SL_AUTH_CONFIG_RECORDS",
            "SL_AUTH_CONFIG_RECORDS"
        ];

        for (const key of keys) {

            try {

                const raw = localStorage.getItem(key);

                if (!raw) {
                    continue;
                }

                const parsed = JSON.parse(raw);

                if (parsed && typeof parsed === "object") {
                    return parsed;
                }

            } catch (err) {
                warn("Auth lezen mislukt:", key, err);
            }
        }

        for (let i = 0; i < localStorage.length; i++) {

            const key = localStorage.key(i);

            if (!key || !key.toLowerCase().includes("auth")) {
                continue;
            }

            try {

                const raw = localStorage.getItem(key);

                if (!raw) {
                    continue;
                }

                const parsed = JSON.parse(raw);

                if (parsed?.currentLeerling || parsed?.allAuthenticationRecords) {
                    log("Auth gevonden via:", key);
                    return parsed;
                }

            } catch {
                // Geen JSON.
            }
        }

        return null;
    }

    function extractUser(auth) {

        const currentLeerling = auth?.currentLeerling || null;

        const fallbackLeerling =
            auth?.allAuthenticationRecords?.[0]?.subLeerlingen?.[0] || null;

        const leerling = currentLeerling || fallbackLeerling || {};

        const record = auth?.allAuthenticationRecords?.[0] || {};

        const vestiging = clean(
            currentLeerling?.vestiging ??
            fallbackLeerling?.vestiging ??
            ""
        );

        const id = clean(leerling?.id);

        const name = clean(
            record?.voornaam ||
            leerling?.voornaam ||
            leerling?.naam ||
            leerling?.displayName ||
            "Leerling"
        );

        return {
            id: String(id),
            name: String(name),
            vestiging: String(vestiging),
            locationName: String(vestiging)
        };
    }

    async function findSomtodayUser() {

        const start = Date.now();

        while (Date.now() - start < CONFIG.startupTimeout) {

            const auth = getAuthRecord();

            if (auth) {

                const user = extractUser(auth);

                if (user.id && user.vestiging) {
                    log("Gebruiker gevonden:", user);
                    return user;
                }
            }

            await sleep(500);
        }

        throw new Error("Geen geldige Somtoday leerlinggegevens gevonden.");
    }

    // ============================================================
    // PREPARE CHANNEL
    // ============================================================

    async function prepareChannel() {

        const vestiging = clean(currentUser?.vestiging);

        if (!vestiging) {
            throw new Error("Geen vestiging gevonden.");
        }

        const schoolHash = await sha256(vestiging);

        channel =
            `${String(CONFIG.channelPrefix)}.` +
            `${schoolHash.slice(0, 24)}.` +
            `general`;

        log("School:", vestiging);
        log("Channel:", channel);
    }

    // ============================================================
    // PUBNUB PAGE CONTEXT BRIDGE
    // ============================================================

    function installPubNubBridge() {

        if (document.querySelector('script[data-somtoday-pubnub-bridge="true"]')) {
            return;
        }

        const bridgeCode = `
            (() => {

                "use strict";

                if (window.__SOMTODAY_PUBNUB_PAGE_BRIDGE__) {
                    return;
                }

                window.__SOMTODAY_PUBNUB_PAGE_BRIDGE__ = true;

                let pubnub = null;
                let currentChannel = null;
                let loadingPromise = null;

                const SDK_URL = ${JSON.stringify(String(CONFIG.pubnubScript))};

                function post(type, data) {

                    window.postMessage({
                        source: "SOMTODAY_PUBNUB_BRIDGE",
                        type: type,
                        data: data || null
                    }, "*");
                }

                function loadSDK() {

                    if (window.PubNub) {
                        return Promise.resolve(window.PubNub);
                    }

                    if (loadingPromise) {
                        return loadingPromise;
                    }

                    loadingPromise = new Promise((resolve, reject) => {

                        const existing = document.querySelector(
                            'script[data-somtoday-pubnub-sdk="true"]'
                        );

                        if (existing) {

                            existing.addEventListener("load", () => {

                                if (window.PubNub) {
                                    resolve(window.PubNub);
                                } else {
                                    reject(new Error(
                                        "PubNub SDK geladen maar niet beschikbaar."
                                    ));
                                }
                            });

                            existing.addEventListener("error", () => {
                                reject(new Error(
                                    "PubNub SDK kon niet worden geladen."
                                ));
                            });

                            return;
                        }

                        const script = document.createElement("script");

                        script.src = SDK_URL;
                        script.async = true;
                        script.dataset.somtodayPubnubSdk = "true";

                        script.onload = () => {

                            setTimeout(() => {

                                if (window.PubNub) {
                                    resolve(window.PubNub);
                                } else {
                                    reject(new Error(
                                        "PubNub SDK geladen maar niet beschikbaar."
                                    ));
                                }

                            }, 100);
                        };

                        script.onerror = () => {
                            reject(new Error(
                                "PubNub SDK kon niet worden geladen."
                            ));
                        };

                        (document.head || document.documentElement)
                            .appendChild(script);
                    });

                    return loadingPromise;
                }

                async function connect(data) {

                    try {

                        const PubNub = await loadSDK();

                        currentChannel = String(data.channel);

                        pubnub = new PubNub({
                            publishKey: String(data.publishKey),
                            subscribeKey: String(data.subscribeKey),
                            userId: String(data.userId)
                        });

                        pubnub.addListener({

                            status(event) {
                                post("STATUS", {
                                    category: String(event.category || "")
                                });
                            },

                            message(event) {

                                if (!event || !event.message) {
                                    return;
                                }

                                post("MESSAGE", event.message);
                            }
                        });

                        pubnub.subscribe({
                            channels: [String(currentChannel)]
                        });

                        post("CONNECTED", {
                            channel: currentChannel
                        });

                    } catch (err) {

                        post("ERROR", {
                            message: String(err?.message || err)
                        });
                    }
                }

                async function fetchHistory(data) {

                    try {

                        if (!pubnub) {
                            throw new Error("PubNub is nog niet verbonden.");
                        }

                        const targetChannel = String(
                            data.channel || currentChannel
                        );

                        const count = Math.max(1, Math.min(
                            100,
                            Number(data.count || 100)
                        ));

                        const result = await pubnub.fetchMessages({
                            channels: [targetChannel],
                            count: count
                        });

                        let messages = [];

                        const channelData =
                            result?.channels?.[targetChannel];

                        if (Array.isArray(channelData)) {

                            messages = channelData.map(item => {

                                if (
                                    item &&
                                    typeof item === "object" &&
                                    "message" in item
                                ) {
                                    return item.message;
                                }

                                return item;
                            });
                        }

                        post("HISTORY", {
                            channel: targetChannel,
                            messages: messages
                        });

                    } catch (err) {

                        post("HISTORY_ERROR", {
                            message: String(err?.message || err)
                        });
                    }
                }

                async function publish(data) {

                    try {

                        if (!pubnub) {
                            throw new Error("PubNub is nog niet verbonden.");
                        }

                        await pubnub.publish({
                            channel: String(data.channel),
                            message: data.message
                        });

                        post("PUBLISHED");

                    } catch (err) {

                        post("ERROR", {
                            message: String(err?.message || err)
                        });
                    }
                }

                window.addEventListener("message", event => {

                    if (event.source !== window) {
                        return;
                    }

                    const data = event.data;

                    if (
                        !data ||
                        data.source !== "SOMTODAY_PUBNUB_USERSCRIPT"
                    ) {
                        return;
                    }

                    if (data.type === "CONNECT") {
                        connect(data.data || {});
                    }

                    if (data.type === "FETCH_HISTORY") {
                        fetchHistory(data.data || {});
                    }

                    if (data.type === "PUBLISH") {
                        publish(data.data || {});
                    }
                });

                post("BRIDGE_READY");

            })();
        `;

        const script = document.createElement("script");

        script.dataset.somtodayPubnubBridge = "true";
        script.textContent = bridgeCode;

        (document.documentElement || document.head || document.body)
            .appendChild(script);

        script.remove();

        log("PubNub page-context bridge geïnstalleerd.");
    }

    // ============================================================
    // PUBNUB MESSAGE LISTENER
    // ============================================================

    function setupPubNubMessageListener() {

        window.addEventListener("message", event => {

            if (event.source !== window) {
                return;
            }

            const data = event.data;

            if (!data || data.source !== "SOMTODAY_PUBNUB_BRIDGE") {
                return;
            }

            switch (data.type) {

                case "BRIDGE_READY":
                    connectPubNub();
                    break;

                case "CONNECTED":

                    pubnubConnected = true;

                    setStatus("Verbonden");

                    loadLocalCache();
                    syncHistory();
                    break;

                case "MESSAGE":
                    handleIncomingMessage(data.data);
                    break;

                case "HISTORY":
                    handleHistory(data.data);
                    break;

                case "HISTORY_ERROR":
                    handleHistoryError(data.data);
                    break;

                case "STATUS":
                    handlePubNubStatus(data.data);
                    break;

                case "ERROR":
                    error("PubNub:", data.data);
                    setStatus("Chat offline");
                    break;
            }
        });
    }

    // ============================================================
    // CONNECT / SYNC
    // ============================================================

    function connectPubNub() {

        if (!currentUser || !channel) {
            return;
        }

        window.postMessage({
            source: "SOMTODAY_PUBNUB_USERSCRIPT",
            type: "CONNECT",
            data: {
                publishKey: String(CONFIG.publishKey),
                subscribeKey: String(CONFIG.subscribeKey),
                userId: String(currentUser.id),
                channel: String(channel)
            }
        }, "*");
    }

    function syncHistory() {

        if (syncRunning || !pubnubConnected || !channel) {
            return;
        }

        syncRunning = true;

        setStatus("Synchroniseren...");

        log("PubNub history synchroniseren...");

        window.postMessage({
            source: "SOMTODAY_PUBNUB_USERSCRIPT",
            type: "FETCH_HISTORY",
            data: {
                channel: String(channel),
                count: CONFIG.maxMessages
            }
        }, "*");
    }

    function handleHistory(data) {

        syncRunning = false;

        const messages = Array.isArray(data?.messages)
            ? data.messages
            : [];

        log("PubNub history ontvangen:", messages.length, "berichten");

        const added = [];

        for (const raw of sortByTime([...messages])) {

            const prepared = prepareIncoming(raw, "history");

            if (prepared && addMessage(prepared, false)) {
                added.push(prepared);
            }
        }

        saveLocalCache();
        renderAllMessages();
        setStatus("Verbonden");

        for (const message of added) {
            scheduleExternalCheck(message);
        }
    }

    function handleHistoryError(data) {

        syncRunning = false;

        warn("History synchroniseren mislukt:", clean(data?.message));

        setStatus("Verbonden");
    }

    function handlePubNubStatus(data) {

        const category = clean(data?.category);

        if (category === "PNConnectedCategory") {

            pubnubConnected = true;
            setStatus("Verbonden");

        } else if (category === "PNNetworkDownCategory") {

            pubnubConnected = false;
            setStatus("Offline");

        } else if (category === "PNNetworkUpCategory")
