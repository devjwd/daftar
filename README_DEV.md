# Daftar Development Environment

This guide explains how to set up and use the development and testing environment for Daftar.

## 🛠 Quick Start

1.  **Initialize the Environment**:
    Run the setup script to install dependencies and create your `.env` files.
    ```bash
    npm run setup
    ```

2.  **Configure Secrets**:
    *   Open `apps/server/.env` and add your **Supabase Service Role Key** and **Badge Signer Private Key**.
    *   Open `apps/frontend/.env.local` and ensure the `VITE_API_URL` is empty (to use the local proxy) or points to your local server.

3.  **Start the Stack**:
    Run both the frontend and backend concurrently:
    ```bash
    npm run dev
    ```
    *   **Frontend**: [http://localhost:3000](http://localhost:3000)
    *   **Backend**: [http://localhost:3001](http://localhost:3001)

---

## 🧪 Testing

### System Diagnostic
Run the full system diagnostic test (requires a wallet address):
```bash
npm test -- 0xYOUR_WALLET_ADDRESS
```

### Unit & Integration Tests
We use **Vitest** for unit testing.

**Backend Tests**:
```bash
npm run test --workspace=apps/server
# or for interactive UI:
npm run test:ui --workspace=apps/server
```

**Frontend Tests**:
```bash
npm run test --workspace=apps/frontend
# or for interactive UI:
npm run test:ui --workspace=apps/frontend
```

---

## 📁 Directory Structure

*   `apps/frontend`: React (Vite) application.
*   `apps/server`: Express (Node/TypeScript) backend.
*   `packages/database`: SQL schemas and migration scripts.
*   `scripts/`: Automation and testing utilities.

---

## 💡 Pro Tips

*   **Vite Proxy**: The frontend is configured to proxy all `/api` requests to `http://localhost:3001` during development.
*   **Supabase**: For local database development, we recommend using the [Supabase CLI](https://supabase.com/docs/guides/cli).
