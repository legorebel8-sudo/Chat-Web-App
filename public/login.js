// ============================================================
// Quantum-Link — Login Page Logic
// ============================================================
// This script handles what happens when the user clicks "Login".
// Steps:
//   1. Read the username and password from the form
//   2. Send them to the server with fetch()
//   3. If login succeeds → go to the main chat app
//   4. If login fails   → show an error message
// ============================================================


// ============================================================
// DOM ELEMENTS
// ============================================================
// Grab references to the HTML elements we need to read/update.

const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const errorMsg = document.getElementById("errorMsg");


// ============================================================
// HELPER: Show / Hide Error Message
// ============================================================

// Displays a red error box with the given message text
function showError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = "block";
}

// Hides the error box (called when the user starts typing again)
function hideError() {
    errorMsg.style.display = "none";
}


// ============================================================
// HANDLE LOGIN FORM SUBMIT
// ============================================================

loginForm.addEventListener("submit", async (event) => {

    // Prevent the browser's default form submission (which would reload the page)
    event.preventDefault();

    // Read what the user typed (and trim extra whitespace from the username)
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Basic check — don't send an empty form
    if (!username || !password) {
        showError("Please fill in both fields.");
        return;
    }

    // Hide any previous error and disable the button so it can't be clicked twice
    hideError();
    loginBtn.disabled = true;
    loginBtn.textContent = "Logging in...";

    try {
        // Send a POST request to the server with the login data.
        // fetch() is the modern way to make HTTP requests from JavaScript.
        const response = await fetch("/api/login", {
            method: "POST",
            // Tell the server we are sending JSON data
            headers: { "Content-Type": "application/json" },
            // Convert the username/password object into a JSON string
            body: JSON.stringify({ username, password }),
        });

        if (response.ok) {
            // Server says login was successful!
            // Redirect the browser to the main chat app page.
            window.location.href = "/";
        } else {
            // Server returned an error (wrong password, user not found, etc.)
            // Parse the error message the server sent back
            const data = await response.json();
            showError(data.error || "Login failed. Please try again.");

            // Re-enable the button so the user can try again
            loginBtn.disabled = false;
            loginBtn.textContent = "Login";
        }

    } catch (err) {
        // This catch block runs if the network request itself failed
        // (e.g. server is offline)
        showError("Could not reach the server. Is it running?");
        loginBtn.disabled = false;
        loginBtn.textContent = "Login";
    }
});


// ============================================================
// CLEAR ERROR WHEN USER STARTS TYPING
// ============================================================
// This gives the user immediate feedback that their input has changed.

usernameInput.addEventListener("input", hideError);
passwordInput.addEventListener("input", hideError);
