// ============================================================
// Quantum-Link — Backend Server
// ============================================================
// This file starts the web server and manages:
//   - Serving the login, register, and main app pages
//   - Account registration and login (authentication)
//   - Session management (remembering who is logged in)
//   - Real-time chat connections using Socket.IO
//
// To start the server, run:
//   npm start
// Then open http://localhost:3000 in your browser.
// ============================================================


// ============================================================
// IMPORTS
// ============================================================

// dotenv loads our .env file so we can use process.env.VARIABLE_NAME
// This must be called FIRST before anything else reads environment variables
require("dotenv").config();

// Express handles serving web pages and API routes
const express = require("express");

// Node's built-in http module wraps Express so Socket.IO can use it
const http = require("http");

// Socket.IO lets the server and browser talk in real time
const { Server } = require("socket.io");

// bcryptjs hashes passwords so we never store plain-text passwords
const bcrypt = require("bcryptjs");

// express-session creates and manages login sessions (like a cookie)
const session = require("express-session");

// fs and path are built-in Node modules for reading/writing files
const fs   = require("fs");
const path = require("path");


// ============================================================
// APP SETUP
// ============================================================

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Parse incoming JSON request bodies (used by our /api routes)
app.use(express.json());


// ============================================================
// SESSION MIDDLEWARE
// ============================================================
// A "session" is a way to remember who is logged in between requests.
// When a user logs in, we save their username in the session.
// On every future request, Express reads the session cookie and
// restores that saved data — so we know who is making the request.
//
// We create the middleware object first so we can share it with
// Socket.IO later (see the "Share Session with Socket.IO" section).
// ============================================================

const sessionMiddleware = session({
    // secret: a private key used to sign the session cookie.
    //         If someone tampers with their cookie, the signature won't match.
    secret: process.env.SESSION_SECRET || "fallback-secret-change-this",

    resave: false,            // don't save the session if nothing changed
    saveUninitialized: false, // don't save a session until the user logs in

    cookie: {
        // Keep the session alive for 24 hours (milliseconds)
        maxAge: 1000 * 60 * 60 * 24,
    },
});

// Register the session middleware with Express
app.use(sessionMiddleware);


// ============================================================
// STATIC FILE SERVING
// ============================================================
// Express serves files from the "public" folder automatically.
// BUT we need to guard the main page (index.html) so only
// logged-in users can reach it.
//
// We do this by handling the "/" route ourselves (below) before
// the static middleware tries to serve it.
// ============================================================

// Serve login.html, register.html, auth.css, etc. freely —
// anyone can access these without being logged in.
// Only index.html is protected (handled separately below).
app.use(express.static(path.join(__dirname, "public"), {
    // Don't auto-serve index.html for "/" — we do that ourselves
    index: false,
}));


// ============================================================
// PROTECTED MAIN PAGE
// ============================================================
// The "/" route sends the main chat app.
// If the user is not logged in, they are redirected to the login page.

app.get("/", (req, res) => {
    if (!req.session.username) {
        // Not logged in — send them to login.html
        return res.redirect("/login.html");
    }
    // Logged in — serve the main app
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


// ============================================================
// DATA PERSISTENCE — ROOMS
// ============================================================
// Rooms and messages are saved to data/rooms.json.

const ROOMS_FILE = path.join(__dirname, "data", "rooms.json");

const DEFAULT_ROOMS = {
    "Example Chat": {
        password: "",
        messages: [],
    },
};

function loadRooms() {
    try {
        const raw = fs.readFileSync(ROOMS_FILE, "utf8");
        return JSON.parse(raw);
    } catch (err) {
        console.log("No saved rooms found. Starting with default rooms.");
        return { ...DEFAULT_ROOMS };
    }
}

function saveRooms() {
    const dir = path.dirname(ROOMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2), "utf8");
}

const rooms = loadRooms();


// ============================================================
// DATA PERSISTENCE — USERS
// ============================================================
// User accounts are saved to data/users.json.
// We store each user's username and their hashed password.
// Passwords are NEVER stored as plain text.

const USERS_FILE = path.join(__dirname, "data", "users.json");

function loadUsers() {
    // Read the users file and return the array of user objects
    try {
        const raw = fs.readFileSync(USERS_FILE, "utf8");
        return JSON.parse(raw).users || [];
    } catch (err) {
        // File doesn't exist yet — return an empty array
        console.log("No users file found. Starting with no users.");
        return [];
    }
}

function saveUsers(users) {
    // Write the users array back to disk, wrapped in the { users: [...] } structure
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), "utf8");
}


