const sendButton = document.getElementById("sendButton");
const messageInput = document.getElementById("messageInput");
const messagesDiv = document.getElementById("messages");
const createChatButton = document.getElementById("createChatButton");
const joinChatButton = document.getElementById("joinChatButton");
const chatList = document.getElementById("chatList");
const currentChatDisplay = document.getElementById("currentChatDisplay");

const state = {
  currentChat: "Example Chat",
  username: null,
  chats: {},
};

function init() {
  state.username = loadUsername();
  state.chats = loadChats();
  setupEventListeners();
  renderChatList();
  openChat(state.currentChat);
}

function loadUsername() {
  const storedName = localStorage.getItem("username");
  if (storedName) return storedName;

  const chosenName = prompt("Choose your username (only once):");
  const username = chosenName ? chosenName.trim() : "Guest";

  localStorage.setItem("username", username);
  return username;
}

function loadChats() {
  const savedChats = localStorage.getItem("chats");
  if (savedChats) {
    return JSON.parse(savedChats);
  }

  return {
    "Example Chat": {
      password: "",
      messages: [],
      members: [],
    },
  };
}

function saveChats() {
  localStorage.setItem("chats", JSON.stringify(state.chats));
}

function setCurrentChat(chatName) {
  state.currentChat = chatName;
  updateCurrentChatLabel();
}

function updateCurrentChatLabel() {
  if (!currentChatDisplay) return;
  currentChatDisplay.textContent = `Current Chat: ${state.currentChat}`;
}

function renderChatList() {
  chatList.innerHTML = "";

  Object.keys(state.chats).forEach((chatName) => {
    if (chatName === "Example Chat") return;
    chatList.appendChild(createChatListItem(chatName));
  });
}

function createChatListItem(chatName) {
  const chatItem = document.createElement("div");
  chatItem.classList.add("chat-item");

  if (chatName === state.currentChat) {
    chatItem.classList.add("active-chat");
  }

  const nameSpan = document.createElement("span");
  nameSpan.textContent = chatName;
  nameSpan.style.cursor = "pointer";
  nameSpan.addEventListener("click", () => joinChat(chatName));

  const deleteButton = createDeleteChatButton(chatName);
  chatItem.append(nameSpan, deleteButton);

  return chatItem;
}

function createDeleteChatButton(chatName) {
  const button = document.createElement("button");
  button.textContent = "X";
  button.classList.add("delete-chat-btn");

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (!confirm(`Delete chat '${chatName}'?`)) return;

    delete state.chats[chatName];
    saveChats();

    if (state.currentChat === chatName) {
      openChat("Example Chat");
    }

    renderChatList();
  });

  return button;
}

function joinChat(chatName) {
  const chat = state.chats[chatName];
  if (!chat) {
    alert("Chat does not exist!");
    return;
  }

  if (chat.password) {
    const password = prompt("Enter chat password:");
    if (password !== chat.password) {
      alert("Wrong password!");
      return;
    }
  }

  openChat(chatName);
}

function openChat(chatName) {
  if (!state.chats[chatName]) return;

  setCurrentChat(chatName);
  messagesDiv.innerHTML = "";

  state.chats[chatName].messages.forEach((message) => {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message");
    messageElement.textContent = message;
    messagesDiv.appendChild(messageElement);
  });

  renderInviteButton();
  renderChatList();
}

function setupEventListeners() {
  createChatButton.addEventListener("click", handleCreateChat);
  joinChatButton.addEventListener("click", handleJoinChat);
  sendButton.addEventListener("click", handleSendMessage);
}

function handleCreateChat() {
  const name = prompt("Enter chat name:");
  if (!name) return;

  if (state.chats[name]) {
    alert("Chat already exists!");
    return;
  }

  const password = prompt("Set a password for this chat:");
  if (!password) {
    alert("Password is required!");
    return;
  }

  state.chats[name] = {
    password,
    messages: [],
    members: [],
  };

  saveChats();
  renderChatList();
  openChat(name);
}

function handleJoinChat() {
  const name = prompt("Enter chat name to join:");
  if (!name) return;

  joinChat(name);
}

function handleSendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  const message = `${state.username}: ${text}`;
  state.chats[state.currentChat].messages.push(message);
  saveChats();

  const messageElement = document.createElement("div");
  messageElement.classList.add("message");
  messageElement.textContent = message;
  messagesDiv.appendChild(messageElement);

  messageInput.value = "";
}


init();

/* ENTER KEY */
messageInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") sendButton.click();
});

/* =========================
   INIT
========================= */

openChat("Example Chat");
renderChatList();
updateCurrentChatLabel();

// Hello
