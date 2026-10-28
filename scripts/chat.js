(() => {
    "use strict";

    /*
     * ============================================================
     * SOMTODAY SCHOOL CHAT
     * Versie: 2.6.0
     * ============================================================
     *
     * - Somtoday-style Chat tab
     * - Chat opent niet automatisch
     * - Native Somtoday-tabs sluiten Chat
     * - PubNub realtime messaging + History
     * - LocalStorage cache (versioned, oude data wordt gewist)
     * - Laag 1: lokaal filter (Unicode-normalisatie, lookalikes)
     * - Laag 1b: lengte, links, onleesbare tekens, spam (lokaal)
     * - Duplicaatcontrole: 2 minuten, bij verzenden en ontvangen
     * - Laag 2: profanity.dev (extern, altijd actief)
     *
     * PubNub Message Persistence moet aan staan voor
     * cross-device history.
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

        version: "2.6.0",

        publishKey: "demo",
        subscribeKey: "demo",

        pubnubScript:
            "https://cdn.pubnub.com/sdk/javascript/pubnub.10.2.0.min.js",

        channelPrefix: "school",

        maxMessages: 100,
        localCacheMessages: 100,

        startupTimeout: 30000,
        syncOnOpen: true,

        debug: true,

        // Duplicaatcontrole
        duplicateWindowMs: 2 * 60 * 1000,

        // Profanity-filter
        profanityEnabled: true,      // hoofdschakelaar
        profanityLocal: true,        // laag 1: lokaal filter
        profanityExternal: true,     // laag 2: profanity.dev
        profanityApi: "https://vector.profanity.dev",
        profanityTimeout: 3000,
        profanityFailClosed: false,  // true = blokkeren als externe check faalt

        // Spamfilter
        spamWindowMs: 10000,
        spamMaxPerWindow: 6,
        spamMaxSame: 3,

        // Extra filters
        maxMessageLength: 300,       // langere berichten worden verborgen
        blockLinks: true,            // links worden verborgen
        blockForeignScripts: true    // berichten met vooral niet-Latijnse letters
    };

    const STORAGE_PREFIX = "somtoday-school-chat";
    const VERSION_KEY = STORAGE_PREFIX + ":version";

    const HIDDEN_TEXT = "⚠️ Bericht verborgen (ongepast taalgebruik)";
    const HIDDEN_SPAM_TEXT = "⚠️ Bericht verborgen (spam)";
    const HIDDEN_LONG_TEXT = "⚠️ Bericht verborgen (te lang)";
    const HIDDEN_LINK_TEXT = "⚠️ Bericht verborgen (link)";
    const HIDDEN_CHARS_TEXT = "⚠️ Bericht verborgen (onleesbare tekens)";

    function isHiddenText(text) {
        return String(text || "").startsWith("⚠️ Bericht verborgen");
    }

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
    let historyLoaded = false;
    let syncRunning = false;

    /*
     * message.id -> message
     */
    const messageMap = new Map();

    /*
     * Dubbele-tekst-index: afzender + tekst -> { id, time }
     */
    const seenTexts = new Map();

    /*
     * Spam-index: userId -> [{ text, time }]
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
    // PROFANITY: LAAG 1 (LOKAAL)
    // ============================================================

    function squashRepeats(text) {
        return text.replace(/(.)\1+/g, "$1");
    }

    /*
     * Lookalike-tekens die na normalisatie naar kleine letters
     * worden omgezet. Alle sleutels moeten kleine letters zijn.
     */
    const CONFUSABLES = {

        // Cyrillisch
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
        "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
        "к": "k", "н": "h", "т": "t", "м": "m", "в": "b",
        "ԁ": "d", "ԛ": "q", "ԝ": "w", "п": "n", "ц": "u",

        // Overig Latijns
        "ą": "a", "ƒ": "f", "մ": "u", "ç": "c", "ʂ": "s",
        "ҟ": "k", "ɑ": "a", "ı": "i", "ɩ": "i", "ƭ": "t",
        "ɱ": "m", "ø": "o", "ɏ": "y", "ʉ": "u", "ł": "l",
        "ⱨ": "h",

        // Valutasymbolen en andere tekens die op letters lijken
        "฿": "b", "₮": "t", "₵": "c", "₴": "s", "₭": "k",
        "₥": "m", "₣": "f", "₳": "a",

        // Grieks
        "λ": "a", "σ": "e", "δ": "d", "π": "n",

        // Canadees Syllabisch
        "ᔕ": "s", "ᑌ": "u", "ᑕ": "c", "ᗰ": "m", "ᗩ": "a",
        "ᗴ": "e", "ᗝ": "o", "ᑭ": "p", "ᖇ": "r", "ᒪ": "l",
        "ᐯ": "v", "ᖴ": "f", "ᕼ": "h", "ᑎ": "n", "ᗷ": "b",
        "ᔓ": "s", "ᒍ": "j", "ᘿ": "g"
    };

    /*
     * Zet een tekst om naar kleine letters a-z.
     * Scheidingstekens worden spaties, zodat "f.u.c.k" en
     * "f-u-c-k" hetzelfde worden als "fuck".
     */
    function foldText(text) {

        let folded = clean(text)
            .normalize("NFKC")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[\u00ad\u200b-\u200f\u2060-\u206f\ufeff]/g, "")
            .replace(/ß/g, "ss");

        folded = Array.from(folded)
            .map(ch => CONFUSABLES[ch] || ch)
            .join("");

        return folded
            .replace(/@/g, "a")
            .replace(/4/g, "a")
            .replace(/3/g, "e")
            .replace(/[1!|]/g, "i")
            .replace(/0/g, "o")
            .replace(/[5$]/g, "s")
            .replace(/7/g, "t")
            .replace(/[^a-z]+/g, " ")
            .trim();
    }

    const PROFANITY_EXACT = new Set([

        // Nederlands
        "kut", "lul", "hoer", "fok", "fuk", "shi", "gvd", "kkr",
        "piemel", "dick", "dik", "dih", "cuck", "cock", "fag",

        // Engels
        "fck", "fk", "fuck", "shit", "bitch", "suck",

        // Racistische termen en fragmenten
        "neger", "nigga", "niga", "nigger", "nagger",
        "nija", "ninja", "ngger", "ngr", "negr"

    ].map(squashRepeats));

    const PROFANITY_CONTAINS = [

        // Nederlands
        "klootzak", "kanker", "godverdomme", "godver",
        "scheiss", "scheisse", "schiesse", "sheisse",
        "schijt", "flikker", "mongool", "balzak", "piemel",
        "neger", "negr",

        // Engels
        "fuck", "bastard", "faggot", "fagot", "cocksuck",

        // Racistische termen
        "nigger", "nigga", "niga", "ngga", "nagger"
    ];

    function containsProfanityLocal(text) {

        const folded = foldText(text);

        if (!folded) {
            return false;
        }

        const words = folded
            .split(" ")
            .filter(Boolean);

        if (words.some(word => PROFANITY_EXACT.has(squashRepeats(word)))) {
            return true;
        }

        const compactRaw = words.join("");
        const compactSquashed = squashRepeats(compactRaw);

        return PROFANITY_CONTAINS.some(
            term =>
                compactRaw.includes(term) ||
                compactSquashed.includes(term)
        );
    }

    // ============================================================
    // EXTRA FILTERS (LOKAAL)
    // ============================================================

    const LINK_PATTERN =
        /(https?:\/\/|www\.|[a-z0-9-]+\.(com|nl|net|org|io|xyz|gg|tv|me|be|co|app|site|ly)\b)/i;

    function containsLink(text) {
        return CONFIG.blockLinks && LINK_PATTERN.test(clean(text));
    }

    /*
     * True als de tekst vooral uit niet-Latijnse letters bestaat,
     * bijvoorbeeld katakana of Cyrillisch. NFKC eerst, zodat
     * vette en fullwidth-letters als Latijns tellen.
     */
    function isMostlyForeign(text) {

        if (!CONFIG.blockForeignScripts) {
            return false;
        }

        const letters = Array.from(clean(text).normalize("NFKC"))
            .filter(ch => /\p{L}/u.test(ch));

        if (letters.length < 3) {
            return false;
        }

        const foreign = letters.filter(ch => !/[A-Za-z\u00C0-\u024F]/.test(ch));

        return foreign.length / letters.length > 0.3;
    }

    /*
     * Geeft de melding terug als een bericht verborgen moet worden,
     * anders null.
     */
    function moderationNotice(text) {

        const raw = clean(text);

        if (raw.length > CONFIG.maxMessageLength) {
            return HIDDEN_LONG_TEXT;
        }

        if (containsLink(raw)) {
            return HIDDEN_LINK_TEXT;
        }

        if (isMostlyForeign(raw)) {
            return HIDDEN_CHARS_TEXT;
        }

        if (CONFIG.profanityLocal && containsProfanityLocal(raw)) {
            return HIDDEN_TEXT;
        }

        return null;
    }

    // ============================================================
    // SPAMFILTER (LOKAAL)
    // ============================================================

    function isSpam(message) {

        const text = clean(message.text);
        const userId = clean(message.userId);
        const now = Number(message.timestamp) || Date.now();

        if (!text || !userId) {
            return false;
        }

        // Alleen leestekens, bijvoorbeeld "." of "..."
        if (!/[\p{L}\p{N}]/u.test(text)) {
            return true;
        }

        const lower = text.toLowerCase();

        const history = (recentByUser.get(userId) || [])
            .filter(entry => Math.abs(now - entry.time) < CONFIG.spamWindowMs);

        history.push({ text: lower, time: now });
        recentByUser.set(userId, history);

        if (history.length > CONFIG.spamMaxPerWindow) {
            return true;
        }

        const same = history.filter(entry => entry.text === lower).length;

        return same >= CONFIG.spamMaxSame;
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
     * True als dezelfde afzender binnen het venster al
     * dezelfde tekst heeft gestuurd, met een ander bericht-id.
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
     * Volledige controle bij verzenden: lokaal, daarna extern.
     */
    async function isProfane(text) {

        if (!CONFIG.profanityEnabled) {
            return false;
        }

        if (CONFIG.profanityLocal && containsProfanityLocal(text)) {
            return true;
        }

        if (!CONFIG.profanityExternal) {
            return false;
        }

        const external = await checkExternal(text);

        if (external === null) {
            return CONFIG.profanityFailClosed;
        }

        return external;
    }

    /*
     * Synchrone lokale controle voor binnenkomende berichten.
     * Bekende berichten worden niet opnieuw beoordeeld.
     */
    function moderateIncoming(message) {

        if (!message || typeof message !== "object") {
            return message;
        }

        if (message.id && messageMap.has(message.id)) {
            return message;
        }

        if (isHiddenText(message.text)) {
            return message;
        }

        if (!CONFIG.profanityEnabled) {
            return message;
        }

        const notice = moderationNotice(message.text);

        if (notice) {
            return { ...message, text: notice };
        }

        if (isSpam(message)) {
            return { ...message, text: HIDDEN_SPAM_TEXT };
        }

        return message;
    }

    /*
     * Achtergrondcontrole extern. Het bericht blijft eerst zichtbaar
     * en wordt verborgen als de dienst het afkeurt.
     */
    function hideMessage(id) {

        const existing = messageMap.get(id);

        if (!existing || isHiddenText(existing.text)) {
            return;
        }

        messageMap.set(id, {
            ...existing,
            text: HIDDEN_TEXT
        });

        saveLocalCache();
        renderAllMessages();
    }

    function scheduleExternalCheck(message) {

        if (
            !CONFIG.profanityEnabled ||
            !CONFIG.profanityExternal ||
            !message ||
            isHiddenText(message.text)
        ) {
            return;
        }

        checkExternal(message.text).then(flagged => {

            if (flagged === true) {
                hideMessage(message.id);
            }
        });
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
                addMessage(moderateIncoming(message), false);
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
        historyLoaded = true;

        const messages = Array.isArray(data?.messages)
            ? data.messages
            : [];

        log("PubNub history ontvangen:", messages.length, "berichten");

        const added = [];

        for (const message of sortByTime([...messages])) {

            const moderated = moderateIncoming(message);

            if (addMessage(moderated, false)) {
                added.push(moderated);
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

        } else if (category === "PNNetworkUpCategory") {

            pubnubConnected = true;
            setStatus("Verbonden");

            syncHistory();
        }
    }

    // ============================================================
    // SEND MESSAGE
    // ============================================================

    async function sendMessage() {

        if (!channel || !currentUser) {
            return;
        }

        const text = clean(messageInput?.value);

        if (!text) {
            return;
        }

        if (text.length > 2000) {
            setStatus("Bericht is te lang");
            return;
        }

        /*
         * Lokale controles: lengte, links, tekens, scheldwoorden.
         */

        const sendNotice = moderationNotice(text);

        if (sendNotice) {
            setStatus(
                "Bericht niet verstuurd: " +
                sendNotice.replace("⚠️ Bericht verborgen ", "")
            );
            return;
        }

        const now = Date.now();

        /*
         * Duplicaat: dezelfde tekst binnen 2 minuten.
         */

        if (isRecentDuplicate(currentUser.id, text, now, "")) {
            setStatus("Dit bericht is al binnen 2 minuten verstuurd");
            return;
        }

        /*
         * Spam vóór de externe check.
         */

        if (
            CONFIG.profanityEnabled &&
            isSpam({ text, userId: currentUser.id, timestamp: now })
        ) {
            setStatus("Even wachten: te veel berichten of spam");
            return;
        }

        setStatus("Controleren...");

        if (await isProfane(text)) {
            setStatus("Bericht bevat ongepast taalgebruik");
            return;
        }

        sendButton.disabled = true;

        const message = {
            id: crypto.randomUUID(),
            userId: String(currentUser.id),
            name: String(currentUser.name),
            text: text,
            timestamp: now
        };

        addMessage(message, true);
        saveLocalCache();

        messageInput.value = "";
        autoResizeInput();

        window.postMessage({
            source: "SOMTODAY_PUBNUB_USERSCRIPT",
            type: "PUBLISH",
            data: {
                channel: String(channel),
                message: message
            }
        }, "*");

        setStatus("Verbonden");

        setTimeout(() => {

            if (sendButton) {
                sendButton.disabled = false;
            }

        }, 250);
    }

    // ============================================================
    // MESSAGE STORE
    // ============================================================

    function normalizeMessage(message) {

        if (!message || typeof message !== "object") {
            return null;
        }

        const normalized = {
            id: clean(message.id),
            userId: clean(message.userId),
            name: clean(message.name || "Leerling"),
            text: clean(message.text),
            timestamp: Number(message.timestamp || Date.now())
        };

        if (!normalized.id || !normalized.text) {
            return null;
        }

        return normalized;
    }

    /*
     * Voegt een bericht toe. Geeft false terug bij:
     * - ongeldig bericht
     * - bekend bericht-id
     * - duplicaat binnen het 2-minutenvenster
     */
    function addMessage(message, render = true) {

        const normalized = normalizeMessage(message);

        if (!normalized) {
            return false;
        }

        if (messageMap.has(normalized.id)) {
            return false;
        }

        pruneSeenTexts(Date.now());

        if (
            isRecentDuplicate(
                normalized.userId,
                normalized.text,
                normalized.timestamp,
                normalized.id
            )
        ) {
            return false;
        }

        messageMap.set(normalized.id, normalized);
        rememberText(normalized);

        if (messageMap.size > CONFIG.maxMessages) {

            const sorted = sortByTime(Array.from(messageMap.values()));

            while (sorted.length > CONFIG.maxMessages) {

                const oldest = sorted.shift();

                if (oldest) {
                    messageMap.delete(oldest.id);
                }
            }
        }

        if (render) {
            renderAllMessages();
        }

        return true;
    }

    function handleIncomingMessage(message) {

        const moderated = moderateIncoming(message);

        const added = addMessage(moderated, false);

        if (!added) {
            return;
        }

        saveLocalCache();
        renderAllMessages();

        scheduleExternalCheck(moderated);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderAllMessages() {

        if (!messagesContainer) {
            return;
        }

        const messages = sortByTime(Array.from(messageMap.values()))
            .slice(-CONFIG.maxMessages);

        messagesContainer.innerHTML = "";

        if (messages.length === 0) {

            const empty = document.createElement("div");

            empty.className = "somtoday-chat-empty";
            empty.textContent = "Nog geen berichten.";

            messagesContainer.appendChild(empty);
            return;
        }

        for (const message of messages) {
            renderMessage(message);
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function renderMessage(message) {

        if (!messagesContainer) {
            return;
        }

        const mine = String(message.userId) === String(currentUser.id);

        const wrapper = document.createElement("div");

        wrapper.className =
            "somtoday-chat-message " + (mine ? "mine" : "other");

        const name = document.createElement("div");

        name.className = "somtoday-chat-message-name";
        name.textContent = mine ? "Jij" : message.name;

        const bubble = document.createElement("div");

        bubble.className = "somtoday-chat-bubble";
        bubble.textContent = message.text;

        const time = document.createElement("div");

        time.className = "somtoday-chat-message-time";
        time.textContent = new Date(message.timestamp)
            .toLocaleTimeString("nl-NL", {
                hour: "2-digit",
                minute: "2-digit"
            });

        wrapper.appendChild(name);
        wrapper.appendChild(bubble);
        wrapper.appendChild(time);

        messagesContainer.appendChild(wrapper);
    }

    // ============================================================
    // CSS
    // ============================================================

    function injectStyles() {

        if (document.getElementById("somtoday-school-chat-style")) {
            return;
        }

        const style = document.createElement("style");

        style.id = "somtoday-school-chat-style";

        style.textContent = `
            #somtoday-school-chat-tab {
                position: relative;
                display: flex;
                align-items: stretch;
                justify-content: center;
                height: 100%;
                flex: 0 0 auto;
                cursor: pointer;
                user-select: none;
                color: var(--text-moderate, #555);
                font-family: inherit;
                font-size: 14px;
                line-height: 1;
                box-sizing: border-box;
            }
            #somtoday-school-chat-tab .somtoday-chat-tab-inner {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                height: 100%;
                padding: 0 16px;
                box-sizing: border-box;
                white-space: nowrap;
                transition: color 120ms ease, background 120ms ease;
            }
            #somtoday-school-chat-tab .somtoday-chat-tab-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                flex: 0 0 20px;
            }
            #somtoday-school-chat-tab .somtoday-chat-tab-icon svg {
                display: block;
                width: 20px;
                height: 20px;
                fill: currentColor;
            }
            #somtoday-school-chat-tab .somtoday-chat-active-top,
            #somtoday-school-chat-tab .somtoday-chat-active-bottom {
                position: absolute;
                left: 0;
                right: 0;
                height: 3px;
                background: transparent;
            }
            #somtoday-school-chat-tab .somtoday-chat-active-top { top: 0; }
            #somtoday-school-chat-tab .somtoday-chat-active-bottom { bottom: 0; }
            #somtoday-school-chat-tab:hover .somtoday-chat-tab-inner {
                color: var(--text-strong, #222);
                background: var(--bg-neutral-weakest, rgba(0,0,0,.03));
            }
            #somtoday-school-chat-tab.active {
                color: var(--text-strong, #222);
            }
            #somtoday-school-chat-tab.active .somtoday-chat-active-bottom {
                background: var(--action-primary-normal, #3565d4);
            }
            #somtoday-school-chat-panel {
                position: fixed;
                z-index: 999999;
                display: none;
                flex-direction: column;
                box-sizing: border-box;
                background: var(--bg-elevated-none, #fff);
                color: var(--text-strong, #222);
                border-top: 1px solid var(--border-neutral-weak, #e5e5e5);
                overflow: hidden;
            }
            #somtoday-school-chat-panel.open { display: flex; }
            .somtoday-chat-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                flex: 0 0 auto;
                min-height: 56px;
                padding: 0 24px;
                box-sizing: border-box;
                border-bottom: 1px solid var(--border-neutral-weak, #e5e5e5);
                background: var(--bg-elevated-none, #fff);
            }
            .somtoday-chat-header-left {
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .somtoday-chat-title { font-size: 18px; font-weight: 600; line-height: 22px; }
            .somtoday-chat-school { font-size: 12px; line-height: 16px; color: var(--text-weak, #777); }
            .somtoday-chat-header-status {
                display: flex;
                align-items: center;
                gap: 7px;
                font-size: 12px;
                color: var(--text-moderate, #666);
            }
            .somtoday-chat-status-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: currentColor;
            }
            .somtoday-chat-messages {
                flex: 1 1 auto;
                min-height: 0;
                overflow-y: auto;
                padding: 20px 24px;
                box-sizing: border-box;
                background: var(--bg-neutral-weakest, #f8f8f8);
            }
            .somtoday-chat-empty {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 180px;
                color: var(--text-weak, #777);
                font-size: 14px;
            }
            .somtoday-chat-message {
                display: flex;
                flex-direction: column;
                max-width: min(75%, 600px);
                margin-bottom: 12px;
            }
            .somtoday-chat-message.mine { margin-left: auto; align-items: flex-end; }
            .somtoday-chat-message.other { margin-right: auto; align-items: flex-start; }
            .somtoday-chat-message-name {
                margin: 0 8px 4px;
                font-size: 12px;
                color: var(--text-weak, #777);
            }
            .somtoday-chat-bubble {
                padding: 9px 12px;
                border: 1px solid var(--border-neutral-weak, #e0e0e0);
                border-radius: 10px;
                background: var(--bg-elevated-none, #fff);
                font-size: 14px;
                line-height: 20px;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }
            .somtoday-chat-message.mine .somtoday-chat-bubble {
                background: var(--action-primary-normal, #3565d4);
                color: white;
                border-color: transparent;
            }
            .somtoday-chat-message-time {
                margin: 3px 8px 0;
                font-size: 10px;
                color: var(--text-weak, #888);
            }
            .somtoday-chat-composer {
                display: flex;
                align-items: flex-end;
                gap: 8px;
                flex: 0 0 auto;
                padding: 12px 16px;
                border-top: 1px solid var(--border-neutral-weak, #e5e5e5);
                background: var(--bg-elevated-none, #fff);
            }
            .somtoday-chat-input {
                flex: 1;
                min-width: 0;
                min-height: 40px;
                max-height: 120px;
                resize: vertical;
                box-sizing: border-box;
                padding: 9px 11px;
                border: 1px solid var(--border-neutral-normal, #d6d6d6);
                border-radius: 7px;
                outline: none;
                background: var(--bg-neutral-none, #fff);
                color: var(--text-strong, #222);
                font-family: inherit;
                font-size: 14px;
                line-height: 20px;
            }
            .somtoday-chat-input:focus { border-color: var(--action-primary-normal, #3565d4); }
            .somtoday-chat-send {
                height: 40px;
                padding: 0 15px;
                border: 0;
                border-radius: 7px;
                cursor: pointer;
                background: var(--action-primary-normal, #3565d4);
                color: white;
                font-family: inherit;
                font-size: 14px;
                font-weight: 600;
            }
            .somtoday-chat-send:disabled { opacity: .55; cursor: default; }
            @media (max-width: 700px) {
                #somtoday-school-chat-tab .somtoday-chat-tab-inner { padding: 0 10px; }
                #somtoday-school-chat-tab .somtoday-chat-tab-label { display: none; }
                #somtoday-school-chat-panel {
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // ============================================================
    // TAB BAR / TAB / PANEL
    // ============================================================

    function findTabBar() {

        const direct = document.querySelector("sl-tab-bar");

        if (direct) {
            return direct;
        }

        function search(root) {

            if (!root) {
                return null;
            }

            const found = root.querySelector?.("sl-tab-bar");

            if (found) {
                return found;
            }

            const elements = root.querySelectorAll?.("*") || [];

            for (const element of elements) {

                if (element.shadowRoot) {

                    const result = search(element.shadowRoot);

                    if (result) {
                        return result;
                    }
                }
            }

            return null;
        }

        return search(document);
    }

    function createChatTab() {

        if (chatTab && chatTab.isConnected) {
            return chatTab;
        }

        const tabBar = findTabBar();

        if (!tabBar) {
            return null;
        }

        const existing = document.getElementById("somtoday-school-chat-tab");

        if (existing) {
            chatTab = existing;
            return existing;
        }

        const tab = document.createElement("div");

        tab.id = "somtoday-school-chat-tab";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", "false");
        tab.setAttribute("tabindex", "0");

        tab.innerHTML = `
            <div class="somtoday-chat-active-top"></div>
            <div class="somtoday-chat-tab-inner">
                <span class="somtoday-chat-tab-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20px" height="20px" viewBox="0 0 24 24" display="block">
                        <path d="m16.827 3.521 4.07 4.046a.73.73 0 0 0 1.03 0l.854-.849a2.163 2.163 0 0 0 0-3.073l-2.009-1.997a2.196 2.196 0 0 0-3.091 0l-.854.849a.72.72 0 0 0 0 1.024"></path>
                        <path fill-rule="evenodd" d="M6.11 13.448v4.046c0 .4.326.724.729.724h4.07a.73.73 0 0 0 .515-.212l8.745-8.69a.72.72 0 0 0 0-1.025l-4.07-4.046a.73.73 0 0 0-1.031 0l-8.745 8.691a.72.72 0 0 0-.213.512m6.043 2.385-.729.724a.73.73 0 0 1-.515.213h-.705a.73.73 0 0 1-.652-.4l-.419-.833a.73.73 0 0 0-.325-.324l-.838-.416a.72.72 0 0 1-.403-.648v-.7c0-.193.077-.377.214-.513l.729-.724a.73.73 0 0 1 1.03 0l2.613 2.597a.72.72 0 0 1 0 1.024"></path>
                        <path d="M4.332 24C1.94 24.002 0 22.076 0 19.698V6.204c0-2.375 1.938-4.301 4.328-4.301h5.509a1.27 1.27 0 0 1 1.273 1.265 1.27 1.27 0 0 1-1.273 1.265h-5.51c-.983 0-1.781.793-1.781 1.771v13.495c0 .98.799 1.773 1.784 1.772l13.32-.014a1.777 1.777 0 0 0 1.78-1.77v-4.35c0-.7.57-1.266 1.272-1.266a1.27 1.27 0 0 1 1.273 1.265v4.35c0 2.374-1.935 4.3-4.323 4.302z"></path>
                    </svg>
                </span>
                <span class="somtoday-chat-tab-label">Chat</span>
            </div>
            <div class="somtoday-chat-active-bottom"></div>
        `;

        tab.addEventListener("click", event => {
            event.stopPropagation();
            toggleChat();
        });

        tab.addEventListener("keydown", event => {

            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleChat();
            }
        });

        tabBar.appendChild(tab);

        chatTab = tab;

        return tab;
    }

    function bindPanelElements() {

        messagesContainer = document.getElementById("somtoday-chat-messages");
        messageInput = document.getElementById("somtoday-chat-input");
        sendButton = document.getElementById("somtoday-chat-send");
        statusElement = document.getElementById("somtoday-chat-status");
    }

    function createChatPanel() {

        if (chatPanel && chatPanel.isConnected) {
            return chatPanel;
        }

        const existing = document.getElementById("somtoday-school-chat-panel");

        if (existing) {

            chatPanel = existing;
            bindPanelElements();

            return existing;
        }

        const panel = document.createElement("section");

        panel.id = "somtoday-school-chat-panel";

        panel.innerHTML = `
            <div class="somtoday-chat-header">
                <div class="somtoday-chat-header-left">
                    <div class="somtoday-chat-title">School Chat</div>
                    <div class="somtoday-chat-school" id="somtoday-chat-school"></div>
                </div>
                <div class="somtoday-chat-header-status">
                    <span class="somtoday-chat-status-dot"></span>
                    <span id="somtoday-chat-status">Verbinden...</span>
                </div>
            </div>
            <div class="somtoday-chat-messages" id="somtoday-chat-messages"></div>
            <div class="somtoday-chat-composer">
                <textarea id="somtoday-chat-input" class="somtoday-chat-input"
                    placeholder="Typ een bericht..." maxlength="2000" rows="1"></textarea>
                <button id="somtoday-chat-send" class="somtoday-chat-send" type="button">Sturen</button>
            </div>
        `;

        document.body.appendChild(panel);

        chatPanel = panel;
        bindPanelElements();

        const school = document.getElementById("somtoday-chat-school");

        if (school) {
            school.textContent = currentUser?.vestiging || "School";
        }

        sendButton.addEventListener("click", sendMessage);

        messageInput.addEventListener("keydown", event => {

            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });

        messageInput.addEventListener("input", autoResizeInput);

        renderAllMessages();

        return panel;
    }

    function autoResizeInput() {

        if (!messageInput) {
            return;
        }

        messageInput.style.height = "auto";
        messageInput.style.height =
            Math.min(messageInput.scrollHeight, 120) + "px";
    }

    function setStatus(text) {

        if (statusElement) {
            statusElement.textContent = String(text);
        }
    }

    function positionChatPanel() {

        if (!chatPanel) {
            return;
        }

        if (window.innerWidth <= 700) {

            chatPanel.style.left = "0";
            chatPanel.style.top = "0";
            chatPanel.style.width = "100%";
            chatPanel.style.height = "100%";
            return;
        }

        const header = document.querySelector("sl-header");

        if (!header) {
            return;
        }

        const rect = header.getBoundingClientRect();
        const top = Math.max(0, rect.bottom);

        chatPanel.style.left = "0";
        chatPanel.style.top = `${top}px`;
        chatPanel.style.width = "100%";
        chatPanel.style.height = `calc(100vh - ${top}px)`;
    }

    function openChat() {

        if (!chatPanel) {
            createChatPanel();
        }

        if (!chatPanel) {
            return;
        }

        chatOpen = true;

        chatPanel.classList.add("open");

        if (chatTab) {
            chatTab.classList.add("active");
            chatTab.setAttribute("aria-selected", "true");
        }

        positionChatPanel();

        if (CONFIG.syncOnOpen && pubnubConnected) {
            syncHistory();
        }

        setTimeout(() => {

            if (messageInput) {
                messageInput.focus();
            }

        }, 50);

        log("Chat geopend.");
    }

    function closeChat() {

        if (!chatPanel) {
            return;
        }

        chatOpen = false;

        chatPanel.classList.remove("open");

        if (chatTab) {
            chatTab.classList.remove("active");
            chatTab.setAttribute("aria-selected", "false");
        }

        log("Chat gesloten.");
    }

    function toggleChat() {

        if (chatOpen) {
            closeChat();
        } else {
            openChat();
        }
    }

    // ============================================================
    // NATIVE SOMTODAY TABS
    // ============================================================

    function setupNativeTabSwitching() {

        document.addEventListener("click", event => {

            if (!chatOpen) {
                return;
            }

            const target = event.target;

            if (!target || !target.closest) {
                return;
            }

            if (
                target.closest("#somtoday-school-chat-tab") ||
                target.closest("#somtoday-school-chat-panel")
            ) {
                return;
            }

            if (!target.closest("sl-tab-item")) {
                return;
            }

            log("Native Somtoday-tab -> Chat sluiten.");

            closeChat();

        }, true);

        document.addEventListener("keydown", event => {

            if (!chatOpen) {
                return;
            }

            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }

            const target = event.target;

            if (!target || !target.closest) {
                return;
            }

            if (target.closest("sl-tab-item")) {
                closeChat();
            }

        }, true);
    }

    // ============================================================
    // OBSERVER / WINDOW EVENTS
    // ============================================================

    function setupObserver() {

        if (observer) {
            return;
        }

        observer = new MutationObserver(() => {

            if (!chatTab?.isConnected) {
                chatTab = null;
                createChatTab();
            }

            if (!chatPanel?.isConnected) {

                const wasOpen = chatOpen;

                chatPanel = null;
                createChatPanel();

                if (wasOpen) {
                    openChat();
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function setupWindowEvents() {

        window.addEventListener("resize", () => {

            if (chatOpen) {
                positionChatPanel();
            }
        });

        document.addEventListener("visibilitychange", () => {

            if (!document.hidden && pubnubConnected) {
                syncHistory();
            }
        });

        window.addEventListener("online", () => {

            log("Internet terug -> history sync.");

            syncHistory();
        });
    }

    // ============================================================
    // WAIT / START
    // ============================================================

    async function waitForSomtodayUI() {

        const start = Date.now();

        while (Date.now() - start < CONFIG.startupTimeout) {

            if (findTabBar()) {
                return;
            }

            await sleep(250);
        }

        throw new Error("Somtoday sl-tab-bar niet gevonden.");
    }

    async function start() {

        try {

            log("Somtoday School Chat " + CONFIG.version + " starten...");

            purgeOldData();

            injectStyles();

            setupPubNubMessageListener();

            installPubNubBridge();

            currentUser = await findSomtodayUser();

            await prepareChannel();

            loadLocalCache();

            await waitForSomtodayUI();

            createChatTab();
            createChatPanel();

            setupNativeTabSwitching();
            setupObserver();
            setupWindowEvents();

            setStatus("Verbinden...");

            connectPubNub();

            log("Chat geïnjecteerd.");
            log("Persistent sync actief.");

        } catch (err) {

            error("Chat starten mislukt:", err);

            window.__SOMTODAY_SCHOOL_CHAT_RUNNING__ = false;
        }
    }

    // ============================================================
    // RUN
    // ============================================================

    start();

})();
