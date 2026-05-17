// ============================================================
// Quantum-Link — Frontend Logic
// WhatsApp-inspired web chat application
// ============================================================
// This file controls everything the user sees and interacts with:
//   - Username modal on first visit
//   - Avatar generation (coloured circles with initials)
//   - Sidebar chat list with search/filter
//   - Creating, joining, and deleting rooms
//   - Sending and displaying real-time messages
//   - Online user list
//   - Mobile-friendly slide navigation
// ============================================================


// ============================================================
// SOCKET.IO CONNECTION
// ============================================================
// io() connects this browser tab to the server.
// All real-time communication goes through this 'socket' object.

const socket = io();


// ============================================================
// DOM ELEMENTS
// ============================================================
// Grab references to every HTML element we'll need to update.

// --- Username modal ---
const usernameModal  = document.getElementById("usernameModal");
const usernameInput  = document.getElementById("usernameInput");
const usernameSubmit = document.getElementById("usernameSubmit");

// --- Sidebar ---
const appDiv           = document.getElementById("app");
const myAvatar         = document.getElementById("my-avatar");
const myUsername       = document.getElementById("my-username");
const createChatButton = document.getElementById("createChatButton");
const joinChatButton   = document.getElementById("joinChatButton");
const chatListDiv      = document.getElementById("chatList");
const searchInput      = document.getElementById("searchInput");

// --- Chat area ---
const welcomeScreen   = document.getElementById("welcome-screen");
const activeChat      = document.getElementById("active-chat");
const chatAvatar      = document.getElementById("chat-avatar");
const chatNameDisplay = document.getElementById("chat-name-display");
const onlineCount     = document.getElementById("online-count");
const backBtn         = document.getElementById("back-btn");
const toggleUsersBtn  = document.getElementById("toggle-users-btn");
const usersPanel      = document.getElementById("users-panel");
const userListDiv     = document.getElementById("userList");
const messagesDiv     = document.getElementById("messages");
const messageInput    = document.getElementById("messageInput");
const sendButton      = document.getElementById("sendButton");


// ============================================================
// APP STATE
// ============================================================
// These variables track what the app is doing right now.

const state = {
    currentChat: null,   // name of the room that is currently open (null = none)
    username:    null,   // the display name the user chose
    rooms:       [],     // full list of room names received from the server
};


// ============================================================
// AVATAR UTILITIES
// ============================================================
// We generate coloured circles with initials instead of profile pictures.
// This means no image uploads or extra storage needed!

// A palette of colours — each name gets one assigned consistently
const AVATAR_COLORS = [
    "#00a884", "#25d366", "#128c7e",
    "#34b7f1", "#e67e22", "#9b59b6",
    "#e74c3c", "#3498db", "#f39c12",
];

// Returns the first initial (or first two if there are two words)
function getInitials(name) {
    if (!name) return "?";
    const words = name.trim().split(" ");
    if (words.length >= 2) return words[0][0] + words[1][0];
    return words[0][0];
}

// Picks a colour from the palette based on the characters in a name.
// The same name always produces the same colour — even after a refresh!
function getAvatarColor(name) {
    if (!name) return AVATAR_COLORS[0];
    let total = 0;
    for (let i = 0; i < name.length; i++) {
        total += name.charCodeAt(i);   // sum the ASCII value of each letter
    }
    return AVATAR_COLORS[total % AVATAR_COLORS.length];
}

// Applies initials text and background colour to an avatar element
function setAvatar(element, name) {
    element.textContent      = getInitials(name).toUpperCase();
    element.style.background = getAvatarColor(name);
}


// ============================================================
// STARTUP
// ============================================================

function init() {
    setupEventListeners();
    setupSocketListeners();

    // Check if this user has visited before (name stored in browser)
    const savedName = localStorage.getItem("username");

    if (savedName) {
        // Returning user — skip the modal and go straight to the app
        applyUsername(savedName);
    } else {
        // New user — show the name entry modal, hide the rest
        usernameModal.style.display = "flex";
        appDiv.style.display        = "none";
    }
}


// ============================================================
// USERNAME MODAL
// ============================================================

function handleUsernameSubmit() {
    const input = usernameInput.value.trim();

    // Turn the border red if they submitted an empty name
    if (!input) {
        usernameInput.style.borderColor = "#ef4444";
        return;
    }

    // Persist the name so we skip the modal next time
    localStorage.setItem("username", input);
    applyUsername(input);
}

// Sets the username in state and shows the main app layout
function applyUsername(name) {
    state.username = name;

    // Update the sidebar header with the user's name and avatar
    myUsername.textContent = name;
    setAvatar(myAvatar, name);

    // Hide the modal and show the app
    usernameModal.style.display = "none";
    appDiv.style.display        = "flex";

    // Tell the server who we are and get the initial room list
    if (socket.connected) {
        socket.emit("set username", name);
        socket.emit("get rooms");
        socket.emit("join room", { name: "Example Chat", password: "" });
    }
}


