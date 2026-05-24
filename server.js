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

// path is a built-in Node module for building file paths
const path = require("path");

// mongoose lets us talk to MongoDB using simple JavaScript models
// (We no longer need the "fs" module because we're not using JSON files anymore)
const mongoose = require("mongoose");

// Fix for Windows DNS SRV resolution issues with MongoDB Atlas.
// Node.js 18+ defaults to IPv6-first, which breaks SRV lookups on many Windows
// networks. This line forces IPv4 first, which resolves ECONNREFUSED errors.
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "1.1.1.1"]); // Use Google/Cloudflare DNS — system DNS blocks SRV queries


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
// MONGOOSE SCHEMAS AND MODELS
// ============================================================
// A "schema" describes the shape of a document in MongoDB.
// A "model" is the object we use to create, find, update, and delete documents.
//
// Think of it like this:
//   Schema   = a blueprint (what fields does a document have?)
//   Model    = a class that uses the blueprint (Room.find(), User.create(), etc.)
//   Document = one record in the database (one room, one user)


// ----------------------------------------------------------
// Message Schema (embedded inside Room — no separate collection)
// ----------------------------------------------------------
// Messages are stored directly inside their room document.
// This is simpler than a separate "messages" collection for a school project.

const messageSchema = new mongoose.Schema({
    user: { type: String, required: true }, // who sent it
    text: { type: String, required: true }, // the message text
    time: { type: String, required: true }, // formatted time, e.g. "12:34 p.m."
}, {
    // _id: false means Mongoose won't add a separate ID to each message.
    // Embedded messages don't need their own IDs.
    _id: false,
});


// ----------------------------------------------------------
// Room Schema
// ----------------------------------------------------------
// Each room document stores its name, optional password, and
// an array of up to 100 embedded message objects.

const roomSchema = new mongoose.Schema({
    // The room's display name — must be unique (no two "General" rooms)
    name: {
        type:     String,
        required: true,
        unique:   true,
        trim:     true,  // removes accidental leading/trailing spaces
    },

    // Optional password — empty string means the room is public
    password: {
        type:    String,
        default: "",
    },

    // Array of embedded message objects (up to 100, enforced in the handler)
    messages: {
        type:    [messageSchema],
        default: [],
    },
});

// "Room" → Mongoose will use the collection named "rooms" in MongoDB (auto-pluralized)
const Room = mongoose.model("Room", roomSchema);


// ----------------------------------------------------------
// User Schema
// ----------------------------------------------------------
// Each user document stores a username and a hashed password.

const userSchema = new mongoose.Schema({
    // The player's chosen display name — must be unique
    username: {
        type:     String,
        required: true,
        unique:   true,
        trim:     true,
    },

    // The bcrypt hash of the user's password — NEVER the plain-text password!
    passwordHash: {
        type:     String,
        required: true,
    },
});

// "User" → Mongoose will use the collection named "users" in MongoDB
const User = mongoose.model("User", userSchema);


// ============================================================
// CONNECT TO MONGODB AND SEED DEFAULT DATA
// ============================================================
// We connect to MongoDB first, then start the server.
// The "seed" step ensures "Example Chat" always exists on startup.

