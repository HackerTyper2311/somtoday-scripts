(() => {
    "use strict";

    /*
     * ============================================================
     * SOMTODAY SCHOOL CHAT
     * Firefox Userscript + Page Context PubNub Bridge
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
        publishKey: "demo",
        subscribeKey: "demo",

        pubnubScript:
            "https://cdn.pubnub.com/sdk/javascript/pubnub.10.2.0.min.js",

        channelPrefix: "school",

        maxMessages: 100,

        startupTimeout: 30000,

        popupDelay: 3000,

        debug: true
    };

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

    let hiddenElements = [];

    let observer = null;

    const receivedMessages = [];

    // ============================================================
    // LOGGING
    // ============================================================

    function log(...args) {

        if (CONFIG.debug) {
            console.log(
                "[Somtoday Chat]",
                ...args
            );
        }
    }

    function warn(...args) {

        console.warn(
            "[Somtoday Chat]",
            ...args
        );
    }

    function error(...args) {

        console.error(
            "[Somtoday Chat]",
            ...args
        );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function clean(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value).trim();
    }

    function sleep(ms) {

        return new Promise(
            resolve => setTimeout(
                resolve,
                ms
            )
        );
    }

    // ============================================================
    // SHA256
    // ============================================================

    async function sha256(text) {

        const data =
            new TextEncoder().encode(
                String(text)
            );

        const hashBuffer =
            await crypto.subtle.digest(
                "SHA-256",
                data
            );

        const hashArray =
            Array.from(
                new Uint8Array(
                    hashBuffer
                )
            );

        return hashArray
            .map(
                byte =>
                    byte
                        .toString(16)
                        .padStart(2, "0")
            )
            .join("");
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

                const raw =
                    localStorage.getItem(
                        key
                    );

                if (!raw) {
                    continue;
                }

                const parsed =
                    JSON.parse(raw);

                if (
                    parsed &&
                    typeof parsed === "object"
                ) {

                    return parsed;
                }

            } catch (err) {

                warn(
                    "Auth storage lezen mislukt:",
                    key,
                    err
                );
            }
        }

        /*
         * Fallback: zoek andere auth-items.
         */

        for (
            let i = 0;
            i < localStorage.length;
            i++
        ) {

            const key =
                localStorage.key(i);

            if (!key) {
                continue;
            }

            if (
                !key
                    .toLowerCase()
                    .includes("auth")
            ) {
                continue;
            }

            try {

                const raw =
                    localStorage.getItem(
                        key
                    );

                if (!raw) {
                    continue;
                }

                const parsed =
                    JSON.parse(raw);

                if (
                    parsed?.currentLeerling ||
                    parsed?.allAuthenticationRecords
                ) {

                    log(
                        "Auth gevonden:",
                        key
                    );

                    return parsed;
                }

            } catch {
                // Geen JSON-auth item.
            }
        }

        return null;
    }

    // ============================================================
    // EXTRACT USER
    // ============================================================

    function extractUser(auth) {

        const currentLeerling =
            auth?.currentLeerling ||
            null;

        const fallbackLeerling =
            auth
                ?.allAuthenticationRecords?.[0]
                ?.subLeerlingen?.[0] ||
            null;

        const leerling =
            currentLeerling ||
            fallbackLeerling ||
            {};

        const record =
            auth
                ?.allAuthenticationRecords?.[0] ||
            {};

        /*
         * BELANGRIJK:
         *
         * Vestiging is de schoolidentiteit.
         */

        const vestiging =
            clean(
                currentLeerling?.vestiging ??
                fallbackLeerling?.vestiging ??
                ""
            );

        const id =
            clean(
                leerling?.id
            );

        const name =
            clean(
                record?.voornaam ||
                leerling?.voornaam ||
                leerling?.naam ||
                leerling?.displayName ||
                "Leerling"
            );

        return {

            id:
                String(id),

            name:
                String(name),

            vestiging:
                String(vestiging),

            locationName:
                String(vestiging)
        };
    }

    // ============================================================
    // FIND USER
    // ============================================================

    async function findSomtodayUser() {

        const start =
            Date.now();

        let authFound = false;

        while (
            Date.now() - start <
            CONFIG.startupTimeout
        ) {

            const auth =
                getAuthRecord();

            if (auth) {

                if (!authFound) {

                    log(
                        "Somtoday auth gevonden."
                    );

                    authFound = true;
                }

                const user =
                    extractUser(auth);

                if (
                    user.id &&
                    user.vestiging
                ) {

                    log(
                        "Somtoday gebruiker:",
                        user
                    );

                    return user;
                }
            }

            await sleep(500);
        }

        throw new Error(
            "Geen geldige Somtoday leerlinggegevens gevonden."
        );
    }

    // ============================================================
    // PREPARE CHANNEL
    // ============================================================

    async function prepareChannel() {

        const vestiging =
            clean(
                currentUser?.vestiging
            );

        if (!vestiging) {

            throw new Error(
                "Geen Somtoday-vestiging gevonden."
            );
        }

        const schoolHash =
            await sha256(
                vestiging
            );

        channel =
            `${String(CONFIG.channelPrefix)}.` +
            `${String(
                schoolHash.slice(
                    0,
                    24
                )
            )}.general`;

        log(
            "Vestiging:",
            vestiging
        );

        log(
            "School hash:",
            schoolHash
        );

        log(
            "Chat-kanaal:",
            channel
        );
    }

    // ============================================================
    // PUBNUB PAGE-CONTEXT BRIDGE
    // ============================================================

    function installPubNubBridge() {

        /*
         * Voorkom dubbele bridge.
         */

        if (
            window.__SOMTODAY_PUBNUB_BRIDGE_INSTALLED__
        ) {

            log(
                "PubNub bridge bestaat al."
            );

            return;
        }

        window.__SOMTODAY_PUBNUB_BRIDGE_INSTALLED__ =
            true;

        /*
         * Deze functie wordt als normaal page-script
         * in de Somtoday pagina geïnjecteerd.
         *
         * Daardoor draait PubNub niet in de
         * geïsoleerde userscript-context.
         */

        const bridgeCode = `

            (() => {

                "use strict";

                if (
                    window.__SOMTODAY_PUBNUB_PAGE_BRIDGE__
                ) {
                    return;
                }

                window.__SOMTODAY_PUBNUB_PAGE_BRIDGE__ =
                    true;

                let pubnub = null;

                let currentChannel = null;

                let loadingPromise = null;

                const SDK_URL =
                    ${JSON.stringify(
                        String(
                            CONFIG.pubnubScript
                        )
                    )};

                function post(type, data) {

                    try {

                        window.postMessage({

                            source:
                                "SOMTODAY_PUBNUB_BRIDGE",

                            type:
                                type,

                            data:
                                data || null

                        }, "*");

                    } catch (e) {

                        console.error(
                            "[Somtoday PubNub Bridge]",
                            e
                        );
                    }
                }

                function loadSDK() {

                    if (
                        window.PubNub
                    ) {

                        return Promise.resolve(
                            window.PubNub
                        );
                    }

                    if (
                        loadingPromise
                    ) {

                        return loadingPromise;
                    }

                    loadingPromise =
                        new Promise(
                            (resolve, reject) => {

                                const existing =
                                    document.querySelector(
                                        'script[data-somtoday-pubnub="true"]'
                                    );

                                if (existing) {

                                    existing.addEventListener(
                                        "load",
                                        () => {

                                            if (
                                                window.PubNub
                                            ) {

                                                resolve(
                                                    window.PubNub
                                                );

                                            } else {

                                                reject(
                                                    new Error(
                                                        "PubNub niet beschikbaar na laden."
                                                    )
                                                );
                                            }
                                        }
                                    );

                                    existing.addEventListener(
                                        "error",
                                        () => {

                                            reject(
                                                new Error(
                                                    "PubNub script kon niet worden geladen."
                                                )
                                            );
                                        }
                                    );

                                    return;
                                }

                                const script =
                                    document.createElement(
                                        "script"
                                    );

                                script.src =
                                    SDK_URL;

                                script.async =
                                    true;

                                script.dataset.somtodayPubnub =
                                    "true";

                                script.onload =
                                    () => {

                                        setTimeout(
                                            () => {

                                                if (
                                                    window.PubNub
                                                ) {

                                                    resolve(
                                                        window.PubNub
                                                    );

                                                } else {

                                                    reject(
                                                        new Error(
                                                            "PubNub SDK geladen maar niet beschikbaar."
                                                        )
                                                    );
                                                }

                                            },
                                            100
                                        );
                                    };

                                script.onerror =
                                    () => {

                                        reject(
                                            new Error(
                                                "PubNub SDK kon niet worden geladen."
                                            )
                                        );
                                    };

                                (
                                    document.head ||
                                    document.documentElement
                                ).appendChild(
                                    script
                                );
                            }
                        );

                    return loadingPromise;
                }

                async function connect(data) {

                    try {

                        const PubNub =
                            await loadSDK();

                        const publishKey =
                            String(
                                data.publishKey
                            );

                        const subscribeKey =
                            String(
                                data.subscribeKey
                            );

                        const userId =
                            String(
                                data.userId
                            );

                        currentChannel =
                            String(
                                data.channel
                            );

                        pubnub =
                            new PubNub({

                                publishKey:
                                    publishKey,

                                subscribeKey:
                                    subscribeKey,

                                userId:
                                    userId
                            });

                        pubnub.addListener({

                            status(event) {

                                post(
                                    "STATUS",
                                    {
                                        category:
                                            String(
                                                event.category ||
                                                ""
                                            )
                                    }
                                );
                            },

                            message(event) {

                                if (
                                    !event ||
                                    !event.message
                                ) {
                                    return;
                                }

                                post(
                                    "MESSAGE",
                                    event.message
                                );
                            },

                            messageAction(event) {

                                post(
                                    "MESSAGE_ACTION",
                                    event
                                );
                            }
                        });

                        pubnub.subscribe({

                            channels: [
                                String(
                                    currentChannel
                                )
                            ]
                        });

                        post(
                            "CONNECTED",
                            {
                                channel:
                                    currentChannel
                            }
                        );

                    } catch (err) {

                        post(
                            "ERROR",
                            {
                                message:
                                    String(
                                        err?.message ||
                                        err
                                    )
                            }
                        );
                    }
                }

                async function publish(data) {

                    try {

                        if (!pubnub) {

                            throw new Error(
                                "PubNub is nog niet verbonden."
                            );
                        }

                        const targetChannel =
                            String(
                                data.channel
                            );

                        const message =
                            data.message;

                        await pubnub.publish({

                            channel:
                                targetChannel,

                            message:
                                message
                        });

                        post(
                            "PUBLISHED",
                            {
                                id:
                                    message?.id ||
                                    null
                            }
                        );

                    } catch (err) {

                        post(
                            "ERROR",
                            {
                                message:
                                    String(
                                        err?.message ||
                                        err
                                    )
                            }
                        );
                    }
                }

                window.addEventListener(
                    "message",
                    event => {

                        if (
                            event.source !==
                            window
                        ) {
                            return;
                        }

                        const data =
                            event.data;

                        if (
                            !data ||
                            data.source !==
                                "SOMTODAY_PUBNUB_USERSCRIPT"
                        ) {
                            return;
                        }

                        if (
                            data.type ===
                            "CONNECT"
                        ) {

                            connect(
                                data.data || {}
                            );

                        } else if (
                            data.type ===
                            "PUBLISH"
                        ) {

                            publish(
                                data.data || {}
                            );
                        }
                    }
                );

                post(
                    "BRIDGE_READY"
                );

            })();

        `;

        const script =
            document.createElement(
                "script"
            );

        script.textContent =
            bridgeCode;

        (
            document.documentElement ||
            document.head ||
            document.body
        ).appendChild(
            script
        );

        script.remove();

        log(
            "PubNub page-context bridge geïnstalleerd."
        );
    }

    // ============================================================
    // PUBNUB BRIDGE MESSAGES
    // ============================================================

    function setupPubNubMessageListener() {

        window.addEventListener(
            "message",
            event => {

                if (
                    event.source !==
                    window
                ) {
                    return;
                }

                const data =
                    event.data;

                if (
                    !data ||
                    data.source !==
                        "SOMTODAY_PUBNUB_BRIDGE"
                ) {
                    return;
                }

                switch (
                    data.type
                ) {

                    case "BRIDGE_READY":

                        log(
                            "PubNub bridge is klaar."
                        );

                        connectPubNub();

                        break;

                    case "CONNECTED":

                        log(
                            "PubNub verbonden:",
                            data.data
                        );

                        setStatus(
                            "Verbonden"
                        );

                        break;

                    case "MESSAGE":

                        handleIncomingMessage(
                            data.data
                        );

                        break;

                    case "PUBLISHED":

                        break;

                    case "STATUS":

                        handlePubNubStatus(
                            data.data
                        );

                        break;

                    case "ERROR":

                        error(
                            "PubNub bridge:",
                            data.data
                        );

                        setStatus(
                            "Chat offline"
                        );

                        break;
                }
            }
        );
    }

    // ============================================================
    // CONNECT PUBNUB
    // ============================================================

    function connectPubNub() {

        if (
            !currentUser ||
            !channel
        ) {
            return;
        }

        log(
            "PubNub verbinding aanvragen..."
        );

        window.postMessage({

            source:
                "SOMTODAY_PUBNUB_USERSCRIPT",

            type:
                "CONNECT",

            data: {

                publishKey:
                    String(
                        CONFIG.publishKey
                    ),

                subscribeKey:
                    String(
                        CONFIG.subscribeKey
                    ),

                userId:
                    String(
                        currentUser.id
                    ),

                channel:
                    String(
                        channel
                    )
            }

        }, "*");
    }

    // ============================================================
    // PUBNUB STATUS
    // ============================================================

    function handlePubNubStatus(data) {

        const category =
            clean(
                data?.category
            );

        if (
            category ===
            "PNConnectedCategory"
        ) {

            setStatus(
                "Verbonden"
            );

            return;
        }

        if (
            category ===
            "PNNetworkDownCategory"
        ) {

            setStatus(
                "Geen verbinding"
            );

            return;
        }

        if (
            category ===
            "PNNetworkUpCategory"
        ) {

            setStatus(
                "Verbonden"
            );

            return;
        }

        if (
            category ===
            "PNNetworkIssuesCategory"
        ) {

            setStatus(
                "Verbindingsprobleem"
            );
        }
    }

    // ============================================================
    // SEND MESSAGE
    // ============================================================

    async function sendMessage() {

        if (!channel) {

            setStatus(
                "Chat offline"
            );

            return;
        }

        const text =
            clean(
                messageInput?.value
            );

        if (!text) {
            return;
        }

        if (
            text.length > 2000
        ) {

            setStatus(
                "Bericht is te lang"
            );

            return;
        }

        const message = {

            id:
                crypto.randomUUID(),

            userId:
                String(
                    currentUser.id
                ),

            name:
                String(
                    currentUser.name
                ),

            text:
                String(text),

            timestamp:
                Date.now()
        };

        try {

            sendButton.disabled =
                true;

            window.postMessage({

                source:
                    "SOMTODAY_PUBNUB_USERSCRIPT",

                type:
                    "PUBLISH",

                data: {

                    channel:
                        String(
                            channel
                        ),

                    message:
                        message
                }

            }, "*");

            messageInput.value =
                "";

            autoResizeInput();

        } catch (err) {

            error(
                "Bericht verzenden mislukt:",
                err
            );

            setStatus(
                "Verzenden mislukt"
            );

        } finally {

            setTimeout(
                () => {

                    if (sendButton) {
                        sendButton.disabled =
                            false;
                    }

                },
                250
            );

            messageInput?.focus();
        }
    }

    // ============================================================
    // INCOMING MESSAGE
    // ============================================================

    function normalizeMessage(message) {

        if (
            !message ||
            typeof message !==
                "object"
        ) {
            return null;
        }

        return {

            id:
                clean(
                    message.id ||
                    crypto.randomUUID()
                ),

            userId:
                clean(
                    message.userId
                ),

            name:
                clean(
                    message.name ||
                    "Leerling"
                ),

            text:
                clean(
                    message.text
                ),

            timestamp:
                Number(
                    message.timestamp ||
                    Date.now()
                )
        };
    }

    function handleIncomingMessage(
        message
    ) {

        const normalized =
            normalizeMessage(
                message
            );

        if (
            !normalized ||
            !normalized.text
        ) {
            return;
        }

        /*
         * Voorkom dubbele berichten.
         */

        const alreadyExists =
            receivedMessages.some(
                existing =>
                    existing.id ===
                    normalized.id
            );

        if (alreadyExists) {
            return;
        }

        receivedMessages.push(
            normalized
        );

        while (
            receivedMessages.length >
            CONFIG.maxMessages
        ) {

            receivedMessages.shift();
        }

        renderMessage(
            normalized
        );
    }

    // ============================================================
    // CSS
    // ============================================================

    function injectStyles() {

        if (
            document.getElementById(
                "somtoday-school-chat-style"
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            "somtoday-school-chat-style";

        style.textContent = `

            /* ====================================================
               CHAT TAB
               ==================================================== */

            #somtoday-school-chat-tab {

                position: relative;

                display: flex;

                align-items: stretch;

                justify-content: center;

                height: 100%;

                flex:
                    0 0 auto;

                cursor:
                    pointer;

                user-select:
                    none;

                color:
                    var(
                        --text-moderate,
                        #555
                    );

                font-family:
                    inherit;

                font-size:
                    14px;

                line-height:
                    1;

                box-sizing:
                    border-box;
            }

            #somtoday-school-chat-tab
            .somtoday-chat-tab-inner {

                position:
                    relative;

                display:
                    flex;

                align-items:
                    center;

                justify-content:
                    center;

                gap:
                    8px;

                height:
                    100%;

                padding:
                    0 16px;

                box-sizing:
                    border-box;

                white-space:
                    nowrap;

                transition:
                    color 120ms ease,
                    background 120ms ease;
            }

            #somtoday-school-chat-tab
            .somtoday-chat-tab-icon {

                display:
                    flex;

                align-items:
                    center;

                justify-content:
                    center;

                width:
                    16px;

                height:
                    16px;

                flex:
                    0 0 16px;
            }

            #somtoday-school-chat-tab
            .somtoday-chat-tab-icon svg {

                display:
                    block;

                width:
                    16px;

                height:
                    16px;

                fill:
                    currentColor;
            }

            #somtoday-school-chat-tab
            .somtoday-chat-tab-label {

                display:
                    inline-block;

                font-family:
                    inherit;

                font-size:
                    inherit;

                font-weight:
                    inherit;

                line-height:
                    1;
            }

            #somtoday-school-chat-tab
            .somtoday-chat-active-top {

                position:
                    absolute;

                left:
                    0;

                right:
                    0;

                top:
                    0;

                height:
                    3px;

                background:
                    transparent;

                border-radius:
                    0 0 2px 2px;
            }

            #somtoday-school-chat-tab
            .somtoday-chat-active-bottom {

                position:
                    absolute;

                left:
                    0;

                right:
                    0;

                bottom:
                    0;

                height:
                    3px;

                background:
                    transparent;

                border-radius:
                    2px 2px 0 0;
            }

            #somtoday-school-chat-tab:hover
            .somtoday-chat-tab-inner {

                color:
                    var(
                        --text-strong,
                        #222
                    );

                background:
                    var(
                        --bg-neutral-weakest,
                        rgba(0,0,0,.03)
                    );
            }

            #somtoday-school-chat-tab.active {

                color:
                    var(
                        --text-strong,
                        #222
                    );
            }

            #somtoday-school-chat-tab.active
            .somtoday-chat-active-top {

                background:
                    var(
                        --action-primary-normal,
                        #3565d4
                    );
            }

            #somtoday-school-chat-tab.active
            .somtoday-chat-active-bottom {

                background:
                    var(
                        --action-primary-normal,
                        #3565d4
                    );
            }

            /* ====================================================
               CHAT PANEL
               ==================================================== */

            #somtoday-school-chat-panel {

                position:
                    fixed;

                z-index:
                    999999;

                display:
                    none;

                flex-direction:
                    column;

                box-sizing:
                    border-box;

                background:
                    var(
                        --bg-elevated-none,
                        #fff
                    );

                color:
                    var(
                        --text-strong,
                        #222
                    );

                border:
                    1px solid
                    var(
                        --border-neutral-normal,
                        #ddd
                    );

                box-shadow:
                    0 4px 18px
                    rgba(0,0,0,.10);

                overflow:
                    hidden;
            }

            #somtoday-school-chat-panel.open {

                display:
                    flex;
            }

            /* ====================================================
               HEADER
               ==================================================== */

            .somtoday-chat-header {

                display:
                    flex;

                align-items:
                    center;

                justify-content:
                    space-between;

                flex:
                    0 0 auto;

                min-height:
                    56px;

                padding:
                    0 20px;

                box-sizing:
                    border-box;

                border-bottom:
                    1px solid
                    var(
                        --border-neutral-weak,
                        #e5e5e5
                    );

                background:
                    var(
                        --bg-elevated-none,
                        #fff
                    );
            }

            .somtoday-chat-header-left {

                min-width:
                    0;

                display:
                    flex;

                flex-direction:
                    column;

                gap:
                    3px;
            }

            .somtoday-chat-title {

                font-size:
                    17px;

                font-weight:
                    600;

                line-height:
                    20px;

                color:
                    var(
                        --text-strong,
                        #222
                    );
            }

            .somtoday-chat-school {

                max-width:
                    400px;

                overflow:
                    hidden;

                text-overflow:
                    ellipsis;

                white-space:
                    nowrap;

                font-size:
                    12px;

                line-height:
                    16px;

                color:
                    var(
                        --text-weak,
                        #777
                    );
            }

            .somtoday-chat-header-status {

                display:
                    flex;

                align-items:
                    center;

                gap:
                    7px;

                font-size:
                    12px;

                color:
                    var(
                        --text-moderate,
                        #666
                    );
            }

            .somtoday-chat-status-dot {

                width:
                    7px;

                height:
                    7px;

                flex:
                    0 0 7px;

                border-radius:
                    50%;

                background:
                    currentColor;
            }

            /* ====================================================
               MESSAGES
               ==================================================== */

            .somtoday-chat-messages {

                flex:
                    1 1 auto;

                min-height:
                    0;

                overflow-y:
                    auto;

                overflow-x:
                    hidden;

                padding:
                    20px;

                box-sizing:
                    border-box;

                background:
                    var(
                        --bg-neutral-weakest,
                        #f8f8f8
                    );
            }

            .somtoday-chat-empty {

                display:
                    flex;

                align-items:
                    center;

                justify-content:
                    center;

                min-height:
                    180px;

                text-align:
                    center;

                color:
                    var(
                        --text-weak,
                        #777
                    );

                font-size:
                    14px;
            }

            .somtoday-chat-message {

                display:
                    flex;

                flex-direction:
                    column;

                max-width:
                    min(75%, 600px);

                margin-bottom:
                    12px;
            }

            .somtoday-chat-message.mine {

                margin-left:
                    auto;

                align-items:
                    flex-end;
            }

            .somtoday-chat-message.other {

                margin-right:
                    auto;

                align-items:
                    flex-start;
            }

            .somtoday-chat-message-name {

                margin:
                    0 8px 4px;

                font-size:
                    12px;

                line-height:
                    16px;

                color:
                    var(
                        --text-weak,
                        #777
                    );
            }

            .somtoday-chat-bubble {

                padding:
                    9px 12px;

                border:
                    1px solid
                    var(
                        --border-neutral-weak,
                        #e0e0e0
                    );

                border-radius:
                    10px;

                background:
                    var(
                        --bg-elevated-none,
                        #fff
                    );

                color:
                    var(
                        --text-strong,
                        #222
                    );

                font-size:
                    14px;

                line-height:
                    20px;

                white-space:
                    pre-wrap;

                overflow-wrap:
                    anywhere;
            }

            .somtoday-chat-message.mine
            .somtoday-chat-bubble {

                background:
                    var(
                        --action-primary-normal,
                        #3565d4
                    );

                color:
                    #fff;

                border-color:
                    transparent;
            }

            .somtoday-chat-message-time {

                margin:
                    3px 8px 0;

                font-size:
                    10px;

                line-height:
                    13px;

                color:
                    var(
                        --text-weak,
                        #888
                    );
            }

            /* ====================================================
               COMPOSER
               ==================================================== */

            .somtoday-chat-composer {

                display:
                    flex;

                align-items:
                    flex-end;

                gap:
                    8px;

                flex:
                    0 0 auto;

                padding:
                    12px 14px;

                box-sizing:
                    border-box;

                border-top:
                    1px solid
                    var(
                        --border-neutral-weak,
                        #e5e5e5
                    );

                background:
                    var(
                        --bg-elevated-none,
                        #fff
                    );
            }

            .somtoday-chat-input {

                flex:
                    1 1 auto;

                min-width:
                    0;

                min-height:
                    40px;

                max-height:
                    120px;

                resize:
                    vertical;

                box-sizing:
                    border-box;

                padding:
                    9px 11px;

                border:
                    1px solid
                    var(
                        --border-neutral-normal,
                        #d6d6d6
                    );

                border-radius:
                    7px;

                outline:
                    none;

                background:
                    var(
                        --bg-neutral-none,
                        #fff
                    );

                color:
                    var(
                        --text-strong,
                        #222
                    );

                font-family:
                    inherit;

                font-size:
                    14px;

                line-height:
                    20px;
            }

            .somtoday-chat-input:focus {

                border-color:
                    var(
                        --action-primary-normal,
                        #3565d4
                    );

                box-shadow:
                    0 0 0 1px
                    var(
                        --action-primary-normal,
                        #3565d4
                    );
            }

            .somtoday-chat-input::placeholder {

                color:
                    var(
                        --text-weak,
                        #888
                    );
            }

            .somtoday-chat-send {

                flex:
                    0 0 auto;

                height:
                    40px;

                padding:
                    0 15px;

                border:
                    0;

                border-radius:
                    7px;

                cursor:
                    pointer;

                background:
                    var(
                        --action-primary-normal,
                        #3565d4
                    );

                color:
                    #fff;

                font-family:
                    inherit;

                font-size:
                    14px;

                font-weight:
                    600;
            }

            .somtoday-chat-send:hover {

                background:
                    var(
                        --action-primary-strong,
                        #2853bd
                    );
            }

            .somtoday-chat-send:disabled {

                opacity:
                    .55;

                cursor:
                    default;
            }

            /* ====================================================
               MOBILE
               ==================================================== */

            @media (max-width: 700px) {

                #somtoday-school-chat-tab
                .somtoday-chat-tab-inner {

                    padding:
                        0 10px;

                    gap:
                        6px;
                }

                #somtoday-school-chat-tab
                .somtoday-chat-tab-label {

                    display:
                        none;
                }

                #somtoday-school-chat-panel {

                    left:
                        0 !important;

                    right:
                        0 !important;

                    top:
                        0 !important;

                    bottom:
                        0 !important;

                    width:
                        100% !important;

                    height:
                        100% !important;

                    border:
                        0;

                    border-radius:
                        0;
                }

                .somtoday-chat-message {

                    max-width:
                        86%;
                }
            }
        `;

        document.head.appendChild(
            style
        );
    }

    // ============================================================
    // FIND TAB BAR
    // ============================================================

    function findTabBar() {

        const normal =
            document.querySelector(
                "sl-tab-bar"
            );

        if (normal) {
            return normal;
        }

        function search(root) {

            if (!root) {
                return null;
            }

            const direct =
                root.querySelector?.(
                    "sl-tab-bar"
                );

            if (direct) {
                return direct;
            }

            const all =
                root.querySelectorAll?.(
                    "*"
                ) || [];

            for (
                const element of all
            ) {

                if (
                    element.shadowRoot
                ) {

                    const found =
                        search(
                            element.shadowRoot
                        );

                    if (found) {
                        return found;
                    }
                }
            }

            return null;
        }

        return search(
            document
        );
    }

    // ============================================================
    // CREATE CHAT TAB
    // ============================================================

    function createChatTab() {

        if (
            chatTab &&
            chatTab.isConnected
        ) {

            return chatTab;
        }

        const tabBar =
            findTabBar();

        if (!tabBar) {
            return null;
        }

        const existing =
            document.getElementById(
                "somtoday-school-chat-tab"
            );

        if (existing) {

            chatTab =
                existing;

            return existing;
        }

        const tab =
            document.createElement(
                "div"
            );

        tab.id =
            "somtoday-school-chat-tab";

        tab.setAttribute(
            "role",
            "tab"
        );

        tab.setAttribute(
            "aria-selected",
            "false"
        );

        tab.setAttribute(
            "tabindex",
            "0"
        );

        tab.innerHTML = `

            <div
                class="somtoday-chat-active-top"
            ></div>

            <div
                class="somtoday-chat-tab-inner"
            >

                <span
                    class="somtoday-chat-tab-icon"
                    aria-hidden="true"
                >

                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        display="block"
                    >

                        <path
                            d="M4.332 24C1.94 24.002 0 22.076 0 19.698V6.204c0-2.375 1.938-4.301 4.328-4.301h5.509a1.27 1.27 0 0 1 1.273 1.265 1.27 1.27 0 0 1-1.273 1.265h-5.51c-.983 0-1.781.793-1.781 1.771v13.495c0 .98.799 1.773 1.784 1.772l13.32-.014a1.777 1.777 0 0 0 1.78-1.77v-4.35c0-.7.57-1.266 1.272-1.266a1.27 1.27 0 0 1 1.273 1.265v4.35c0 2.374-1.935 4.3-4.323 4.302z"
                        ></path>

                    </svg>

                </span>

                <span
                    class="somtoday-chat-tab-label"
                >
                    Chat
                </span>

            </div>

            <div
                class="somtoday-chat-active-bottom"
            ></div>
        `;

        tab.addEventListener(
            "click",
            () => {

                toggleChat();
            }
        );

        tab.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter" ||
                    event.key === " "
                ) {

                    event.preventDefault();

                    toggleChat();
                }
            }
        );

        /*
         * Achter de laatste Somtoday-tab.
         */

        tabBar.appendChild(
            tab
        );

        chatTab =
            tab;

        log(
            "Chat-tab toegevoegd."
        );

        return tab;
    }

    // ============================================================
    // CREATE CHAT PANEL
    // ============================================================

    function createChatPanel() {

        if (
            chatPanel &&
            chatPanel.isConnected
        ) {

            return chatPanel;
        }

        const existing =
            document.getElementById(
                "somtoday-school-chat-panel"
            );

        if (existing) {

            chatPanel =
                existing;

            messagesContainer =
                document.getElementById(
                    "somtoday-chat-messages"
                );

            messageInput =
                document.getElementById(
                    "somtoday-chat-input"
                );

            sendButton =
                document.getElementById(
                    "somtoday-chat-send"
                );

            statusElement =
                document.getElementById(
                    "somtoday-chat-status"
                );

            return existing;
        }

        const panel =
            document.createElement(
                "section"
            );

        panel.id =
            "somtoday-school-chat-panel";

        panel.setAttribute(
            "aria-label",
            "School Chat"
        );

        panel.innerHTML = `

            <div
                class="somtoday-chat-header"
            >

                <div
                    class="somtoday-chat-header-left"
                >

                    <div
                        class="somtoday-chat-title"
                    >
                        School Chat
                    </div>

                    <div
                        class="somtoday-chat-school"
                        id="somtoday-chat-school"
                    >
                    </div>

                </div>

                <div
                    class="somtoday-chat-header-status"
                >

                    <span
                        class="somtoday-chat-status-dot"
                    ></span>

                    <span
                        id="somtoday-chat-status"
                    >
                        Verbinden...
                    </span>

                </div>

            </div>

            <div
                class="somtoday-chat-messages"
                id="somtoday-chat-messages"
            >

                <div
                    class="somtoday-chat-empty"
                    id="somtoday-chat-empty"
                >
                    Nog geen berichten.
                </div>

            </div>

            <div
                class="somtoday-chat-composer"
            >

                <textarea
                    id="somtoday-chat-input"
                    class="somtoday-chat-input"
                    placeholder="Typ een bericht..."
                    maxlength="2000"
                    rows="1"
                ></textarea>

                <button
                    id="somtoday-chat-send"
                    class="somtoday-chat-send"
                    type="button"
                >
                    Sturen
                </button>

            </div>
        `;

        document.body.appendChild(
            panel
        );

        chatPanel =
            panel;

        messagesContainer =
            document.getElementById(
                "somtoday-chat-messages"
            );

        messageInput =
            document.getElementById(
                "somtoday-chat-input"
            );

        sendButton =
            document.getElementById(
                "somtoday-chat-send"
            );

        statusElement =
            document.getElementById(
                "somtoday-chat-status"
            );

        const schoolElement =
            document.getElementById(
                "somtoday-chat-school"
            );

        if (schoolElement) {

            schoolElement.textContent =
                currentUser?.vestiging ||
                "School";
        }

        sendButton.addEventListener(
            "click",
            sendMessage
        );

        messageInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    sendMessage();
                }
            }
        );

        messageInput.addEventListener(
            "input",
            autoResizeInput
        );

        return panel;
    }

    // ============================================================
    // INPUT RESIZE
    // ============================================================

    function autoResizeInput() {

        if (!messageInput) {
            return;
        }

        messageInput.style.height =
            "auto";

        messageInput.style.height =
            Math.min(
                messageInput.scrollHeight,
                120
            ) + "px";
    }

    // ============================================================
    // STATUS
    // ============================================================

    function setStatus(text) {

        if (!statusElement) {
            return;
        }

        statusElement.textContent =
            String(text);
    }

    // ============================================================
    // RENDER MESSAGE
    // ============================================================

    function renderMessage(
        message
    ) {

        if (!messagesContainer) {
            return;
        }

        const empty =
            document.getElementById(
                "somtoday-chat-empty"
            );

        if (empty) {
            empty.remove();
        }

        const mine =
            String(
                message.userId
            ) ===
            String(
                currentUser.id
            );

        const wrapper =
            document.createElement(
                "div"
            );

        wrapper.className =
            "somtoday-chat-message " +
            (
                mine
                    ? "mine"
                    : "other"
            );

        const name =
            document.createElement(
                "div"
            );

        name.className =
            "somtoday-chat-message-name";

        name.textContent =
            mine
                ? "Jij"
                : message.name;

        const bubble =
            document.createElement(
                "div"
            );

        bubble.className =
            "somtoday-chat-bubble";

        /*
         * textContent zodat berichten geen HTML
         * kunnen injecteren.
         */

        bubble.textContent =
            message.text;

        const time =
            document.createElement(
                "div"
            );

        time.className =
            "somtoday-chat-message-time";

        const date =
            new Date(
                message.timestamp
            );

        time.textContent =
            date.toLocaleTimeString(
                "nl-NL",
                {
                    hour:
                        "2-digit",

                    minute:
                        "2-digit"
                }
            );

        wrapper.appendChild(
            name
        );

        wrapper.appendChild(
            bubble
        );

        wrapper.appendChild(
            time
        );

        messagesContainer.appendChild(
            wrapper
        );

        messagesContainer.scrollTop =
            messagesContainer.scrollHeight;
    }

    // ============================================================
    // POSITION
    // ============================================================

    function positionChatPanel() {

        if (!chatPanel) {
            return;
        }

        if (
            window.innerWidth <= 700
        ) {

            chatPanel.style.left =
                "0";

            chatPanel.style.top =
                "0";

            chatPanel.style.width =
                "100%";

            chatPanel.style.height =
                "100%";

            return;
        }

        const header =
            document.querySelector(
                "sl-header"
            );

        if (!header) {
            return;
        }

        const rect =
            header.getBoundingClientRect();

        const top =
            Math.max(
                0,
                rect.bottom
            );

        chatPanel.style.left =
            "0";

        chatPanel.style.top =
            `${top}px`;

        chatPanel.style.width =
            "100%";

        chatPanel.style.height =
            `calc(100vh - ${top}px)`;
    }

    // ============================================================
    // HIDE SOMTODAY CONTENT
    // ============================================================

    function hideSomtodayContent() {

        hiddenElements = [];

        const header =
            document.querySelector(
                "sl-header"
            );

        const bodyChildren =
            Array.from(
                document.body.children
            );

        for (
            const element of bodyChildren
        ) {

            if (
                element === chatPanel ||
                element === header ||
                element.id ===
                    "somtoday-school-chat-style" ||
                element.tagName ===
                    "SCRIPT"
            ) {
                continue;
            }

            const rect =
                element.getBoundingClientRect();

            if (
                rect.height > 100 &&
                rect.width > 200
            ) {

                hiddenElements.push({

                    element:
                        element,

                    display:
                        element.style.display
                });

                element.style.display =
                    "none";
            }
        }
    }

    // ============================================================
    // SHOW SOMTODAY CONTENT
    // ============================================================

    function showSomtodayContent() {

        for (
            const item of hiddenElements
        ) {

            if (
                item.element &&
                item.element.isConnected
            ) {

                item.element.style.display =
                    item.display;
            }
        }

        hiddenElements = [];
    }

    // ============================================================
    // OPEN CHAT
    // ============================================================

    function openChat() {

        if (!chatPanel) {

            createChatPanel();
        }

        if (!chatPanel) {
            return;
        }

        chatOpen =
            true;

        chatPanel.classList.add(
            "open"
        );

        if (chatTab) {

            chatTab.classList.add(
                "active"
            );

            chatTab.setAttribute(
                "aria-selected",
                "true"
            );
        }

        positionChatPanel();

        hideSomtodayContent();

        setTimeout(
            () => {

                messageInput?.focus();

            },
            50
        );
    }

    // ============================================================
    // CLOSE CHAT
    // ============================================================

    function closeChat() {

        if (!chatPanel) {
            return;
        }

        chatOpen =
            false;

        chatPanel.classList.remove(
            "open"
        );

        if (chatTab) {

            chatTab.classList.remove(
                "active"
            );

            chatTab.setAttribute(
                "aria-selected",
                "false"
            );
        }

        showSomtodayContent();
    }

    // ============================================================
    // TOGGLE CHAT
    // ============================================================

    function toggleChat() {

        if (chatOpen) {

            closeChat();

        } else {

            openChat();
        }
    }

    // ============================================================
    // OBSERVER
    // ============================================================

    function setupObserver() {

        if (observer) {
            return;
        }

        observer =
            new MutationObserver(
                () => {

                    /*
                     * Angular kan de header opnieuw
                     * renderen.
                     */

                    if (
                        !chatTab?.isConnected
                    ) {

                        chatTab =
                            null;

                        createChatTab();
                    }

                    if (
                        !chatPanel?.isConnected
                    ) {

                        const wasOpen =
                            chatOpen;

                        chatPanel =
                            null;

                        createChatPanel();

                        if (wasOpen) {

                            openChat();
                        }
                    }
                }
            );

        observer.observe(
            document.body,
            {
                childList:
                    true,

                subtree:
                    true
            }
        );
    }

    // ============================================================
    // WINDOW EVENTS
    // ============================================================

    function setupWindowEvents() {

        window.addEventListener(
            "resize",
            () => {

                if (chatOpen) {

                    positionChatPanel();
                }
            }
        );
    }

    // ============================================================
    // WAIT FOR SOMTODAY UI
    // ============================================================

    async function waitForSomtodayUI() {

        const start =
            Date.now();

        while (
            Date.now() - start <
            CONFIG.startupTimeout
        ) {

            const tabBar =
                findTabBar();

            if (tabBar) {

                return;
            }

            await sleep(
                250
            );
        }

        throw new Error(
            "Somtoday sl-tab-bar niet gevonden."
        );
    }

    // ============================================================
    // START
    // ============================================================

    async function start() {

        try {

            log(
                "Somtoday School Chat starten..."
            );

            /*
             * CSS.
             */

            injectStyles();

            /*
             * Luister naar de PubNub bridge.
             */

            setupPubNubMessageListener();

            /*
             * Installeer bridge vóórdat we
             * PubNub proberen te gebruiken.
             */

            installPubNubBridge();

            /*
             * Somtoday gebruiker.
             */

            currentUser =
                await findSomtodayUser();

            log(
                "Gebruiker:",
                currentUser
            );

            /*
             * Schoolkanaal.
             */

            await prepareChannel();

            /*
             * Wacht op Somtoday header.
             */

            await waitForSomtodayUI();

            /*
             * UI maken.
             */

            createChatTab();

            createChatPanel();

            setupObserver();

            setupWindowEvents();

            setStatus(
                "Verbinden..."
            );

            /*
             * Bridge kan BRIDGE_READY al hebben
             * gestuurd voordat de listener klaar was.
             *
             * Daarom sturen we hier zelf ook CONNECT.
             */

            connectPubNub();

            /*
             * ====================================================
             * 3 SECONDEN WACHTEN
             * ====================================================
             *
             * De chat wordt dus niet meteen geopend.
             */

            log(
                "Chat opent over",
                CONFIG.popupDelay / 1000,
                "seconden..."
            );

            setTimeout(
                () => {

                    /*
                     * Alleen openen als de UI nog bestaat.
                     */

                    if (
                        chatPanel &&
                        chatTab
                    ) {

                        log(
                            "Chat openen."
                        );

                        openChat();
                    }

                },
                CONFIG.popupDelay
            );

            log(
                "Somtoday School Chat klaar."
            );

        } catch (err) {

            error(
                "Chat starten mislukt:",
                err
            );

            window.__SOMTODAY_SCHOOL_CHAT_RUNNING__ =
                false;
        }
    }

    // ============================================================
    // START
    // ============================================================

    start();

})();
