(() => {
    "use strict";

    /*
     * ============================================================
     * SOMTODAY SCHOOL CHAT
     * ============================================================
     */

    const CONFIG = {
        // DEMO PUBNUB KEYS
        publishKey: "demo",
        subscribeKey: "demo",

        pubnubScript:
            "https://cdn.pubnub.com/sdk/javascript/pubnub.10.2.0.min.js",

        channelPrefix: "school",

        maxMessages: 100
    };


    let schoolInfo = null;
    let pubnub = null;

    let popup = null;
    let messagesContainer = null;
    let input = null;

    let isOpen = false;
    let initialized = false;

    let pubnubReady = false;


    /*
     * ============================================================
     * LOGGING
     * ============================================================
     */

    function log(...args) {
        console.log("[Somtoday Chat]", ...args);
    }

    function warn(...args) {
        console.warn("[Somtoday Chat]", ...args);
    }

    function error(...args) {
        console.error("[Somtoday Chat]", ...args);
    }


    /*
     * ============================================================
     * SAFE STRING
     * ============================================================
     */

    function safeString(value) {

        try {

            if (
                value === null ||
                value === undefined
            ) {
                return "";
            }

            return String(value).trim();

        } catch {

            return "";
        }
    }


    /*
     * ============================================================
     * SOMTODAY AUTH OBJECT
     * ============================================================
     */

    function looksLikeSomtodayAuth(obj) {

        try {

            if (
                !obj ||
                typeof obj !== "object"
            ) {
                return false;
            }


            if (
                obj.currentLeerling &&
                typeof obj.currentLeerling === "object"
            ) {

                const leerling =
                    obj.currentLeerling;

                return !!(
                    leerling.uuid ||
                    leerling.vestiging
                );
            }

        } catch {}

        return false;
    }


    /*
     * ============================================================
     * OBJECT SCANNER
     * ============================================================
     */

    function findAuthInObject(
        obj,
        depth,
        seen
    ) {

        if (
            !obj ||
            typeof obj !== "object"
        ) {
            return null;
        }


        if (depth > 6) {
            return null;
        }


        try {

            if (seen.has(obj)) {
                return null;
            }

            seen.add(obj);

        } catch {

            return null;
        }


        if (
            looksLikeSomtodayAuth(obj)
        ) {

            return obj;
        }


        let keys;

        try {

            keys =
                Object.keys(obj);

        } catch {

            return null;
        }


        for (const key of keys) {

            if (
                key === "self" ||
                key === "window" ||
                key === "top" ||
                key === "parent" ||
                key === "document" ||
                key === "location" ||
                key === "navigator" ||
                key === "performance" ||
                key === "history"
            ) {
                continue;
            }


            let value;

            try {

                value =
                    obj[key];

            } catch {

                continue;
            }


            if (
                !value ||
                typeof value !== "object"
            ) {
                continue;
            }


            const result =
                findAuthInObject(
                    value,
                    depth + 1,
                    seen
                );


            if (result) {
                return result;
            }
        }


        return null;
    }


    /*
     * ============================================================
     * STORAGE
     * ============================================================
     */

    function searchStorage(
        storage,
        storageName
    ) {

        try {

            for (
                let i = 0;
                i < storage.length;
                i++
            ) {

                const key =
                    storage.key(i);


                if (!key) {
                    continue;
                }


                let raw;

                try {

                    raw =
                        storage.getItem(key);

                } catch {

                    continue;
                }


                if (!raw) {
                    continue;
                }


                if (
                    !raw.includes(
                        "currentLeerling"
                    ) &&
                    !raw.includes(
                        "allAuthenticationRecords"
                    ) &&
                    !raw.includes(
                        "organisatieUUID"
                    ) &&
                    !raw.includes(
                        "vestiging"
                    )
                ) {
                    continue;
                }


                try {

                    const parsed =
                        JSON.parse(raw);


                    if (
                        looksLikeSomtodayAuth(
                            parsed
                        )
                    ) {

                        log(
                            "Somtoday-data gevonden in",
                            storageName,
                            key
                        );

                        return parsed;
                    }


                    const nested =
                        findAuthInObject(
                            parsed,
                            0,
                            new WeakSet()
                        );


                    if (nested) {

                        log(
                            "Somtoday-data gevonden in",
                            storageName,
                            key
                        );

                        return nested;
                    }

                } catch {}

            }

        } catch (e) {

            warn(
                "Storage scan mislukt:",
                storageName,
                e
            );
        }


        return null;
    }


    /*
     * ============================================================
     * SOMTODAY DATA
     * ============================================================
     */

    function findSomtodayData() {

        let data =
            searchStorage(
                sessionStorage,
                "sessionStorage"
            );


        if (data) {
            return data;
        }


        data =
            searchStorage(
                localStorage,
                "localStorage"
            );


        if (data) {
            return data;
        }


        /*
         * Bekende globals.
         */

        const names = [

            "authentication",
            "authenticationData",
            "authData",
            "sessionData",
            "accountData",
            "currentSession",
            "currentUser",
            "userData",
            "__SOMTODAY__",
            "__SOMTODAY_DATA__",
            "__INITIAL_STATE__",
            "__INITIAL_DATA__"

        ];


        for (const name of names) {

            try {

                const value =
                    window[name];


                if (
                    looksLikeSomtodayAuth(
                        value
                    )
                ) {

                    log(
                        "Somtoday-data gevonden via",
                        name
                    );

                    return value;
                }

            } catch {}
        }


        return null;
    }


    /*
     * ============================================================
     * CURRENT LEERLING
     * ============================================================
 */

    function getCurrentStudent(
        authData
    ) {

        try {

            if (
                authData.currentLeerling
            ) {

                return (
                    authData.currentLeerling
                );
            }

        } catch {}


        try {

            const records =
                authData.allAuthenticationRecords;


            if (
                Array.isArray(records)
            ) {

                for (
                    const record
                    of records
                ) {

                    try {

                        if (
                            Array.isArray(
                                record.subLeerlingen
                            ) &&
                            record.subLeerlingen.length
                        ) {

                            return (
                                record.subLeerlingen[0]
                            );
                        }

                    } catch {}
                }
            }

        } catch {}


        return null;
    }


    /*
     * ============================================================
     * ORGANIZATION ID
     * ============================================================
 */

    function getOrganizationId(
        authData
    ) {

        try {

            if (
                authData.organisatieUUID
            ) {

                return safeString(
                    authData.organisatieUUID
                );
            }

        } catch {}


        try {

            const records =
                authData.allAuthenticationRecords;


            if (
                Array.isArray(records)
            ) {

                for (
                    const record
                    of records
                ) {

                    try {

                        if (
                            record.organisatieUUID
                        ) {

                            return safeString(
                                record.organisatieUUID
                            );
                        }

                    } catch {}
                }
            }

        } catch {}


        return "";
    }


    /*
     * ============================================================
     * ORGANIZATION NAME
     * ============================================================
 */

    function getOrganizationName(
        authData
    ) {

        try {

            if (
                authData.schoolnaam
            ) {

                return safeString(
                    authData.schoolnaam
                );
            }

        } catch {}


        try {

            const records =
                authData.allAuthenticationRecords;


            if (
                Array.isArray(records)
            ) {

                for (
                    const record
                    of records
                ) {

                    try {

                        if (
                            record.schoolnaam
                        ) {

                            return safeString(
                                record.schoolnaam
                            );
                        }

                    } catch {}
                }
            }

        } catch {}


        return "";
    }


    /*
     * ============================================================
     * SHA-256
     * ============================================================
 */

    async function makeHash(
        value
    ) {

        const text =
            safeString(value);


        if (
            window.crypto &&
            window.crypto.subtle
        ) {

            const bytes =
                new TextEncoder()
                    .encode(text);


            const buffer =
                await window.crypto.subtle.digest(
                    "SHA-256",
                    bytes
                );


            return Array
                .from(
                    new Uint8Array(buffer)
                )
                .map(
                    byte =>
                        byte
                            .toString(16)
                            .padStart(2, "0")
                )
                .join("");
        }


        /*
         * Fallback hash.
         */

        let hash =
            2166136261;


        for (
            let i = 0;
            i < text.length;
            i++
        ) {

            hash ^=
                text.charCodeAt(i);

            hash +=
                (hash << 1) +
                (hash << 4) +
                (hash << 7) +
                (hash << 8) +
                (hash << 24);
        }


        return (
            hash >>> 0
        ).toString(16);
    }


    /*
     * ============================================================
     * SCHOOL INFO
     * ============================================================
 */

    async function getSchoolInfo() {

        log(
            "Somtoday schoolgegevens zoeken..."
        );


        const authData =
            findSomtodayData();


        if (!authData) {

            warn(
                "Geen Somtoday authentication-data gevonden."
            );

            return null;
        }


        const student =
            getCurrentStudent(
                authData
            );


        if (!student) {

            warn(
                "Geen huidige leerling gevonden."
            );

            return null;
        }


        const organizationId =
            getOrganizationId(
                authData
            );


        const organizationName =
            getOrganizationName(
                authData
            );


        const locationName =
            safeString(
                student.vestiging
            );


        /*
         * Dit is de echte Somtoday-leerling UUID.
         */

        const userId =
            safeString(
                student.uuid
            );


        const displayName =
            safeString(
                student.nn ||
                student.voornaam ||
                student.gn ||
                "Leerling"
            );


        if (!organizationId) {

            warn(
                "organisatieUUID ontbreekt."
            );

            return null;
        }


        if (!locationName) {

            warn(
                "vestiging ontbreekt."
            );

            return null;
        }


        if (!userId) {

            warn(
                "leerling UUID ontbreekt."
            );

            return null;
        }


        /*
         * School = organisatie + vestiging.
         */

        const schoolIdentity =
            `${organizationId}:${locationName}`;


        const schoolHash =
            await makeHash(
                schoolIdentity
            );


        /*
         * Schoolbreed channel.
         */

        const channel =
            `${CONFIG.channelPrefix}.${schoolHash.slice(0, 24)}.general`;


        const result = {

            organizationId,

            organizationName,

            locationName,

            schoolIdentity,

            schoolHash,

            channel,

            userId,

            displayName
        };


        log(
            "School gevonden:",
            result
        );


        return result;
    }


    /*
     * ============================================================
     * PUBNUB SCRIPT
     * ============================================================
 */

    function loadPubNub() {

        return new Promise(
            (resolve, reject) => {

                if (
                    window.PubNub
                ) {

                    resolve();
                    return;
                }


                const oldScript =
                    document.querySelector(
                        "script[data-somtoday-pubnub]"
                    );


                if (oldScript) {

                    oldScript.addEventListener(
                        "load",
                        resolve,
                        {
                            once: true
                        }
                    );


                    oldScript.addEventListener(
                        "error",
                        () =>
                            reject(
                                new Error(
                                    "PubNub SDK laden mislukt."
                                )
                            ),
                        {
                            once: true
                        }
                    );


                    return;
                }


                const script =
                    document.createElement(
                        "script"
                    );


                script.dataset.somtodayPubnub =
                    "true";


                script.src =
                    CONFIG.pubnubScript;


                script.async = true;


                script.onload =
                    () => resolve();


                script.onerror =
                    () =>
                        reject(
                            new Error(
                                "PubNub SDK kon niet worden geladen."
                            )
                        );


                document.head.appendChild(
                    script
                );
            }
        );
    }


    /*
     * ============================================================
     * CSS
     * ============================================================
 */

    function addStyles() {

        if (
            document.getElementById(
                "somtoday-chat-style"
            )
        ) {
            return;
        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            "somtoday-chat-style";


        style.textContent = `

#somtoday-chat-popup {

    position: fixed;

    right: 24px;
    bottom: 24px;

    width: 390px;

    max-width:
        calc(100vw - 32px);

    height: 560px;

    max-height:
        calc(100vh - 48px);

    background: #fff;

    border:
        1px solid #d9dce1;

    border-radius: 14px;

    box-shadow:
        0 10px 30px rgba(0,0,0,.12),
        0 2px 8px rgba(0,0,0,.06);

    display: none;

    flex-direction: column;

    overflow: hidden;

    z-index: 2147483640;

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        Arial,
        sans-serif;

    color: #25282d;
}


#somtoday-chat-header {

    height: 58px;

    min-height: 58px;

    display: flex;

    align-items: center;

    justify-content:
        space-between;

    padding:
        0 14px 0 18px;

    border-bottom:
        1px solid #e5e7eb;

    background: #fff;
}


#somtoday-chat-title {
    min-width: 0;
}


#somtoday-chat-title-main {

    font-size: 16px;

    font-weight: 600;
}


#somtoday-chat-title-school {

    margin-top: 2px;

    font-size: 12px;

    color: #777d86;

    white-space: nowrap;

    overflow: hidden;

    text-overflow: ellipsis;

    max-width: 270px;
}


#somtoday-chat-close {

    width: 32px;
    height: 32px;

    border: 0;

    border-radius: 7px;

    background: transparent;

    cursor: pointer;

    font-size: 22px;

    color: #70757d;
}


#somtoday-chat-close:hover {

    background: #f1f2f4;
}


#somtoday-chat-info {

    padding:
        7px 14px;

    border-bottom:
        1px solid #e5e7eb;

    background: #f7f8f9;

    font-size: 11px;

    color: #777d86;
}


#somtoday-chat-messages {

    flex: 1;

    min-height: 0;

    overflow-y: auto;

    padding: 14px;

    display: flex;

    flex-direction: column;

    gap: 8px;
}


#somtoday-chat-empty {

    margin: auto;

    padding: 30px;

    text-align: center;

    color: #888e97;

    font-size: 13px;
}


.somtoday-chat-message {

    display: flex;

    flex-direction: column;

    max-width: 82%;

    align-self:
        flex-start;
}


.somtoday-chat-message.mine {

    align-self:
        flex-end;

    align-items:
        flex-end;
}


.somtoday-chat-message-name {

    margin:
        0 6px 3px;

    font-size: 11px;

    color: #747a83;
}


.somtoday-chat-message-bubble {

    padding:
        8px 11px;

    border-radius:
        10px;

    background:
        #f0f1f3;

    font-size: 14px;

    line-height: 19px;

    white-space: pre-wrap;

    overflow-wrap:
        anywhere;
}


.somtoday-chat-message.mine
.somtoday-chat-message-bubble {

    background:
        #e8e9eb;
}


.somtoday-chat-message-time {

    margin:
        3px 6px 0;

    font-size: 10px;

    color: #969ba3;
}


#somtoday-chat-input-area {

    display: flex;

    align-items:
        flex-end;

    gap: 8px;

    padding: 10px;

    border-top:
        1px solid #e5e7eb;
}


#somtoday-chat-input {

    flex: 1;

    min-width: 0;

    max-height: 120px;

    resize: none;

    border:
        1px solid #d5d8dd;

    border-radius:
        9px;

    outline: none;

    padding:
        9px 10px;

    font-family:
        inherit;

    font-size:
        14px;

    line-height:
        19px;
}


#somtoday-chat-input:focus {

    border-color:
        #aeb3ba;
}


#somtoday-chat-send {

    width: 38px;
    height: 38px;

    border: 0;

    border-radius:
        9px;

    background:
        #e6e7e9;

    color:
        #30343a;

    cursor: pointer;

    font-size: 18px;
}


#somtoday-chat-send:hover {

    background:
        #dcdde0;
}


#somtoday-chat-send:disabled {

    opacity: .45;

    cursor: default;
}


@media (max-width: 600px) {

    #somtoday-chat-popup {

        left: 8px;

        right: 8px;

        bottom: 8px;

        width: auto;

        max-width: none;

        height:
            calc(100vh - 16px);

        max-height:
            calc(100vh - 16px);

        border-radius: 12px;
    }
}

        `;


        document.head.appendChild(
            style
        );
    }


    /*
     * ============================================================
     * POPUP
     * ============================================================
 */

    function createPopup() {

        if (
            document.getElementById(
                "somtoday-chat-popup"
            )
        ) {

            popup =
                document.getElementById(
                    "somtoday-chat-popup"
                );

            messagesContainer =
                document.getElementById(
                    "somtoday-chat-messages"
                );

            input =
                document.getElementById(
                    "somtoday-chat-input"
                );

            return;
        }


        popup =
            document.createElement(
                "div"
            );


        popup.id =
            "somtoday-chat-popup";


        popup.innerHTML = `

            <div id="somtoday-chat-header">

                <div id="somtoday-chat-title">

                    <div id="somtoday-chat-title-main">
                        Chat
                    </div>

                    <div id="somtoday-chat-title-school">
                        Schoolbrede chat
                    </div>

                </div>

                <button
                    id="somtoday-chat-close"
                    type="button"
                    aria-label="Sluiten"
                >×</button>

            </div>


            <div id="somtoday-chat-info">
                Verbinden met schoolchat...
            </div>


            <div id="somtoday-chat-messages">

                <div id="somtoday-chat-empty">
                    Nog geen berichten.
                </div>

            </div>


            <div id="somtoday-chat-input-area">

                <textarea
                    id="somtoday-chat-input"
                    rows="1"
                    placeholder="Typ een bericht..."
                    autocomplete="off"
                    spellcheck="true"
                    disabled
                ></textarea>

                <button
                    id="somtoday-chat-send"
                    type="button"
                    disabled
                >↑</button>

            </div>

        `;


        document.body.appendChild(
            popup
        );


        messagesContainer =
            document.getElementById(
                "somtoday-chat-messages"
            );


        input =
            document.getElementById(
                "somtoday-chat-input"
            );


        document
            .getElementById(
                "somtoday-chat-close"
            )
            .addEventListener(
                "click",
                closeChat
            );


        document
            .getElementById(
                "somtoday-chat-send"
            )
            .addEventListener(
                "click",
                sendMessage
            );


        input.addEventListener(
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


        input.addEventListener(
            "input",
            () => {

                input.style.height =
                    "auto";

                input.style.height =
                    Math.min(
                        input.scrollHeight,
                        120
                    ) + "px";
            }
        );
    }


    /*
     * ============================================================
     * ENABLE INPUT
     * ============================================================
 */

    function setChatReady(ready) {

        if (input) {
            input.disabled = !ready;
        }


        const button =
            document.getElementById(
                "somtoday-chat-send"
            );


        if (button) {
            button.disabled = !ready;
        }
    }


    /*
     * ============================================================
     * TAB
     * ============================================================
 */

    function findTabBar() {

        const direct =
            document.querySelector(
                "sl-tab-bar"
            );


        if (direct) {
            return direct;
        }


        function searchShadow(root) {

            if (!root) {
                return null;
            }


            const found =
                root.querySelector?.(
                    "sl-tab-bar"
                );


            if (found) {
                return found;
            }


            const elements =
                root.querySelectorAll?.(
                    "*"
                ) || [];


            for (
                const element
                of elements
            ) {

                try {

                    if (
                        element.shadowRoot
                    ) {

                        const result =
                            searchShadow(
                                element.shadowRoot
                            );


                        if (result) {
                            return result;
                        }
                    }

                } catch {}
            }


            return null;
        }


        return searchShadow(
            document.documentElement
        );
    }


    function addChatTab() {

        if (
            document.getElementById(
                "somtoday-chat-tab"
            )
        ) {
            return true;
        }


        const tabBar =
            findTabBar();


        if (!tabBar) {
            return false;
        }


        let template = null;


        try {

            template =
                tabBar.querySelector(
                    "sl-tab"
                );

        } catch {}


        let tab;


        if (template) {

            tab =
                template.cloneNode(
                    true
                );

        } else {

            tab =
                document.createElement(
                    "sl-tab"
                );
        }


        tab.id =
            "somtoday-chat-tab";


        tab.setAttribute(
            "slot",
            "nav"
        );


        tab.setAttribute(
            "panel",
            "somtoday-chat-panel"
        );


        tab.textContent =
            "Chat";


        tab.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();

                openChat();

            },
            true
        );


        try {

            tabBar.appendChild(
                tab
            );

        } catch (e) {

            warn(
                "Chat-tab toevoegen mislukt:",
                e
            );

            return false;
        }


        log(
            "Chat-tab toegevoegd."
        );


        return true;
    }


    function startTabWatcher() {

        if (!document.body) {
            return;
        }


        const observer =
            new MutationObserver(
                () => {

                    if (
                        !document.getElementById(
                            "somtoday-chat-tab"
                        )
                    ) {

                        addChatTab();
                    }

                }
            );


        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );


        let attempts = 0;


        const timer =
            setInterval(
                () => {

                    attempts++;


                    if (
                        addChatTab() ||
                        attempts >= 30
                    ) {

                        clearInterval(
                            timer
                        );
                    }

                },
                500
            );
    }


    /*
     * ============================================================
     * OPEN
     * ============================================================
 */

    function openChat() {

        if (!popup) {
            createPopup();
        }


        popup.style.display =
            "flex";


        isOpen = true;


        setTimeout(
            () => {

                if (
                    pubnubReady &&
                    input
                ) {

                    input.focus();
                }


                scrollMessages();

            },
            50
        );
    }


    /*
     * ============================================================
     * CLOSE
     * ============================================================
 */

    function closeChat() {

        if (!popup) {
            return;
        }


        popup.style.display =
            "none";


        isOpen = false;
    }


    /*
     * ============================================================
     * PUBNUB
     * ============================================================
 */

    function connectPubNub() {

        if (!window.PubNub) {

            throw new Error(
                "PubNub SDK ontbreekt."
            );
        }


        if (!schoolInfo) {

            throw new Error(
                "Schoolgegevens ontbreken."
            );
        }


        /*
         * DEMO KEYS
         */

        pubnub =
            new window.PubNub({

                publishKey:
                    CONFIG.publishKey,

                subscribeKey:
                    CONFIG.subscribeKey,

                userId:
                    schoolInfo.userId
            });


        pubnub.addListener({

            message(event) {

                if (
                    !event ||
                    !event.message
                ) {
                    return;
                }


                addMessage(
                    event.message
                );
            },


            status(event) {

                log(
                    "PubNub:",
                    event
                );


                if (
                    event.category ===
                    "PNConnectedCategory"
                ) {

                    pubnubReady =
                        true;


                    setChatReady(
                        true
                    );


                    updateStatus(
                        "Verbonden met de schoolchat"
                    );


                    log(
                        "Chat is klaar voor berichten."
                    );
                }


                if (
                    event.category ===
                    "PNNetworkDownCategory"
                ) {

                    pubnubReady =
                        false;


                    setChatReady(
                        false
                    );


                    updateStatus(
                        "Verbinding verbroken"
                    );
                }


                if (
                    event.category ===
                    "PNNetworkUpCategory"
                ) {

                    updateStatus(
                        "Verbinding herstellen..."
                    );
                }
            }

        });


        /*
         * Schoolbrede channel.
         */

        pubnub.subscribe({

            channels: [
                schoolInfo.channel
            ]

        });


        log(
            "PubNub verbonden:",
            {
                channel:
                    schoolInfo.channel,

                user:
                    schoolInfo.userId
            }
        );
    }


    /*
     * ============================================================
     * STATUS
     * ============================================================
 */

    function updateStatus(text) {

        const element =
            document.getElementById(
                "somtoday-chat-info"
            );


        if (element) {
            element.textContent =
                text;
        }
    }


    /*
     * ============================================================
     * SEND MESSAGE
     * ============================================================
 */

    async function sendMessage() {

        /*
         * Belangrijk:
         * niet alleen controleren of pubnub bestaat,
         * maar ook of de verbinding klaar is.
         */

        if (
            !pubnub ||
            !pubnubReady
        ) {

            updateStatus(
                "Even wachten op verbinding..."
            );

            return;
        }


        if (!schoolInfo) {
            return;
        }


        const text =
            input?.value.trim();


        if (!text) {
            return;
        }


        if (text.length > 2000) {

            alert(
                "Een bericht mag maximaal 2000 tekens bevatten."
            );

            return;
        }


        const message = {

            text,

            userId:
                schoolInfo.userId,

            displayName:
                schoolInfo.displayName,

            timestamp:
                Date.now()
        };


        try {

            /*
             * DEMO PUBNUB:
             *
             * publishKey = demo
             * subscribeKey = demo
             */

            await pubnub.publish({

                channel:
                    schoolInfo.channel,

                message
            });


            input.value =
                "";


            input.style.height =
                "auto";


            updateStatus(
                "Verbonden met de schoolchat"
            );

        } catch (e) {

            error(
                "PubNub publish mislukt:",
                e
            );


            updateStatus(
                "Bericht kon niet worden verstuurd"
            );
        }
    }


    /*
     * ============================================================
     * MESSAGE RENDER
     * ============================================================
 */

    function addMessage(message) {

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
            message.userId ===
            schoolInfo?.userId;


        const wrapper =
            document.createElement(
                "div"
            );


        wrapper.className =
            "somtoday-chat-message" +
            (
                mine
                    ? " mine"
                    : ""
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
                : (
                    message.displayName ||
                    "Leerling"
                );


        const bubble =
            document.createElement(
                "div"
            );


        bubble.className =
            "somtoday-chat-message-bubble";


        bubble.textContent =
            message.text || "";


        const time =
            document.createElement(
                "div"
            );


        time.className =
            "somtoday-chat-message-time";


        time.textContent =
            formatTime(
                message.timestamp
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


        const messages =
            messagesContainer.querySelectorAll(
                ".somtoday-chat-message"
            );


        while (
            messages.length >
            CONFIG.maxMessages
        ) {

            messages[0].remove();
        }


        scrollMessages();
    }


    /*
     * ============================================================
     * TIME
     * ============================================================
 */

    function formatTime(
        timestamp
    ) {

        if (!timestamp) {
            return "";
        }


        try {

            return new Date(
                timestamp
            ).toLocaleTimeString(
                "nl-NL",
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );

        } catch {

            return "";
        }
    }


    /*
     * ============================================================
     * SCROLL
     * ============================================================
 */

    function scrollMessages() {

        if (!messagesContainer) {
            return;
        }


        requestAnimationFrame(
            () => {

                messagesContainer.scrollTop =
                    messagesContainer.scrollHeight;
            }
        );
    }


    /*
     * ============================================================
     * START
     * ============================================================
 */

    async function start() {

        if (initialized) {
            return;
        }


        initialized =
            true;


        log(
            "Starting..."
        );


        addStyles();

        createPopup();


        /*
         * Somtoday-data.
         */

        schoolInfo =
            await getSchoolInfo();


        if (!schoolInfo) {

            error(
                "Somtoday-schoolgegevens konden niet worden gevonden."
            );


            updateStatus(
                "Schoolgegevens niet gevonden"
            );


            startTabWatcher();


            return;
        }


        /*
         * Schoolnaam.
         */

        const title =
            document.getElementById(
                "somtoday-chat-title-school"
            );


        if (title) {

            title.textContent =
                schoolInfo.locationName;
        }


        /*
         * PubNub SDK.
         */

        try {

            await loadPubNub();

        } catch (e) {

            error(
                "PubNub SDK laden mislukt:",
                e
            );


            updateStatus(
                "PubNub kon niet worden geladen"
            );


            startTabWatcher();


            return;
        }


        /*
         * Verbinden.
         */

        try {

            connectPubNub();

        } catch (e) {

            error(
                "PubNub starten mislukt:",
                e
            );


            updateStatus(
                "Chatverbinding mislukt"
            );
        }


        /*
         * Tab.
         */

        addChatTab();

        startTabWatcher();


        log(
            "Klaar.",
            {
                school:
                    schoolInfo.locationName,

                organization:
                    schoolInfo.organizationName,

                channel:
                    schoolInfo.channel,

                user:
                    schoolInfo.userId,

                pubnub:
                    "demo keys"
            }
        );
    }


    /*
     * ============================================================
     * START
     * ============================================================
 */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            start,
            {
                once: true
            }
        );

    } else {

        start();
    }

})();