async function connectAndSeed() {

    // mongoose.connect() opens the connection to Atlas.
    // We await it so we know it's fully open before the server starts.
    await mongoose.connect(process.env.MONGODB_URI, {
        family: 4,                      // Force IPv4 at the socket level (backup for the dns setting above)
        serverSelectionTimeoutMS: 10000, // Give Atlas 10 seconds to respond before giving up
    });
    console.log("Connected to MongoDB Atlas!");

    // Check if "Example Chat" already exists in the database
    const exists = await Room.findOne({ name: "Example Chat" });

    if (!exists) {
        // It doesn't exist yet — create it now
        await Room.create({ name: "Example Chat", password: "", messages: [] });
        console.log("Created default room: Example Chat");
    }
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
//   3. Make sure the username isn't already taken (checked in MongoDB)
//   4. Hash the password with bcrypt
//   5. Save the new user to MongoDB
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
    // User.findOne() searches the "users" collection.
    // The $regex with "i" flag makes the comparison case-insensitive.
    const alreadyExists = await User.findOne({
        username: { $regex: new RegExp(`^${username.trim()}$`, "i") },
    });

    if (alreadyExists) {
        return res.status(400).json({ error: "That username is already taken." });
    }

    // --- Step 4: Hash the password ---
    // bcrypt.hash(password, saltRounds) — 10 is the standard recommended value.
    const passwordHash = await bcrypt.hash(password, 10);

    // --- Step 5: Save the new user to MongoDB ---
    // User.create() inserts a new document into the "users" collection.
    await User.create({
        username: username.trim(),
        passwordHash,
    });

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
//   1. Find the user by username in MongoDB
//   2. Compare the submitted password to the stored hash
//   3. If correct → save username to the session
// ----------------------------------------------------------

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    // Find the user in MongoDB (case-insensitive username match)
    const user = await User.findOne({
        username: { $regex: new RegExp(`^${username}$`, "i") },
    });

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
    // We use user.username (from DB) to preserve the original capitalisation.
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

// Returns an array of usernames for everyone currently in a room
function getUsersInRoom(roomName) {
    const usernames = [];
    io.sockets.sockets.forEach((s) => {
        if (s.currentRoom === roomName) {
            usernames.push(s.username || "Guest");
        }
    });
    return usernames;
}

// Sends the updated user list to everyone in a room
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
// Every handler that touches MongoDB is declared "async" so we
// can use "await" to wait for the database response before continuing.

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
    // The client asks for a list of all available room names.
    // ----------------------------------------------------------
    socket.on("get rooms", async () => {
        // Room.find() returns all room documents.
        // { name: 1 } tells MongoDB to only return the "name" field (faster).
        const roomDocs  = await Room.find({}, { name: 1 });
        const roomNames = roomDocs.map(r => r.name);

        socket.emit("room list", roomNames);
    });


    // ----------------------------------------------------------
    // Event: "create room"
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("create room", async (data) => {
        const { name, password } = data;

        // Check if a room with this name already exists in MongoDB
        const existing = await Room.findOne({ name });

        if (existing) {
            socket.emit("room error", `A room called "${name}" already exists.`);
            return;
        }

        // Insert a new room document into the "rooms" collection
        await Room.create({
            name,
            password: password || "",
            messages: [],
        });

        console.log(`Room created: "${name}" by ${socket.username}`);

        // Broadcast the updated room list to ALL connected clients
        const roomDocs  = await Room.find({}, { name: 1 });
        const roomNames = roomDocs.map(r => r.name);
        io.emit("room list", roomNames);

        // Join the creator to their new room immediately
        socket.emit("room joined", { name, messages: [] });
        socket.join(name);
        socket.currentRoom = name;
        broadcastUserList(name);
    });


    // ----------------------------------------------------------
    // Event: "join room"
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("join room", async (data) => {
        const { name, password } = data;

        // Look up the room in MongoDB
        const room = await Room.findOne({ name });

        if (!room) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        if (room.password && room.password !== password) {
            socket.emit("room error", "Wrong password.");
            return;
        }

        // Leave the previous room if switching
        if (socket.currentRoom && socket.currentRoom !== name) {
            socket.leave(socket.currentRoom);
            broadcastUserList(socket.currentRoom);
        }

        socket.join(name);
        socket.currentRoom = name;

        console.log(`${socket.username} joined room: "${name}"`);

        // Send the room's message history to the joining client.
        // room.messages is the embedded array stored in MongoDB.
        socket.emit("room joined", { name, messages: room.messages });
        broadcastUserList(name);
    });


    // ----------------------------------------------------------
    // Event: "chat message"
    // data = { room: "Room Name", text: "Hello!" }
    // ----------------------------------------------------------
    socket.on("chat message", async (data) => {
        const { room, text } = data;

        // Build the message object (same shape as before)
        const message = {
            user: socket.username,
            text: text,
            time: new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "America/Toronto" }),
        };

        // $push adds the new message to the messages array.
        // $slice: -100 keeps only the LAST 100 messages automatically.
        // This is one atomic MongoDB operation — no race conditions possible.
        const updated = await Room.findOneAndUpdate(
            { name: room },
            { $push: { messages: { $each: [message], $slice: -100 } } },
            { new: true },
        );

        // If the room was deleted between the client sending and us processing, bail out
        if (!updated) return;

        // Broadcast the new message to everyone in the room
        io.to(room).emit("chat message", { room, message });

        console.log(`[${room}] ${message.user}: ${message.text}`);
    });


    // ----------------------------------------------------------
    // Event: "delete room"
    // data = { name: "Room Name" }
    // ----------------------------------------------------------
    socket.on("delete room", async (data) => {
        const { name } = data;

        if (name === "Example Chat") {
            socket.emit("room error", "The Example Chat cannot be deleted.");
            return;
        }

        // Room.deleteOne() removes the document matching the filter
        // result.deletedCount is 0 if not found, 1 if successfully deleted
        const result = await Room.deleteOne({ name });

        if (result.deletedCount === 0) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        console.log(`Room deleted: "${name}" by ${socket.username}`);

        // Send updated room list to everyone
        const roomDocs  = await Room.find({}, { name: 1 });
        const roomNames = roomDocs.map(r => r.name);
        io.emit("room list", roomNames);

        // Tell everyone who was in that room that it's gone
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
// We connect to MongoDB FIRST, then start listening for requests.
// This ensures the database is ready before any user can log in
// or send a message.

// Use the port assigned by Render (or any cloud host) at runtime.
// If no PORT env var is set (e.g. running locally), fall back to 3000.
const PORT = process.env.PORT || 3000;

connectAndSeed()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`Quantum-Link is running at http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        // If MongoDB connection fails, print the error and stop the process.
        // The server should NOT start if it has no database.
        console.error("Failed to connect to MongoDB:", err.message);
        process.exit(1);
    });
