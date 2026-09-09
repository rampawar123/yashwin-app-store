# Cric Yuva Phase 13 – Account/OTP/Registered Player System

## Active features
- New account registration requires Player Name, mobile, password, verify password and OTP.
- Successful registration creates a permanent server-side Player ID (`CYP-YYYY-....`).
- Login supports both password and OTP.
- OTP expires in 5 minutes and has a 5-attempt limit.
- Add Squad Player can search registered players by Player Name, mobile number or permanent Player ID.
- Selecting a registered player links the same master Player ID to the squad; it does not create a duplicate player.
- Existing Phase 1–19 UI/API files are preserved.

## OTP delivery
The backend supports a delivery webhook. Set these environment variables on the Node/Render server:
- `OTP_WEBHOOK_URL` = your SMS/WhatsApp OTP provider webhook.
- `OTP_DEV_MODE=false` after real delivery is configured.

For testing, `OTP_DEV_MODE` defaults to true and the generated OTP is returned to the UI as a TEST OTP. Do not use that mode for production accounts.

## Frontend API
If the GitHub Pages frontend is separate from the Node API, set `window.CRIC_YUVA_API_BASE` in `server-config.js` to the public API origin.