// ============================================================
// SOCKET.IO — EVENTS COMING FROM THE SERVER
// ============================================================

function setupSocketListeners() {

    // --- Connected ---
    // Fires when our socket first connects (or reconnects after a drop).
    socket.on("connect", () => {
        if (!state.username) return;   // wait until the user has picked a name
        socket.emit("set username", state.username);
        socket.emit("get rooms");
        socket.emit("join room", { name: "Example Chat", password: "" });
    });

    // --- Room list ---
    // Server sends an array of room name strings whenever the list changes.
    // Example: ["Example Chat", "Gaming", "Study Group"]
    socket.on("room list", (roomNames) => {
        state.rooms = roomNames;
        renderChatList(roomNames);
    });

    // --- Room joined ---
    // Server confirms we entered a room and sends its full message history.
    // data = { name: "Room Name", messages: [ { user, text, time }, ... ] }
    socket.on("room joined", (data) => {
        state.currentChat = data.name;

        // Update the chat header with this room's name and avatar
        chatNameDisplay.textContent = data.name;
        setAvatar(chatAvatar, data.name);

        // Switch the view from welcome screen to the active chat
        welcomeScreen.classList.add("hidden");
        activeChat.classList.remove("hidden");

        // On mobile: slide the chat panel into view
        appDiv.classList.add("chat-open");

        // Highlight this room as active in the sidebar
        updateActiveChatInList(data.name);

        // Clear old messages and load this room's history
        messagesDiv.innerHTML = "";
        data.messages.forEach((msg) => displayMessage(msg));
    });

    // --- New message ---
    // Fires whenever anyone in the current room sends a message.
    // data = { room: "Room Name", message: { user, text, time } }
    socket.on("chat message", (data) => {
        if (data.room === state.currentChat) {
            displayMessage(data.message);
        }
    });

    // --- User list ---
    // Server sends this when someone joins or leaves the room.
    socket.on("user list", (users) => {
        renderUserList(users);
        onlineCount.textContent = `${users.length} online`;
    });

    // --- Room error ---
    // Server sends this when something goes wrong (bad password, room not found).
    socket.on("room error", (errorMessage) => {
        alert(errorMessage);
    });

    // --- Room deleted ---
    // Another user deleted the room we were in — fall back to Example Chat.
    socket.on("room deleted", (deletedRoomName) => {
        if (state.currentChat === deletedRoomName) {
            alert(`"${deletedRoomName}" was deleted. Returning to Example Chat.`);
            socket.emit("join room", { name: "Example Chat", password: "" });
        }
    });
}


// ============================================================
// SIDEBAR — CHAT LIST
// ============================================================

// Rebuilds the room list in the sidebar.
// Applies the current search filter if the user typed something.
function renderChatList(roomNames) {
    const filter = searchInput.value.toLowerCase().trim();
    chatListDiv.innerHTML = "";

    // Keep only rooms whose name contains the search text
    const filtered = roomNames.filter((name) =>
        name.toLowerCase().includes(filter)
    );

    if (filtered.length === 0) {
        chatListDiv.innerHTML = '<div class="chat-list-empty">No chats found</div>';
        return;
    }

    filtered.forEach((name) => {
        chatListDiv.appendChild(createChatListItem(name));
    });
}

// Builds one clickable row in the room list
function createChatListItem(roomName) {
    const item = document.createElement("div");
    item.classList.add("chat-item");

    // Highlight it if this is the room we're currently in
    if (roomName === state.currentChat) {
        item.classList.add("active-chat");
    }

    // Avatar circle (same colour logic as user avatars)
    const avatarEl = document.createElement("div");
    avatarEl.classList.add("avatar", "avatar-sm");
    setAvatar(avatarEl, roomName);

    // Room name + a small subtitle line
    // (using textContent, not innerHTML, so special characters can't inject HTML)
    const info = document.createElement("div");
    info.classList.add("chat-item-info");

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("chat-item-name");
    nameDiv.textContent = roomName;

    const previewDiv = document.createElement("div");
    previewDiv.classList.add("chat-item-preview");
    previewDiv.textContent = "Tap to open";

    info.appendChild(nameDiv);
    info.appendChild(previewDiv);

    item.appendChild(avatarEl);
    item.appendChild(info);

    // Add a delete button for all rooms except the default "Example Chat"
    if (roomName !== "Example Chat") {
        const deleteBtn = document.createElement("button");
        deleteBtn.classList.add("delete-chat-btn");
        deleteBtn.title       = "Delete room";
        deleteBtn.textContent = "✕";

        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();   // prevent the click from also triggering the join
            handleDeleteChat(roomName);
        });

        item.appendChild(deleteBtn);
    }

    // Click the row to open that room
    item.addEventListener("click", () => {
        if (roomName === state.currentChat) {
            // Already in this room — just slide to the chat view on mobile
            appDiv.classList.add("chat-open");
            return;
        }
        handleJoinChat(roomName);
    });

    return item;
}