// ============================================================
// AUTH API ROUTES
// ============================================================


// ----------------------------------------------------------
// GET /api/security-question
// Returns the security question text from the .env file.
// We NEVER send the answer — that stays server-side only.
// ----------------------------------------------------------

app.get("/api/security-question", (_req, res) => {
    res.json({ question: process.env.SECURITY_QUESTION || "No question set." });
});


// ----------------------------------------------------------
// POST /api/register
// Creates a new user account.
//
// Expects JSON body: { username, password, securityAnswer }
//
// Steps:
//   1. Check all fields are present
//   2. Compare the security answer to the one in .env
//   3. Make sure the username isn't already taken
//   4. Hash the password with bcrypt
//   5. Save the new user to users.json
// ----------------------------------------------------------

app.post("/api/register", async (req, res) => {
    const { username, password, securityAnswer } = req.body;

    // --- Step 1: Make sure all required fields were sent ---
    if (!username || !password || !securityAnswer) {
        return res.status(400).json({ error: "All fields are required." });
    }

    if (username.trim().length < 3) {
        return res.status(400).json({ error: "Username must be at least 3 characters." });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    // --- Step 2: Check the security answer ---
    // We compare case-insensitively so "lincoln high" = "Lincoln High"
    const correctAnswer = (process.env.SECURITY_ANSWER || "").toLowerCase().trim();
    const givenAnswer   = securityAnswer.toLowerCase().trim();

    if (givenAnswer !== correctAnswer) {
        return res.status(400).json({ error: "Incorrect answer to the security question." });
    }

    // --- Step 3: Make sure username isn't already taken ---
    const users = loadUsers();
    const alreadyExists = users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
    );

    if (alreadyExists) {
        return res.status(400).json({ error: "That username is already taken." });
    }

    // --- Step 4: Hash the password ---
    // bcrypt.hash(password, saltRounds) — more salt rounds = more secure but slower.
    // 10 is the standard recommended value.
    const passwordHash = await bcrypt.hash(password, 10);

    // --- Step 5: Save the new user ---
    users.push({
        username: username.trim(),
        passwordHash,
    });
    saveUsers(users);

    console.log(`New account registered: ${username}`);

    // Respond with 201 Created (success)
    res.status(201).json({ message: "Account created successfully." });
});


// ----------------------------------------------------------
// POST /api/login
// Checks credentials and starts a session.
//
// Expects JSON body: { username, password }
//
// Steps:
//   1. Find the user by username
//   2. Compare the submitted password to the stored hash
//   3. If correct → save username to the session
// ----------------------------------------------------------

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    // Find the user in our saved list (case-insensitive username match)
    const users = loadUsers();
    const user  = users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
        // No account with that username — give a vague error so attackers
        // can't tell whether the username or the password was wrong
        return res.status(401).json({ error: "Incorrect username or password." });
    }

    // Compare the submitted password with the stored hash
    // bcrypt.compare returns true if they match, false if they don't
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
        return res.status(401).json({ error: "Incorrect username or password." });
    }

    // Credentials are correct! Save the username in the session.
    // From this point on, req.session.username will be set on every request.
    req.session.username = user.username;

    console.log(`User logged in: ${user.username}`);

    res.json({ message: "Login successful.", username: user.username });
});


// ----------------------------------------------------------
// POST /api/logout
// Destroys the session and logs the user out.
// ----------------------------------------------------------

app.post("/api/logout", (req, res) => {
    const username = req.session.username;

    req.session.destroy(() => {
        console.log(`User logged out: ${username}`);
        // Respond with success — the frontend will redirect to login.html
        res.json({ message: "Logged out." });
    });
});


// ----------------------------------------------------------
// GET /api/me
// Returns the currently logged-in user's info.
// The frontend calls this on page load to check if a session exists.
// ----------------------------------------------------------

app.get("/api/me", (req, res) => {
    if (!req.session.username) {
        // 401 means "you need to be logged in to use this"
        return res.status(401).json({ error: "Not logged in." });
    }
    res.json({ username: req.session.username });
});


// ============================================================
// HELPER FUNCTIONS (SOCKET.IO)
// ============================================================

function getUsersInRoom(roomName) {
    const usernames = [];
    io.sockets.sockets.forEach((s) => {
        if (s.currentRoom === roomName) {
            usernames.push(s.username || "Guest");
        }
    });
    return usernames;
}

function broadcastUserList(roomName) {
    io.to(roomName).emit("user list", getUsersInRoom(roomName));
}


// ============================================================
// SHARE SESSION WITH SOCKET.IO
// ============================================================
// By default, Socket.IO doesn't have access to Express sessions.
// This line runs the same session middleware when a socket connects,
// so we can read req.session.username inside the socket handler below.

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});


// ============================================================
// SOCKET.IO — REAL-TIME CONNECTION HANDLING
// ============================================================

io.on("connection", (socket) => {

    // Read the username from the session — no need to ask the client
    const username = socket.request.session.username;

    // If there's no session (user somehow connected without logging in),
    // disconnect them immediately
    if (!username) {
        socket.disconnect();
        return;
    }

    // Store username and current room on the socket object
    socket.username    = username;
    socket.currentRoom = null;

    console.log(`${username} connected`);


    // ----------------------------------------------------------
    // Event: "get rooms"
    // ----------------------------------------------------------
    socket.on("get rooms", () => {
        socket.emit("room list", Object.keys(rooms));
    });


    // ----------------------------------------------------------
    // Event: "create room"
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("create room", (data) => {
        const { name, password } = data;

        if (rooms[name]) {
            socket.emit("room error", `A room called "${name}" already exists.`);
            return;
        }

        rooms[name] = {
            password: password || "",
            messages: [],
        };
        saveRooms();

        console.log(`Room created: "${name}" by ${socket.username}`);

        io.emit("room list", Object.keys(rooms));
        socket.emit("room joined", { name, messages: [] });
        socket.join(name);
        socket.currentRoom = name;
        broadcastUserList(name);
    });


    // ----------------------------------------------------------
    // Event: "join room"
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("join room", (data) => {
        const { name, password } = data;
        const room = rooms[name];

        if (!room) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        if (room.password && room.password !== password) {
            socket.emit("room error", "Wrong password.");
            return;
        }

        if (socket.currentRoom && socket.currentRoom !== name) {
            socket.leave(socket.currentRoom);
            broadcastUserList(socket.currentRoom);
        }

        socket.join(name);
        socket.currentRoom = name;

        console.log(`${socket.username} joined room: "${name}"`);

        socket.emit("room joined", { name, messages: room.messages });
        broadcastUserList(name);
    });


    // ----------------------------------------------------------
    // Event: "chat message"
    // data = { room: "Room Name", text: "Hello!" }
    // ----------------------------------------------------------
    socket.on("chat message", (data) => {
        const { room, text } = data;

        if (!rooms[room]) return;

        const message = {
            user: socket.username,
            text: text,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        rooms[room].messages.push(message);
        if (rooms[room].messages.length > 100) {
            rooms[room].messages.shift();
        }

        saveRooms();

        io.to(room).emit("chat message", { room, message });

        console.log(`[${room}] ${message.user}: ${message.text}`);
    });


    // ----------------------------------------------------------
    // Event: "delete room"
    // data = { name: "Room Name" }
    // ----------------------------------------------------------
    socket.on("delete room", (data) => {
        const { name } = data;

        if (name === "Example Chat") {
            socket.emit("room error", "The Example Chat cannot be deleted.");
            return;
        }

        if (!rooms[name]) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        delete rooms[name];
        saveRooms();

        console.log(`Room deleted: "${name}" by ${socket.username}`);

        io.emit("room list", Object.keys(rooms));
        io.to(name).emit("room deleted", name);
    });


    // ----------------------------------------------------------
    // Event: "disconnect"
    // ----------------------------------------------------------
    socket.on("disconnect", () => {
        console.log(`${socket.username} disconnected`);

        if (socket.currentRoom) {
            broadcastUserList(socket.currentRoom);
        }
    });

});


// ============================================================
// START THE SERVER
// ============================================================

const PORT = 3000;

server.listen(PORT, () => {
    console.log(`Quantum-Link is running at http://localhost:${PORT}`);
});