// Updates the 'active-chat' class on all list items to match the current room
function updateActiveChatInList(roomName) {
    document.querySelectorAll(".chat-item").forEach((item) => {
        const name = item.querySelector(".chat-item-name")?.textContent;
        item.classList.toggle("active-chat", name === roomName);
    });
}


// ============================================================
// ONLINE USERS PANEL
// ============================================================

// Rebuilds the member list whenever someone joins or leaves
function renderUserList(users) {
    userListDiv.innerHTML = "";

    users.forEach((username) => {
        const item = document.createElement("div");
        item.classList.add("user-item");

        // Small avatar with the user's initials
        const avatarEl = document.createElement("div");
        avatarEl.classList.add("avatar", "avatar-xs");
        setAvatar(avatarEl, username);

        // Green dot = online indicator
        const dot = document.createElement("div");
        dot.classList.add("online-dot");

        // Username text
        const name = document.createElement("span");
        name.textContent = username;

        item.appendChild(avatarEl);
        item.appendChild(dot);
        item.appendChild(name);
        userListDiv.appendChild(item);
    });
}


// ============================================================
// ROOM MANAGEMENT
// ============================================================

// Prompts the user for a room name and password, then creates the room
function handleCreateChat() {
    const name = prompt("Name your new chat room:");
    if (!name || !name.trim()) return;

    const password = prompt("Set a password for this room:");
    if (!password) {
        alert("A password is required to create a room.");
        return;
    }

    socket.emit("create room", { name: name.trim(), password });
}

// Joins an existing room.
// roomName is passed when clicking a sidebar item, null when using the button.
function handleJoinChat(roomName) {
    // If no roomName was passed (e.g., from "Join a Room" button), ask for it
    const name = roomName || prompt("Enter the room name to join:");
    if (!name) return;

    // Example Chat has no password — all others may have one (can be left blank)
    let password = "";
    if (name !== "Example Chat") {
        const entered = prompt(`Password for "${name}"? (leave blank if none)`);
        if (entered === null) return;   // user pressed Cancel
        password = entered;
    }

    socket.emit("join room", { name, password });
}

// Confirms and deletes a room
function handleDeleteChat(roomName) {
    if (!confirm(`Delete "${roomName}"? This cannot be undone.`)) return;
    socket.emit("delete room", { name: roomName });
}


// ============================================================
// MESSAGES
// ============================================================

// Reads the input field and sends the message text to the server
function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text || !state.currentChat) return;

    // The server attaches username and timestamp — we only send the text
    socket.emit("chat message", { room: state.currentChat, text });

    messageInput.value = "";
    messageInput.focus();
}

// Creates and appends one message bubble to the messages area
function displayMessage(message) {
    // Decide if this message was sent by the current user
    const isOwn = message.user === state.username;

    // Outer wrapper — controls left/right alignment via CSS classes
    const wrapper = document.createElement("div");
    wrapper.classList.add("message", isOwn ? "sent" : "received");

    // Show the sender's name above bubbles from other users
    if (!isOwn) {
        const sender = document.createElement("div");
        sender.classList.add("message-sender");
        sender.textContent = message.user;
        // Match the colour to their avatar so they're easy to identify
        sender.style.color = getAvatarColor(message.user);
        wrapper.appendChild(sender);
    }

    // The coloured bubble containing text + timestamp
    const bubble = document.createElement("div");
    bubble.classList.add("message-bubble");

    // Message text — using textContent (not innerHTML) prevents XSS attacks
    const text = document.createElement("div");
    text.textContent = message.text;

    // Timestamp shown in the bottom-right corner of the bubble
    const time = document.createElement("span");
    time.classList.add("message-time");
    time.textContent = message.time;

    bubble.appendChild(text);
    bubble.appendChild(time);
    wrapper.appendChild(bubble);
    messagesDiv.appendChild(wrapper);

    // Scroll down so the newest message is always visible
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {

    // --- Username modal ---
    usernameSubmit.addEventListener("click", handleUsernameSubmit);
    usernameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleUsernameSubmit();
    });

    // --- Sidebar buttons ---
    createChatButton.addEventListener("click", handleCreateChat);
    joinChatButton.addEventListener("click", () => handleJoinChat(null));

    // --- Search box — re-renders the list on every keystroke ---
    searchInput.addEventListener("input", () => {
        renderChatList(state.rooms);
    });

    // --- Message sending ---
    sendButton.addEventListener("click", handleSendMessage);
    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSendMessage();
    });

    // --- Mobile: back button slides away from the chat and shows the sidebar ---
    backBtn.addEventListener("click", () => {
        appDiv.classList.remove("chat-open");
    });

    // --- Toggle the online members panel open/closed ---
    toggleUsersBtn.addEventListener("click", () => {
        usersPanel.classList.toggle("hidden");
    });
}


// ============================================================
// START THE APP
// ============================================================

init();
